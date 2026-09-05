-- =============================================================================
-- 0056 · Roleta sem laço, escrita de lead com dono e a próxima ação que
--        sustenta o bloqueio dos 20 leads atrasados.
--
-- Cinco defeitos, todos medidos no banco de homologação:
--
-- 1. O DIA OPERACIONAL DE `assign_lead`. O Postgres roda em UTC e a operação
--    vive em America/Sao_Paulo: às 21:00 de Brasília o `current_date` do banco
--    já é o dia seguinte, enquanto a presença aberta às 18:35 continua com a
--    data anterior. `assign_lead` incrementava `checkins.leads_received` por
--    `work_date = current_date` e, nos últimos 30 minutos do turno da noite,
--    não achava a linha: o corretor recebia o lead e o selo do turno não
--    contava. A 0057 (frente check-in) corrige `current_work_date()`,
--    `perform_checkin`, `perform_checkout`, `auto_checkout_expired` e
--    `distribution_queue`; `assign_lead` ficou de fora de propósito, porque é
--    esta frente que a está reescrevendo. Aqui ela passa a chamar
--    `public.current_work_date()`, como todo o resto.
--
-- 2. LEAD EM LAÇO NO MESMO CORRETOR. `release_expired_leads` devolve o lead à
--    fila e reatribui na hora; com um único corretor elegível, o mesmo lead
--    voltava para ele a cada prazo vencido, para sempre, inflando
--    `lead_assignments` e o contador `checkins.leads_received` — o rótulo
--    "leads recebidos" virava mentira. Agora `assign_lead` pula quem devolveu
--    ESTE lead por timeout na rodada anterior; quando ele é o único da fila, o
--    lead ainda volta, mas no máximo 3 vezes. Depois disso fica `queued` e
--    aparece no card de saúde da roleta em /leads, em vez de rodar em laço.
--    A regra de 30/07 ("o lead pode voltar para o mesmo corretor, desde que
--    passe por toda a fila de novo") continua valendo: com dois ou mais na
--    fila, ele só volta depois de a fila inteira ter tido a vez.
--    O TETO É AUTOMÁTICO, NÃO ABSOLUTO: `assign_lead` ganhou `p_force`, e
--    `distribute_queued_lead` (o botão "Distribuir" do card de saúde) o passa
--    como verdadeiro. Sem essa válvula o lead que bate o teto não tinha saída
--    nenhuma — o cron falhava a cada minuto, o botão feito para destravar caía
--    no mesmo teto e sobrava só `reassign_lead`, que exige `leads.reassign` e
--    fura o rodízio. O gestor clicou sabendo; o cron continua barrado.
--
-- 3. QUEM ENXERGA O LEAD ESCREVE NELE. `lead_comments_insert` e
--    `lead_attachments_insert` exigiam só `can_see_lead()`, que é predicado de
--    LEITURA: o sócio comentava e anexava em 62 leads que não são dele, e o
--    banco aceitava. As duas policies passam a exigir `can_write_lead()`, o
--    mesmo predicado de `leads_update` (dono, admin, gestor do dono, ou lead
--    sem dono para quem tem `leads.view_queue`). Ler continua liberado.
--
-- 4. BLOQUEIO DOS 20 OPCIONAL NA PRÁTICA. `overdue_lead_count` conta lead vivo
--    com `next_action_at` vencido, e `next_action_at` só nascia de uma tarefa
--    com data na aba Agenda: quem nunca criava tarefa nunca atrasava e nunca
--    era bloqueado (39 de 73 leads tinham o campo, 36 deles vindos do seed; o
--    caminho de produto gerou 3 linhas em toda a história do banco).
--    `claim_lead` passa a nascer com uma próxima ação — `now() +
--    no_response_hours`, o mesmo prazo já configurado em Admin · Automação de
--    Leads — quando o corretor não definiu nenhuma. A tela pede a data logo
--    depois de "Atender" e sobrescreve este padrão.
--    Consequência: quem atende e não trata o lead passa a acumular atraso de
--    verdade, que é o efeito pedido pelo bloqueio dos 20. Quem já tinha
--    `next_action_at` não é tocado, e converter/perder o lead o tira da conta
--    (só status vivo conta).
--
-- 5. BUCKET SEM LIMITE. `lead-attachments` estava com `file_size_limit` e
--    `allowed_mime_types` nulos: qualquer tamanho, qualquer tipo, inclusive
--    HTML/SVG servido por URL assinada. Passa a 8 MB (o mesmo teto da
--    importação de planilha) e a uma lista de tipos de documento. A tela valida
--    antes de subir e diz o limite; o bucket é a trava que sobra.
--
-- 6. `next_action_at` COM DOIS DONOS, E O OUTRO APAGA. O gatilho
--    `tasks_sync_lead_deadline` (0011) recalculava o campo com
--    `min(due_at) where status = 'open'` a cada insert/update de tarefa — e
--    quando não sobrava nenhuma tarefa aberta com data o `min()` era NULL e o
--    campo era ZERADO. Ou seja: o padrão que o item 4 acabou de criar, a data
--    escolhida no diálogo de próxima ação e o campo da aba Dados sumiam em
--    silêncio assim que o corretor criava e concluía qualquer tarefa do lead.
--    O lead saía de `overdue_lead_count` e o bloqueio dos 20 voltava a ser
--    opcional, que é justamente o defeito nº 4. Agora o gatilho só sobrescreve
--    quando EXISTE tarefa aberta com data: a próxima ação manual não é
--    derivada de tarefa e não pode ser apagada por ela.
--    Consequência: concluir a última tarefa deixa a data anterior de pé — o
--    lead continua cobrando uma próxima ação até alguém reagendar, que é o
--    comportamento que o bloqueio dos 20 pressupõe.
--
-- Entra junto `existing_lead_phones`, que alimenta a marcação de duplicata na
-- prévia da importação de planilha (ver comentário na própria função).
--
-- Idempotente: `create or replace`, `drop policy if exists`, um
-- `drop function if exists public.assign_lead(uuid)` (a assinatura ganhou
-- `p_force`; sem o drop as duas versões coexistiriam e a chamada de um
-- argumento ficaria ambígua) e um `update`
-- condicionado à existência da coluna (o harness de
-- `scripts/validate-schema.sh` tem um `storage.buckets` reduzido, sem as
-- colunas de limite).
--
-- Asserts em supabase/tests/56_leads_roleta.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Qual grupo distribui este lead
--
-- Regra em UM lugar: o grupo explícito do lead, senão o do formulário que o
-- trouxe, senão a fila geral ativa. `assign_lead` decide por ela e
-- `distribute_queued_lead` a consulta para dizer ao gestor QUAL das causas
-- travou o lead — sem isso a tela teria de repetir o `coalesce` e as duas
-- versões divergiriam na primeira mudança de regra.
-- -----------------------------------------------------------------------------
create or replace function public.lead_distribution_group(p_lead_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    l.distribution_group_id,
    (select f.group_id from public.distribution_group_forms f where f.form_id = l.form_id),
    (select g.id from public.distribution_groups g where g.kind = 'general' and g.active limit 1)
  )
  from public.leads l
  where l.id = p_lead_id;
$$;

comment on function public.lead_distribution_group is
  'Grupo que distribui o lead: o explícito, senão o do formulário, senão a fila '
  'geral ativa. Fonte única de assign_lead e distribute_queued_lead (0056).';

revoke all on function public.lead_distribution_group(uuid) from public, anon;
grant execute on function public.lead_distribution_group(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1 + 2. Roleta: dia operacional de São Paulo e fim do laço no mesmo corretor
--
-- `p_force` é a válvula do teto de reentregas: o cron chama sem ela (e o lead
-- que bateu o teto fica parado, em vez de circular), o gestor chama com ela
-- pelo botão "Distribuir". O `drop` é obrigatório porque a assinatura mudou —
-- com `assign_lead(uuid)` e `assign_lead(uuid, boolean default false)` no
-- mesmo schema, `assign_lead(x)` seria ambígua para todos os chamadores
-- (0005, 0020, 0022, 0064 e os webhooks).
-- -----------------------------------------------------------------------------
drop function if exists public.assign_lead(uuid);

create or replace function public.assign_lead(p_lead_id uuid, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead        public.leads;
  v_group       uuid;
  v_target      uuid;
  v_timeout     int;
  v_seq         int;
  v_paused      boolean;
  v_last_miss   uuid;
  v_miss_count  int;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead % não encontrado.', p_lead_id using errcode = 'P0002';
  end if;

  select s.leads_paused into v_paused from public.automation_settings s where s.id;
  if coalesce(v_paused, false) then
    return null;
  end if;

  if v_lead.status not in ('queued') then
    return v_lead.assigned_to;
  end if;

  v_group := public.lead_distribution_group(p_lead_id);

  if v_group is null then
    return null;
  end if;

  -- Quem deixou ESTE lead vencer na rodada anterior não é o primeiro a recebê-lo
  -- de volta: senão, com um único corretor na fila, o mesmo lead circula nele a
  -- cada prazo vencido e infla o contador de "leads recebidos".
  select la.profile_id into v_last_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout'
  order by la.released_at desc nulls last
  limit 1;

  select q.profile_id into v_target
  from public.distribution_queue(v_group) q
  where v_last_miss is null or q.profile_id <> v_last_miss
  order by q.queue_position
  limit 1;

  -- Fila com um corretor só: o lead ainda volta para ele — o cliente aceitou
  -- isso em 30/07 —, mas no máximo 3 vezes por conta do cron. Depois fica
  -- `queued` e aparece no card de saúde da roleta em vez de rodar em laço; o
  -- gestor destrava pelo botão "Distribuir" (`p_force`), que é o único caminho
  -- que ignora o teto.
  if v_target is null and v_last_miss is not null then
    select count(*)::int into v_miss_count
    from public.lead_assignments la
    where la.lead_id = p_lead_id
      and la.profile_id = v_last_miss
      and la.release_reason = 'timeout';

    if coalesce(p_force, false) or v_miss_count < 3 then
      select q.profile_id into v_target
      from public.distribution_queue(v_group) q
      order by q.queue_position
      limit 1;
    end if;
  end if;

  if v_target is null then
    return null;
  end if;

  v_timeout := public.effective_attend_timeout(v_group);

  select coalesce(max(la.sequence), 0) + 1 into v_seq
  from public.lead_assignments la where la.lead_id = p_lead_id;

  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  values (p_lead_id, v_target, v_group, v_seq, now() + make_interval(secs => v_timeout));

  update public.leads
     set status                = 'assigned',
         assigned_to           = v_target,
         assigned_at           = now(),
         attend_deadline       = now() + make_interval(secs => v_timeout),
         distribution_group_id = v_group,
         last_activity_at      = now()
   where id = p_lead_id;

  -- Dia operacional de São Paulo (`current_work_date`, 0057), não a data do
  -- servidor: o banco está em UTC e o turno da noite acaba depois da virada.
  update public.checkins
     set leads_received = leads_received + 1
   where profile_id = v_target
     and work_date = public.current_work_date()
     and checked_out_at is null;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, null, 'assigned', v_target::text,
          jsonb_build_object('group_id', v_group, 'sequence', v_seq, 'timeout_seconds', v_timeout));

  return v_target;
end;
$$;

comment on function public.assign_lead is
  'Distribui o lead ao primeiro da fila do grupo. Pula quem devolveu ESTE lead '
  'por timeout na rodada anterior; quando ele é o único elegível, o lead volta no '
  'máximo 3 vezes e depois permanece na fila. p_force ignora esse teto e é usado '
  'só pela distribuição manual do gestor (0056).';

-- A função é do serviço: a tela não escolhe para quem o lead vai. O `drop`
-- acima levou os grants junto, então eles são obrigatórios aqui.
revoke all on function public.assign_lead(uuid, boolean) from public, anon, authenticated;
grant execute on function public.assign_lead(uuid, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- Distribuir um lead parado, à mão
--
-- `assign_lead` é do serviço (revogada de `authenticated`, e continua assim):
-- a tela não escolhe para quem o lead vai. Mas o gestor não tinha NENHUM jeito
-- de destravar um lead preso na fila — o único caminho manual era
-- `reassign_lead`, que obriga a escolher um corretor específico e fura o
-- rodízio. Esta função só empurra o lead para a roleta: quem recebe continua
-- sendo o primeiro da fila.
--
-- `leads.view_queue` é o mesmo código que a policy `leads_select` exige para
-- enxergar lead sem dono — quem não vê o lead parado também não o distribui.
--
-- `assign_lead` devolve null por QUATRO motivos diferentes (pausa global, lead
-- sem grupo, teto de reentregas, fila vazia) e a tela mostrava uma frase só —
-- a de fila vazia —, mandando o gestor procurar check-in quando o problema era
-- a distribuição pausada em Admin. Aqui cada causa vira uma exceção com o
-- próprio texto em pt-BR (P0001, que `describeError` repassa ao usuário); o
-- teto é ignorado por `p_force`; e null passa a significar UMA coisa só:
-- ninguém elegível na fila agora.
-- -----------------------------------------------------------------------------
create or replace function public.distribute_queued_lead(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.lead_status;
  v_paused boolean;
begin
  if not public.has_permission('leads.view_queue') then
    raise exception 'Sem permissão para distribuir leads da fila.' using errcode = '42501';
  end if;

  select l.status into v_status from public.leads l where l.id = p_lead_id;
  if v_status is null then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  if v_status <> 'queued' then
    raise exception 'Este lead não está na fila (%).', v_status using errcode = 'P0001';
  end if;

  select s.leads_paused into v_paused from public.automation_settings s where s.id;
  if coalesce(v_paused, false) then
    raise exception 'A distribuição está pausada em Admin · Automação de Leads. '
                    'Nenhum lead sai da fila até religar.' using errcode = 'P0001';
  end if;

  if public.lead_distribution_group(p_lead_id) is null then
    raise exception 'Este lead não tem grupo de distribuição e não há fila geral ativa. '
                    'Defina o grupo do lead ou ative a fila geral em Admin · Distribuição.'
                    using errcode = 'P0001';
  end if;

  -- Devolve null quando não há ninguém elegível: a tela precisa dizer isso em
  -- vez de fingir que distribuiu.
  return public.assign_lead(p_lead_id, true);
end;
$$;

comment on function public.distribute_queued_lead is
  'Empurra um lead parado na fila para a roleta, sem escolher o corretor. Exige '
  'leads.view_queue. Recusa com motivo quando a distribuição está pausada ou o '
  'lead não tem grupo, ignora o teto de reentregas (p_force) e devolve null só '
  'quando não há ninguém elegível na fila (0056).';

revoke all on function public.distribute_queued_lead(uuid) from public, anon;
grant execute on function public.distribute_queued_lead(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Atender nasce com próxima ação
-- -----------------------------------------------------------------------------
create or replace function public.claim_lead(p_lead_id uuid)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
  v_auto boolean;
  v_next int;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.assigned_to is distinct from auth.uid() then
    raise exception 'Este lead não está atribuído a você.' using errcode = '42501';
  end if;

  if v_lead.status <> 'assigned' then
    raise exception 'Lead não está aguardando atendimento.' using errcode = 'P0001';
  end if;

  select s.auto_first_contact, s.no_response_hours
    into v_auto, v_next
  from public.automation_settings s where s.id;

  update public.lead_assignments
     set responded_at = now()
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = 'attending',
         attend_deadline  = null,       -- travado com o corretor
         first_contact_at = coalesce(first_contact_at, now()),
         -- "Auto 1º contato": atender já é o primeiro contato. Só sai de `new`
         -- para não regredir um lead que o SDR ou o corretor já moveram.
         funnel_stage     = case
                              when coalesce(v_auto, false) and funnel_stage = 'new'
                              then 'first_contact'::lead_funnel_stage
                              else funnel_stage
                            end,
         -- Atender passa a exigir uma próxima ação: é ela que faz o lead
         -- atrasar e alimenta o bloqueio dos 20. Sem este padrão, quem nunca
         -- agenda nada nunca é barrado. A tela pergunta a data logo depois de
         -- "Atender" e sobrescreve.
         next_action_at   = coalesce(next_action_at,
                                     now() + make_interval(hours => coalesce(v_next, 24))),
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind)
  values (p_lead_id, auth.uid(), 'claimed');

  return v_lead;
end;
$$;

comment on function public.claim_lead is
  'Trava o lead com o corretor: zera o prazo de atendimento, marca o primeiro '
  'contato e nasce com uma próxima ação (now() + no_response_hours) quando não há '
  'nenhuma — é ela que sustenta o bloqueio por leads atrasados (0056).';

-- -----------------------------------------------------------------------------
-- 6. A tarefa ATUALIZA a próxima ação; não a apaga
--
-- O gatilho de `tasks` (0011) reescrevia `leads.next_action_at` com o
-- `min(due_at)` das tarefas abertas — e zerava o campo quando não sobrava
-- nenhuma. Concluir a única tarefa do lead apagava o padrão do `claim_lead`
-- logo acima, a data escolhida no diálogo de próxima ação e o campo da aba
-- Dados, tirando o lead de `overdue_lead_count` sem ninguém pedir.
--
-- Só o `update` mudou: mesma assinatura, mesmo gatilho, `create or replace`
-- mantém o binding.
-- -----------------------------------------------------------------------------
create or replace function public.tasks_sync_lead_deadline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_min timestamptz;
begin
  if new.ref_type = 'lead' and new.ref_id is not null then
    select min(t.due_at) into v_min
    from public.tasks t
    where t.ref_type = 'lead' and t.ref_id = new.ref_id
      and t.status = 'open' and t.due_at is not null;

    -- Sem tarefa aberta com data não há o que derivar: a próxima ação manual
    -- fica de pé. Sobrescrever com NULL era apagar a data de outro dono.
    if v_min is not null then
      update public.leads set next_action_at = v_min where id = new.ref_id;
    end if;
  end if;
  return null;
end;
$$;

comment on function public.tasks_sync_lead_deadline is
  'Puxa para leads.next_action_at a menor data de tarefa aberta do lead. Não '
  'apaga o campo quando não há tarefa aberta: a próxima ação também é definida '
  'à mão (claim_lead e o diálogo da tela) e não é derivada de tarefa (0056).';

-- -----------------------------------------------------------------------------
-- 3. Escrever no lead exige dono, gestor ou admin
-- -----------------------------------------------------------------------------
create or replace function public.can_write_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        l.assigned_to = auth.uid()
        or public.is_admin()
        or public.manages_profile(l.assigned_to)
        or (l.assigned_to is null and public.has_permission('leads.view_queue'))
      )
  );
$$;

comment on function public.can_write_lead is
  'Predicado de ESCRITA no lead — o mesmo de leads_update. can_see_lead é de '
  'leitura: usá-lo em policy de insert deixava qualquer um que enxerga o lead '
  'comentar e anexar nele (0056).';

revoke all on function public.can_write_lead(uuid) from public, anon;
grant execute on function public.can_write_lead(uuid) to authenticated, service_role;

drop policy if exists lead_comments_insert on public.lead_comments;
create policy lead_comments_insert on public.lead_comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_write_lead(lead_id));

drop policy if exists lead_attachments_insert on public.lead_attachments;
create policy lead_attachments_insert on public.lead_attachments
  for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_write_lead(lead_id));

