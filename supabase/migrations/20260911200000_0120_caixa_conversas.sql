-- =============================================================================
-- 0120 · Caixa de conversas do SDR (F2.5)
--
-- Até aqui a resposta do lead depois de "Assumir" caía como `unmatched` e sumia
-- da conversa, a linha `broker` não dizia QUEM respondeu e a conversa não tinha
-- como ser encerrada. O que esta migration entrega, para a aba Conversas e para
-- o `whatsapp-inbound-webhook`:
--
--   1. Autoria e mídia: `sdr_messages.sent_by` (quem escreveu a linha `broker`),
--      `media_type` e `media_id`. `sdr_conversations` ganha quem assumiu e quem
--      resolveu, e o status `resolved`.
--   2. Quem assumiu e quem resolveu é carimbado por GATILHO, com `auth.uid()`.
--      A tela grava `status` direto na tabela (policy `sdr_conversations_write`,
--      0008) e continua assim: com RPCs de assumir/resolver, um update pelo
--      PostgREST deixaria o dono em branco e o aviso ao dono não sairia.
--   3. A roleta segura o lead de conversa `human` só quando ela tem dono.
--      Conversa humana sem dono (reaberta pelo webhook, áudio que não
--      transcreveu) não pode prender o lead para sempre.
--   4. O sino cobre a mensagem que agora entra na conversa em vez de cair como
--      `unmatched` (`human_turn`) e o áudio que falhou (`audio_falhou`): com
--      dono, avisa só ele; sem dono, avisa SDR e administrador como o
--      `unmatched` já fazia, e também o corretor do lead, quando há um.
--   5. `whatsapp_inbound_messages` ganha leitura para o marketing (que já opera
--      as conversas), a lista "Sem lead" e o "Marcar como resolvido".
--
-- `whatsapp_inbound_messages.provider_message_id` já é único desde a 0083
-- (`text not null unique`). O webhook reserva a mensagem nele ANTES de baixar o
-- áudio — sem isso um replay da Meta pagaria a transcrição duas vezes — e o
-- teste 99_caixa_conversas cobra que continue assim.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Autoria, mídia, dono e resolução
-- -----------------------------------------------------------------------------
alter table public.sdr_messages
  add column if not exists media_type text,
  add column if not exists media_id   text,
  add column if not exists sent_by    uuid references public.profiles(id) on delete set null;

alter table public.sdr_messages drop constraint if exists sdr_messages_media_type_check;
alter table public.sdr_messages add constraint sdr_messages_media_type_check
  check (media_type is null or media_type in ('audio', 'imagem', 'video', 'documento', 'outro'));

comment on column public.sdr_messages.media_type is
  'Mídia que o lead mandou: audio, imagem, video, documento ou outro; nulo em texto. Áudio transcrito traz o texto em body; o que não transcreveu traz body começando por "[áudio" — é por aí que a aba Conversas separa os dois selos.';
comment on column public.sdr_messages.media_id is
  'Id da mídia na Cloud API (a Meta guarda por 7 dias). O arquivo não é armazenado.';
comment on column public.sdr_messages.sent_by is
  'Quem escreveu a linha broker (resposta humana pelo sdr-whatsapp-broadcast). Nulo em lead, agente, sistema e no histórico anterior à 0120.';

alter table public.sdr_conversations
  add column if not exists assumed_by  uuid references public.profiles(id) on delete set null,
  add column if not exists assumed_at  timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_at timestamptz;

alter table public.sdr_conversations drop constraint if exists sdr_conversations_status_check;
alter table public.sdr_conversations add constraint sdr_conversations_status_check
  check (status in ('active', 'human', 'qualified', 'disqualified', 'handed_off', 'abandoned', 'resolved'));

comment on column public.sdr_conversations.status is
  'active = robô responde; human = um humano atende (o webhook só chama o robô em active); qualified/disqualified/handed_off/abandoned = desfecho do robô; resolved = encerrada pela caixa (0120). Mensagem nova do lead reabre a resolvida como human.';
comment on column public.sdr_conversations.assumed_by is
  'Quem assumiu a conversa. Carimbado pelo gatilho sdr_conversations_carimbo com auth.uid(); o valor que o cliente mandar é ignorado. Nulo em human = conversa humana sem dono, que não segura o lead fora da roleta.';
