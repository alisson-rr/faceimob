-- =============================================================================
-- 0231 — Sino abre o negócio, OFF nos reprovados e "Aguardando retorno"
--
-- Pedidos de 06/10/2026:
--   1. "No sino coloque um link para o card": os avisos de negócio apontavam
--      para '/pipeline' ou '/cca', sem dizer qual. Em vez de reescrever cada
--      função que avisa, a transação marca o negócio que tocou (deals,
--      deal_history, cca_cases) e o aviso de '/pipeline' ou '/cca' gravado na
--      mesma transação ganha '?negocio=<id>'. Transação que tocou mais de um
--      negócio (varredura em lote) fica sem o id: abrir a lista é melhor que
--      abrir o negócio errado.
--   2. "Coloque opção de OFF em reprovados": quem edita o negócio arquiva um
--      REPROVADO como OFF. Fora daí OFF continua de admin e sócio.
--   3. O aviso de 24 h dizia "foi para Sem Resposta", nome que não existe na
--      tela (lá é "Aguardando retorno") — o corretor não achava o lead.
-- =============================================================================

-- 1. Negócio da transação --------------------------------------------------------
create or replace function public.marca_negocio_da_transacao()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id    text := to_jsonb(new) ->> tg_argv[0];
  v_atual text := coalesce(current_setting('faceimob.negocio_da_transacao', true), '');
begin
  if v_id is null or v_atual = 'varios' or v_atual = v_id then
    return null;
  end if;
  perform set_config('faceimob.negocio_da_transacao',
                     case when v_atual = '' then v_id else 'varios' end, true);
  return null;
end;
$$;
revoke all on function public.marca_negocio_da_transacao() from public, anon, authenticated;

drop trigger if exists deals_marca_negocio on public.deals;
create trigger deals_marca_negocio
  after insert or update on public.deals
  for each row execute function public.marca_negocio_da_transacao('id');

drop trigger if exists deal_history_marca_negocio on public.deal_history;
create trigger deal_history_marca_negocio
  after insert on public.deal_history
  for each row execute function public.marca_negocio_da_transacao('deal_id');

drop trigger if exists cca_cases_marca_negocio on public.cca_cases;
create trigger cca_cases_marca_negocio
  after insert or update on public.cca_cases
  for each row execute function public.marca_negocio_da_transacao('deal_id');

create or replace function public.notifications_link_do_negocio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id text := current_setting('faceimob.negocio_da_transacao', true);
begin
  if new.link in ('/pipeline', '/cca')
     and v_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    new.link := new.link || '?negocio=' || v_id;
  end if;
  return new;
end;
$$;
revoke all on function public.notifications_link_do_negocio() from public, anon, authenticated;

drop trigger if exists notifications_link_do_negocio on public.notifications;
create trigger notifications_link_do_negocio
  before insert on public.notifications
  for each row execute function public.notifications_link_do_negocio();

-- 2. OFF nos reprovados ----------------------------------------------------------
create or replace function public.deal_status_move_block(p_from text, p_to text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from public.deal_statuses;
  v_to   public.deal_statuses;
begin
  if public.is_admin() then
    return null;
  end if;

  -- 0231: REPROVADO → OFF é de quem edita o negócio (a RLS já cobrou isso).
  if public.deal_status_bare(p_from) = 'REPROVADO' and public.deal_status_bare(p_to) = 'OFF' then
    return null;
  end if;

  select * into v_to from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_to)
   order by active desc limit 1;
  if not found then
    return 'Este Status 2 não está no cadastro.';
  end if;

  select * into v_from from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_from)
   order by active desc limit 1;

  if v_from.id is not null and v_from.id <> v_to.id and not exists (
    select 1 from public.deal_status_permissions p
     where p.status_id = v_from.id and p.can_exit
       and public.has_any_role(p.role)
  ) then
    return format('Seu perfil não tira o negócio de "%s".', v_from.label);
  end if;

  if not exists (
    select 1 from public.deal_status_permissions p
     where p.status_id = v_to.id and p.can_enter
       and public.has_any_role(p.role)
  ) then
    return format('Seu perfil não coloca o negócio em "%s".', v_to.label);
  end if;

  return null;
end;
$$;

comment on function public.deal_status_move_block(text, text) is
  'Motivo pelo qual quem chama não pode trocar o Status 2 de p_from para p_to, ou nulo. Admin e sócio passam; REPROVADO → OFF passa (0231); o resto é a matriz deal_status_permissions (0164).';

revoke all on function public.deal_status_move_block(text, text) from public, anon;
grant execute on function public.deal_status_move_block(text, text) to authenticated, service_role;