-- -----------------------------------------------------------------------------
-- Importação: quais telefones já existem (dedupe na prévia)
--
-- Reimportar a mesma exportação do Leadfy criava todos os leads de novo, e
-- todos entravam na roleta — dois corretores atendendo o mesmo cliente. Não é
-- índice único de propósito: "perdi e voltou" acontece de verdade, e o mesmo
-- telefone pode virar lead novo meses depois. A prévia marca as linhas
-- repetidas e importa só as novas; quem decide é quem importa.
--
-- SECURITY DEFINER porque a duplicata pode estar num lead de outra equipe, que
-- o RLS esconde de quem importa — devolve só o telefone e a contagem, nunca a
-- linha. Restrita a quem a policy `leads_insert` já deixa criar lead.
-- -----------------------------------------------------------------------------
create or replace function public.existing_lead_phones(p_phones text[])
returns table (phone_digits text, lead_count int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin'::app_role, 'director'::app_role, 'manager'::app_role,
                             'marketing'::app_role, 'sdr'::app_role) then
    raise exception 'Sem permissão para importar leads.' using errcode = '42501';
  end if;

  -- `normalize_phone` é a MESMA função que o gatilho de `leads` aplica na
  -- gravação (0001: "Base do dedupe de leads"): a coluna guarda E.164 com DDI
  -- 55, e comparar dígito a dígito com o que veio da planilha nunca casaria.
  -- Devolve o telefone COMO FOI INFORMADO, para quem chamou casar com a própria
  -- linha sem repetir a normalização no cliente.
  return query
  select p.informado, count(l.id)::int
  from unnest(coalesce(p_phones, '{}'::text[])) as p(informado)
  join public.leads l on l.phone = public.normalize_phone(p.informado)
  where p.informado is not null and p.informado <> ''
  group by p.informado;
end;
$$;

comment on function public.existing_lead_phones is
  'Entre os telefones informados, os que já existem em leads (comparados por '
  'normalize_phone, a mesma normalização do gatilho). Alimenta a marcação de '
  'duplicata na prévia da importação de planilha (0056).';

revoke all on function public.existing_lead_phones(text[]) from public, anon;
grant execute on function public.existing_lead_phones(text[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Teto de tamanho e de tipo no bucket dos anexos de lead
--
-- O `do` condicionado à coluna existe porque `scripts/validate-schema.sh` roda
-- as migrations contra um `storage.buckets` reduzido (00_supabase_stubs.sql),
-- sem as colunas de limite. Em Supabase de verdade as duas existem.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    execute $sql$
      update storage.buckets
         set file_size_limit = 8 * 1024 * 1024,
             allowed_mime_types = array[
               'application/pdf',
               'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
               'application/msword',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.ms-excel',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'text/csv', 'text/plain'
             ]
       where id = 'lead-attachments'
    $sql$;
  end if;
end
$$;