comment on column public.sdr_conversations.resolved_by is
  'Quem marcou a conversa como resolvida. Carimbado pelo gatilho sdr_conversations_carimbo.';

-- -----------------------------------------------------------------------------
-- 2. Mensagens recebidas: mídia, desfechos novos e quem lê
-- -----------------------------------------------------------------------------
alter table public.whatsapp_inbound_messages add column if not exists media_type text;

alter table public.whatsapp_inbound_messages drop constraint if exists whatsapp_inbound_media_type_check;
alter table public.whatsapp_inbound_messages add constraint whatsapp_inbound_media_type_check
  check (media_type is null or media_type in ('audio', 'imagem', 'video', 'documento', 'outro'));

alter table public.whatsapp_inbound_messages drop constraint if exists whatsapp_inbound_outcome_check;
alter table public.whatsapp_inbound_messages add constraint whatsapp_inbound_outcome_check check (
  outcome in ('sdr_turn', 'remarketing_lead', 'unmatched', 'agent_error', 'human_turn', 'audio_falhou')
);

comment on column public.whatsapp_inbound_messages.outcome is
  'sdr_turn = turno do robô; remarketing_lead = virou lead; unmatched = ninguém soube rotear; agent_error = o turno ou a abertura do atendimento falhou; human_turn = entrou numa conversa que o robô não atende (0120); audio_falhou = áudio que não transcreveu, e a conversa foi para humano (0120).';

-- O marketing escreve em `sdr_conversations` desde a 0008 e opera a caixa: lia
-- as conversas e não as mensagens que chegam.
drop policy if exists whatsapp_inbound_select on public.whatsapp_inbound_messages;
create policy whatsapp_inbound_select on public.whatsapp_inbound_messages
  for select to authenticated
  using (public.has_any_role('admin', 'director', 'manager', 'sdr', 'marketing'));

-- Marcar como tratada é da mesma porta de quem escreve na conversa (0008) e da
-- `whatsapp_inbound_resolve_phone`. Diretor e gerente continuam lendo; a tela
-- esconde o botão para eles e o banco os recusa pelos dois caminhos — pela RPC
-- e pelo update direto, que o grant por coluna da 0083 ainda permite.
drop policy if exists whatsapp_inbound_update on public.whatsapp_inbound_messages;
create policy whatsapp_inbound_update on public.whatsapp_inbound_messages
  for update to authenticated
  using      (public.has_any_role('admin', 'sdr', 'marketing'))
  with check (public.has_any_role('admin', 'sdr', 'marketing'));

-- -----------------------------------------------------------------------------
-- 3. Quem assume e quem resolve é o banco que diz
--
-- As quatro colunas de autoria são do gatilho: o que o cliente mandar nelas é
-- descartado. Mexer em `assumed_by` numa conversa humana é "assumir em nome
-- próprio" — o carimbo é sempre `auth.uid()`, então ninguém grava o nome de
-- outro. Sem sessão (webhook, service role), o carimbo sai nulo: a conversa
-- reaberta ou com áudio que falhou fica humana SEM dono, e é assim que o aviso
-- vai para o SDR inteiro e a roleta não prende o lead.
--
-- A trava de "voltar ao robô": conversa já entregue a corretor pode ser
-- assumida (o lead escreveu de novo e precisa de resposta), mas não volta a
-- `active`. O robô requalificaria o lead e o `sdr_handoff` o devolveria à
-- roleta, tirando-o do corretor que já atende.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_conversations_carimbo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status_antes text;
  v_dono_antes   uuid;
begin
  if tg_op = 'UPDATE' then
    v_status_antes := old.status;
    v_dono_antes   := old.assumed_by;

    if new.status = 'active' and old.status <> 'active' and old.handed_off_at is not null then
      raise exception 'Esta conversa já foi entregue a um corretor: o robô não volta a atendê-la. Continue como humano ou marque como resolvida.'
        using errcode = 'P0001';
    end if;

    new.assumed_at  := old.assumed_at;
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  else
    new.assumed_at  := null;
    new.resolved_by := null;
    new.resolved_at := null;
  end if;

  if new.status = 'active' then
    new.assumed_by := null;
    new.assumed_at := null;
  elsif new.status = 'human'
        and (v_status_antes is distinct from 'human' or new.assumed_by is distinct from v_dono_antes) then
    new.assumed_by := auth.uid();
    new.assumed_at := case when auth.uid() is not null then now() end;
  else
    new.assumed_by := v_dono_antes;
  end if;

  if new.status = 'resolved' and v_status_antes is distinct from 'resolved' then
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.sdr_conversations_carimbo() from public, anon, authenticated;