-- Corpo da 0230; só a regra do OFF muda.
create or replace function public.deals_guard_status_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inicial       boolean;
  v_novo_status   boolean;
  v_novo_motivo   boolean;
  v_etapa_outcome deal_outcome;
  v_block         text;
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_novo_status := true;
    v_novo_motivo := true;
  else
    -- Valor igual não é escrita: `legacyDealFields`
    -- (src/integrations/supabase/newSchema.ts) reenvia `status_detail` e
    -- `lost_reason` em TODO salvamento do editor.
    v_novo_status := new.status_detail is distinct from old.status_detail;
    v_novo_motivo := new.lost_reason is distinct from old.lost_reason;
  end if;

  -- (1) ETAPA — a matriz `stage_permissions`, e nada além dela (0101). A etapa
  -- que veio do Status 2 (0164, 0178, 0208) é autorizada pela matriz do Status 2
  -- e por (2) abaixo, como em `deals_guard_stage`.
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id
     and coalesce(current_setting('faceimob.stage_from_status', true), '') is distinct from new.id::text then
    if not public.can_exit_stage(old.stage_id) then
      raise exception 'Seu papel não pode tirar um negócio desta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
    if not public.can_enter_stage(new.stage_id) then
      raise exception 'Seu papel não pode mover um negócio para esta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
  elsif tg_op = 'INSERT' then
    -- A etapa INICIAL é nascimento, não movimentação (0101). O desfecho da
    -- etapa vem no MESMO select — é a mesma linha que a regra (3) usa.
    select coalesce(s.is_initial, false), s.outcome
      into v_inicial, v_etapa_outcome
      from public.pipeline_stages s where s.id = new.stage_id;

    -- `outcome` é NOT NULL na tabela e a FK garante a linha: nulo aqui só se a
    -- etapa não estiver VISÍVEL para quem insere. Recusar é a falha fechada —
    -- sem isto, uma política mais apertada em `pipeline_stages` desligaria a
    -- trava de desfecho em silêncio (0111).
    if v_etapa_outcome is null then
      raise exception 'Etapa do negócio não encontrada.'
        using errcode = 'P0001';
    end if;

    if not coalesce(v_inicial, false)
       and not public.can_enter_stage(new.stage_id) then
      raise exception 'Seu papel não pode criar um negócio nesta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;

    -- (1.b) NASCER VENDIDO — o buraco que a 0110 fechou e que continua fechado,
    -- agora dito pelo DESFECHO da etapa e não por uma lista de códigos: é
    -- `outcome = 'won'` que vira venda no placar (0060) e no VGV. SEM exceção
    -- de papel — administrador e sócio inclusive —, e na prática sem saída pela
    -- API do usuário, porque `deals_guard_document_review` (0110 §3) obriga a
    -- conferência a nascer 'draft'. Registrar venda passa pelo funil.
    if v_etapa_outcome = 'won'
       and coalesce(new.document_review_status, 'draft') <> 'approved' then
      raise exception
        'Um negócio não nasce vendido: a documentação precisa ser aprovada pelo gerente antes do fechamento.'
        using errcode = 'P0001',
              hint = 'Crie o negócio em uma etapa aberta, envie a documentação para a conferência e mova para "Fechado" depois da aprovação.';
    end if;

    -- (1.c) A FAIXA DO CCA continua cobrando a conferência de quem não é
    -- administrador — gerente, diretor e CCA têm a casa de "Em Análise" na
    -- matriz e criar o negócio já lá seria o desvio da conferência. O
    -- administrador e o sócio passam: migrar negócio que veio de fora e
    -- corrigir cadastro é a mesma correção manual que a 0110 já lhes deu em
    -- `outcome` e `closed_at`. `null::uuid` = nascimento (§1 desta migration):
    -- só a conferência é cobrada, nunca `requires_document`.
    if not public.is_admin() then
      v_block := public.deal_stage_document_block(
        null::uuid, new.stage_id, new.document_review_status);
      if v_block is not null then
        raise exception '%', v_block using errcode = 'P0001',
          hint = 'Crie o negócio em uma etapa aberta e envie a documentação para a conferência do gerente.';
      end if;
    end if;
  end if;

  -- (2) DESFECHO ESCRITO — só OFF e DISTRATO, e só quando o valor MUDA para
  -- eles (0101). `deal_status_bare` é a mesma normalização de `bareStatus`
  -- (src/lib/dealStatus.ts); compara o INÍCIO do texto porque `lost_reason`
  -- guarda a concatenação do `LoseDealDialog` ("17. DISTRATO — cliente
  -- desistiu"), e `\M` impede "OFF" de casar dentro de "OFERTA".
  -- ponytail: sair de OFF/DISTRATO (reabrir o negócio) não é cobrado no banco —
  -- só `ReopenDealDialog` restringe, na tela; evoluir quando o cliente disser
  -- que apagar um distrato é a mesma decisão que marcá-lo.
  -- 0230: DISTRATO também passa com `deals.mark_distrato` (a CCA); OFF segue
  -- só com `deals.mark_off_distrato` — exceto saindo de REPROVADO (0231), onde
  -- quem edita o negócio arquiva o reprovado como OFF.
  if ((v_novo_status and public.deal_status_bare(new.status_detail) ~ '^OFF\M')
      or (v_novo_motivo and public.deal_status_bare(new.lost_reason) ~ '^OFF\M'))
     and not public.has_permission('deals.mark_off_distrato')
     and not (tg_op = 'UPDATE' and public.deal_status_bare(old.status_detail) = 'REPROVADO') then
    raise exception
      'Só administrador e sócio marcam OFF (de REPROVADO, quem edita o negócio também). Os outros motivos de encerramento continuam sendo seus.'
      using errcode = '42501',
            hint = 'Permissão deals.mark_off_distrato, em Admin · Permissões.';
  end if;
  if ((v_novo_status and public.deal_status_bare(new.status_detail) ~ '^DISTRATO\M')
      or (v_novo_motivo and public.deal_status_bare(new.lost_reason) ~ '^DISTRATO\M'))
     and not (public.has_permission('deals.mark_off_distrato')
              or public.has_permission('deals.mark_distrato')) then
    raise exception
      'Só administrador, sócio e CCA marcam distrato. Os outros motivos de encerramento continuam sendo seus.'
      using errcode = '42501',
            hint = 'Permissão deals.mark_distrato, em Admin · Permissões.';
  end if;

  -- (3) DESFECHO ESTRUTURAL (`outcome`) e a DATA DE FECHAMENTO (`closed_at`) —
  -- vêm da ETAPA, não do cliente HTTP.
  if tg_op = 'INSERT' then
    -- Mesma derivação de `deals_guard_stage`, que é `before update` e por isso
    -- nunca viu um INSERT (0102). `v_etapa_outcome` já veio do select da regra
    -- (1): é a mesma linha, e lê-la duas vezes só dava duas chances de divergir.
    new.outcome := coalesce(v_etapa_outcome, new.outcome);

    -- `deals_closed_consistency` (0006) exige `closed_at` sempre que o desfecho
    -- não é 'open'.
    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;

  elsif (new.outcome is distinct from old.outcome
         or new.closed_at is distinct from old.closed_at)
        and new.stage_id is not distinct from old.stage_id
        and not public.is_admin() then
    -- Etapa parada e desfecho (ou data de fechamento) novo: não existe
    -- derivação que explique isso. `closed_at` entra aqui na 0110 pelo mesmo
    -- critério — quem o escreve é `deals_guard_stage`, junto com o `outcome`, e
    -- deslocá-lo à mão move o negócio de temporada no ranking (0060). Nenhum
    -- caminho da tela grava a coluna: `legacyDealFields` não tem a chave e os
    -- seis chamadores de `updateDeal` mandam etapa, Status 2 e motivo.
    -- `is_admin()` desde a 0097 é admin OU sócio — o administrador continua
    -- podendo endireitar à mão uma linha torta (import antigo, correção
    -- pontual). Quando a etapa MUDA, este ramo nem é avaliado: quem escreveu os
    -- dois valores foi `deals_guard_stage`.
    raise exception
      'O desfecho e a data de fechamento do negócio vêm da etapa. Mova o negócio para a etapa certa em vez de gravá-los.'
      using errcode = '42501',
            hint = 'Etapa "Fechado" fecha a venda; "Perdido" encerra. Correção manual é de administrador.';
  end if;

  return new;
end;
$function$;

comment on function public.deals_guard_status_columns() is
  'Etapa pela matriz stage_permissions; etapa que veio do Status 2 passa pela matriz do Status 2 (0208); OFF só com deals.mark_off_distrato, salvo saindo de REPROVADO (0231), e DISTRATO com ela ou deals.mark_distrato (0230); outcome e closed_at derivados da etapa. postgres e service_role passam; valor igual não conta como escrita.';

revoke all on function public.deals_guard_status_columns() from public, anon, authenticated;

-- 3. "Aguardando retorno" no aviso de 24 h --------------------------------------
create or replace function public.mark_no_response_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hours int;
  v_lead  record;
  v_count int := 0;
begin
  select s.no_response_hours into v_hours from public.automation_settings s where s.id;
  v_hours := coalesce(v_hours, 24);
  if v_hours <= 0 then
    return 0;
  end if;

  for v_lead in
    select l.id, l.full_name, l.assigned_to
    from public.leads l
    where l.funnel_stage = 'first_contact'
      and l.status in ('attending', 'in_progress')
      and coalesce(l.first_contact_at, l.last_activity_at) < now() - make_interval(hours => v_hours)
    for update skip locked
  loop
    update public.leads
       set funnel_stage = 'no_response'
     where id = v_lead.id;

    if v_lead.assigned_to is not null then
      insert into public.notifications (profile_id, kind, title, body, link, channel)
      values (
        v_lead.assigned_to,
        'lead_no_response',
        'Aguardando retorno: ' || coalesce(v_lead.full_name, 'lead sem nome'),
        format('%s h desde o primeiro contato sem avanço. O lead foi marcado como "Aguardando retorno" — tente outro canal ou registre o desfecho.',
               v_hours),
        '/leads?lead=' || v_lead.id::text,
        'in_app'
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.mark_no_response_leads() from public, anon, authenticated;
grant execute on function public.mark_no_response_leads() to service_role;

comment on function public.mark_no_response_leads() is
  'Varredura do pg_cron: lead em first_contact há mais de automation_settings.no_response_hours vai para no_response ("Aguardando retorno" na tela, 0231) e o corretor é avisado in-app. Devolve quantos moveu.';