drop trigger if exists sdr_conversations_carimbo on public.sdr_conversations;
create trigger sdr_conversations_carimbo
  before insert or update on public.sdr_conversations
  for each row execute function public.sdr_conversations_carimbo();

comment on function public.sdr_conversations_carimbo() is
  'Carimba assumed_by/assumed_at e resolved_by/resolved_at com auth.uid() quando o status muda (ou quando alguém assume uma conversa humana), limpa o dono ao voltar para active e recusa devolver ao robô conversa já entregue a corretor. Vale para qualquer caminho de escrita.';

-- -----------------------------------------------------------------------------
-- 4. A roleta segura o lead de conversa humana COM dono
--
-- Corpo da 0074 copiado; muda só o predicado da conversa. `active` continua
-- segurando (o robô está falando); `human` segura apenas com `assumed_by`:
-- sem dono ninguém responde pelo lead, e segurá-lo seria deixá-lo parado sem
-- ninguém. `resolved` libera.
-- -----------------------------------------------------------------------------
create or replace function public.assign_queued_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_done int := 0;
  v_max_rounds int;
begin
  select coalesce(s.roulette_max_rounds, 5) into v_max_rounds
  from public.automation_settings s where s.id;

  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
      and coalesce(l.roulette_misses, 0) < coalesce(v_max_rounds, 5)
      and not exists (
        select 1 from public.sdr_conversations c
        where c.lead_id = l.id
          and (c.status = 'active' or (c.status = 'human' and c.assumed_by is not null))
      )
    order by l.created_at
    limit 50
  loop
    if public.assign_lead(v_lead) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.assign_queued_leads() from public, anon, authenticated;
grant execute on function public.assign_queued_leads() to service_role;

comment on function public.assign_queued_leads is
  'Varre a fila e distribui. Ignora lead em conversa de SDR ativa (0022) ou assumida por um humano com dono (0120), e lead que já bateu o teto de voltas (0074): sem isso a janela fixa de 50 ficaria presa nos mais antigos, que a roleta nunca mais aceita.';

-- -----------------------------------------------------------------------------
-- 5. O sino cobre o que agora entra na conversa
--
-- `unmatched`/`agent_error` seguem como na 0083 (SDR e administrador, um aviso
-- por telefone a cada 6 h). O texto deixa de dizer que não há caixa: a mensagem
-- sem lead aparece em "Sem lead", e o CRM continua sem responder a número sem
-- lead — por isso "Responda pelo aparelho" fica, e o link continua nulo nela.
--
-- `human_turn`/`audio_falhou` (0120) são a mensagem que antes caía como
-- `unmatched` e agora entra numa conversa que o robô não atende:
--   · com dono ativo, só o dono, um aviso por conversa a cada 30 min — ele está
--     no atendimento, e o sino não pode virar um eco da conversa;
--   · sem dono (entregue, desqualificada, resolvida reaberta, áudio que
--     falhou), o mesmo público do `unmatched` — calar aqui seria regressão —,
--     e também o corretor do lead, com o link do LEAD: ele não abre /sdr.
-- O telefone abre o corpo, e é por ele que a repetição é contada.
--
-- `partner` entra junto com `admin`: administrador e sócio têm o mesmo nível
-- (0099), e o filtro por `ur.role` literal deixava o sócio fora do aviso.
-- -----------------------------------------------------------------------------
create or replace function public.notify_whatsapp_unmatched()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dono     uuid;
  v_lead     uuid;
  v_nome     text;
  v_corretor uuid;
  v_fato     text;
begin
  if new.outcome not in ('unmatched', 'agent_error', 'human_turn', 'audio_falhou') then
    return null;
  end if;

  if new.outcome in ('unmatched', 'agent_error') then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    -- `distinct on (p.id)`: quem é sdr E admin casaria duas vezes (0083).
    select distinct on (p.id)
           p.id,
           'whatsapp_unmatched',
           'Mensagem de WhatsApp sem destino',
           case
             when new.outcome = 'unmatched' then format(
               '%s escreveu para o número da empresa e a mensagem não casou com nenhum lead nem lista de remarketing. '
               'Ela aparece na aba Conversas do SDR, em "Sem lead". Responda pelo aparelho: o CRM não responde a número sem lead.',
               new.from_phone)
             -- Mídia (não suportada, ou áudio transcrito cujo turno falhou) o
             -- webhook grava na conversa: dizer "não entrou no histórico" seria falso.
             when new.conversation_id is not null and new.media_type is not null then format(
               '%s mandou uma mídia que o robô não lê ou não respondeu; ela está na conversa. '
               'Assuma a conversa na aba Conversas do SDR.',
               new.from_phone)
             when new.conversation_id is not null then format(
               '%s escreveu numa conversa do SDR e o agente de IA falhou ao responder; a mensagem não entrou no histórico. '
               'Assuma a conversa na aba Conversas do SDR para retomar o atendimento.',
               new.from_phone)
             else format(
               '%s escreveu para o número da empresa e o sistema falhou ao abrir o atendimento. '
               'A mensagem aparece na aba Conversas do SDR, em "Sem lead". Responda pelo aparelho.',
               new.from_phone)
           end,
           case when new.conversation_id is not null then '/sdr?aba=conversas' end,
           'in_app'::public.notification_channel
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id and p.status = 'active'
     where ur.role in ('sdr', 'admin', 'partner')
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = p.id
            and n.kind = 'whatsapp_unmatched'
            and n.body like new.from_phone || '%'
            and n.created_at > now() - interval '6 hours'
       );
    return null;
  end if;

  select po.id, l.id, l.full_name, l.assigned_to
    into v_dono, v_lead, v_nome, v_corretor
    from public.sdr_conversations c
    join public.leads l on l.id = c.lead_id
    left join public.profiles po on po.id = c.assumed_by and po.status = 'active'
   where c.id = new.conversation_id;

  v_fato := format('%s · %s %s', new.from_phone, coalesce(v_nome, 'lead sem nome'),
    case when new.outcome = 'audio_falhou'
         then 'mandou um áudio que não deu para transcrever, e o robô não respondeu.'
         else 'escreveu numa conversa que o robô não atende mais.'
    end);

  if v_dono is not null then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select v_dono,
           'whatsapp_human_turn',
           'Mensagem na conversa que você assumiu',
           v_fato || ' Responda pela aba Conversas do SDR.',
           '/sdr?aba=conversas',
           'in_app'::public.notification_channel
     where not exists (
       select 1 from public.notifications n
        where n.profile_id = v_dono
          and n.kind = 'whatsapp_human_turn'
          and n.body like new.from_phone || '%'
          and n.created_at > now() - interval '30 minutes'
     );
    return null;
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct on (p.id)
         p.id,
         'whatsapp_human_turn',
         'Mensagem de lead sem responsável',
         v_fato || ' Ninguém assumiu a conversa: assuma na aba Conversas do SDR para responder.',
         '/sdr?aba=conversas',
         'in_app'::public.notification_channel
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where ur.role in ('sdr', 'admin', 'partner')
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = p.id
          and n.kind = 'whatsapp_human_turn'
          and n.body like new.from_phone || '%'
          and n.created_at > now() - interval '6 hours'
     );

  if v_corretor is not null then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select p.id,
           'whatsapp_human_turn',
           'Seu lead escreveu no WhatsApp da empresa',
           v_fato || ' O lead está com você: retome o contato.',
           '/leads?lead=' || v_lead::text,
           'in_app'::public.notification_channel
      from public.profiles p
     where p.id = v_corretor
       and p.status = 'active'
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = p.id
            and n.kind = 'whatsapp_human_turn'
            and n.body like new.from_phone || '%'
            and n.created_at > now() - interval '6 hours'
       );
  end if;

  return null;
end;
$$;

revoke all on function public.notify_whatsapp_unmatched() from public, anon, authenticated;

comment on function public.notify_whatsapp_unmatched is
  'Avisa no sino quem precisa agir sobre uma mensagem recebida. unmatched/agent_error: SDR e administrador, 1 por telefone a cada 6 h (0083). human_turn/audio_falhou (0120): com dono ativo, só o dono, 1 por telefone a cada 30 min; sem dono, SDR e administrador (1 por telefone a cada 6 h) e o corretor do lead, com o link do lead.';

-- -----------------------------------------------------------------------------
-- 6. "Sem lead": a lista por telefone e o "Marcar como resolvido"
--
-- As duas rodam com os privilégios de quem chama: a RLS da tabela é a porta de
-- leitura (diretor e gerente leem), e marcar exige a mesma porta de escrita da
-- conversa, com 42501 para quem não passa. `handled_by` é sempre o próprio
-- usuário.
--
-- O recorte da lista é por desfecho, não só por `conversation_id` nulo: apagar
-- um lead zera o `conversation_id` de todo o histórico dele (on delete set
-- null), e aquelas mensagens já atendidas pelo robô não são pendência.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_inbox_unmatched()
returns table (from_phone text, ultima_mensagem text, ultima_em timestamptz, pendentes int, media_type text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select t.from_phone, t.body, t.created_at, t.pendentes, t.media_type
    from (
      select m.from_phone, m.body, m.created_at, m.media_type,
             count(*) over (partition by m.from_phone)::int as pendentes,
             row_number() over (partition by m.from_phone order by m.created_at desc, m.id desc) as ordem
        from public.whatsapp_inbound_messages m
       where m.handled_at is null
         and m.conversation_id is null
         and m.outcome in ('unmatched', 'agent_error')
    ) t
   where t.ordem = 1
   order by t.created_at desc;
$$;

revoke all on function public.whatsapp_inbox_unmatched() from public, anon;
grant execute on function public.whatsapp_inbox_unmatched() to authenticated;

comment on function public.whatsapp_inbox_unmatched() is
  'Seção "Sem lead" da aba Conversas: telefones com mensagem pendente que não entrou em conversa (unmatched ou agent_error sem conversa), com a última mensagem, a quantidade e a mídia da última. Roda como quem chama: a RLS de whatsapp_inbound_messages decide quem lê.';

create or replace function public.whatsapp_inbound_resolve_phone(p_phone text)
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_marcadas int;
begin
  if not public.has_any_role('admin', 'sdr', 'marketing') then
    raise exception 'Marcar mensagem como resolvida é de administrador, marketing e SDR.'
      using errcode = '42501';
  end if;
  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'Informe o telefone.' using errcode = '22023';
  end if;

  update public.whatsapp_inbound_messages
     set handled_at = now(),
         handled_by = auth.uid()
   where from_phone = p_phone
     and handled_at is null;
  get diagnostics v_marcadas = row_count;
  return v_marcadas;
end;
$$;

revoke all on function public.whatsapp_inbound_resolve_phone(text) from public, anon;
grant execute on function public.whatsapp_inbound_resolve_phone(text) to authenticated;

comment on function public.whatsapp_inbound_resolve_phone(text) is
  'Marca como tratadas as mensagens pendentes de um telefone, com handled_by = o próprio usuário. Devolve quantas marcou. Exige admin (sócio junto), sdr ou marketing: 42501 para os demais.';

-- -----------------------------------------------------------------------------
-- 7. Nome de quem responde, assume e resolve
--
-- `profiles_select` mostra ao SDR só o próprio perfil (auth_visible_profiles),
-- e a caixa precisa escrever "Humano · Fulano" e "Assumida por Fulano". Mesmo
-- desenho da `team_leader_names` (0079): a view roda com os privilégios do dono
-- e atravessa `profiles_select` de propósito, por isso a lista de colunas é
-- fechada aqui — só id e nome, e só de quem pode escrever numa conversa (os
-- únicos que o gatilho carimba). Lê quem lê a caixa inteira; o corretor não.
-- -----------------------------------------------------------------------------
drop view if exists public.sdr_operator_names;
create view public.sdr_operator_names as
  select p.id, p.full_name
    from public.profiles p
   where public.has_any_role('admin', 'director', 'manager', 'marketing', 'sdr')
     and exists (
       select 1 from public.user_roles ur
        where ur.profile_id = p.id
          and ur.role in ('admin', 'partner', 'marketing', 'sdr')
     );

comment on view public.sdr_operator_names is
  'Id e nome de quem pode escrever numa conversa de SDR (admin, sócio, marketing, sdr), legível por quem lê a caixa inteira. Existe porque profiles_select só mostra ao SDR o próprio perfil. Expõe SOMENTE id e full_name.';

revoke all on public.sdr_operator_names from public, anon;
grant select on public.sdr_operator_names to authenticated;
