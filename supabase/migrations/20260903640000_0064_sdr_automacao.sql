-- =============================================================================
-- 0064 · SDR por IA: handoff protegido, conversa assumida por humano e
--        encadeamento sem ciclo
--
-- O que a auditoria de 02/09/2026 achou aberto neste bloco:
--
--   1. `sdr_handoff` é SECURITY DEFINER e estava liberada para QUALQUER
--      `authenticated`, sem checar papel nem dono do recurso: corretor ou
--      analista CCA logado podia forçar a devolução de qualquer conversa à
--      roleta (e carimbar `funnel_stage = 'qualified'` num lead que ninguém
--      qualificou). Agora a chamada de dentro do app exige papel de operação
--      do SDR; a chamada do servidor (edge function com service role, onde
--      `auth.uid()` é nulo) continua passando.
--
--   2. A mesma função carimbava `funnel_stage = 'qualified'` em TODO handoff.
--      Com o teto de turnos (`sdr_agents.max_turns`) passando a valer no
--      `_shared/sdrAgent.ts`, existe um segundo motivo de devolução — a
--      conversa que esgotou os turnos sem qualificar. Chamar isso de
--      "qualificado" mentiria no funil e no relatório. `p_reason` distingue os
--      dois e só 'qualified' mexe na etapa.
--
--   3. Não havia como um humano assumir a conversa do robô. O
--      `whatsapp-inbound-webhook` só atende conversa com `status = 'active'`,
--      então basta um status novo — 'human' — para o robô parar de responder
--      sem que a conversa seja encerrada. É o que a aba Conversas passa a
--      gravar em "Assumir conversa".
--
--   4. `sdr_agents.handoff_to_agent_id` aceitava cadeia A→B→A. Com a delegação
--      por @menção removida (o modelo tinha de acertar um texto exato e falhava
--      em silêncio), a cadeia fixa da tela virou o ÚNICO caminho de delegação —
--      e um ciclo aqui prende o lead girando entre dois agentes para sempre.
--      O guard fica no banco porque é o ponto por onde tela, seed e script
--      passam.
--
--   5. Excluir a "Fila Geral" pela tela era irreversível e nenhum formulário do
--      app cria um grupo `kind = 'general'`: `sdr_handoff` e `assign_lead`
--      dependem dele. O delete da última fila geral ativa passa a ser recusado.
--
--   6. O papel `sdr` NÃO tem `leads.view_queue`, então na aba Conversas ele não
--      conseguia ler o lead da conversa que a própria policy já deixa ele ver —
--      a lista mostrava status e data, sem dizer de QUEM é a conversa. A policy
--      nova é estreita: só leads que já têm conversa de SDR, só para os papéis
--      que operam o módulo.
--
-- Idempotente: pode rodar de novo sem efeito colateral.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3. Status 'human' — o operador assume a conversa e o robô cala
-- -----------------------------------------------------------------------------
alter table public.sdr_conversations
  drop constraint if exists sdr_conversations_status_check;
alter table public.sdr_conversations
  add constraint sdr_conversations_status_check
  check (status in ('active','human','qualified','disqualified','handed_off','abandoned'));

comment on column public.sdr_conversations.status is
  'active = robô responde; human = operador assumiu (whatsapp-inbound-webhook só atende ''active'', então a IA para); qualified/disqualified/handed_off/abandoned = desfecho.';
comment on column public.sdr_conversations.score is
  'Nota 0-100 escrita pelo próprio agente a cada turno (tag [SCORE:n] em _shared/sdrAgent.ts). Nulo enquanto o modelo não pontuar.';
comment on column public.sdr_conversations.summary is
  'Resumo do que foi apurado, escrito pelo agente (tag [RESUMO:...]). É o que a aba Conversas mostra ao lado do score.';

comment on column public.sdr_agents.max_turns is
  'Teto de respostas do agente numa conversa. Ao atingir, _shared/sdrAgent.ts para de chamar o modelo e devolve o lead à roleta com motivo ''exhausted''.';
comment on column public.sdr_agents.handoff_group_id is
  'Roleta que recebe o lead quando este agente conclui (lido por sdr_handoff). Sem valor, cai no grupo kind=''general''. Editável na aba Agentes.';
comment on column public.whatsapp_templates.variables is
  'Nomes dos placeholders na ordem em que a Meta os espera ({{1}}, {{2}}...). É esta lista que decide QUANTOS parâmetros o disparo envia — corpo com {{2}} e lista vazia é recusado pela Graph API.';
comment on column public.lead_sources.channel is
  'Canal de entrada da origem, para relatório por canal. Editável na aba Origens.';

-- -----------------------------------------------------------------------------
-- 1 e 2. sdr_handoff — porta de papel e motivo honesto
--
-- Assinatura nova (segundo parâmetro com default): o 1-arg precisa sair, senão
-- a chamada `sdr_handoff(uuid)` fica ambígua entre as duas.
-- -----------------------------------------------------------------------------
drop function if exists public.sdr_handoff(uuid);

create or replace function public.sdr_handoff(
  p_conversation_id uuid,
  p_reason text default 'qualified'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv   public.sdr_conversations;
  v_group  uuid;
  v_broker uuid;
begin
  if p_reason not in ('qualified','exhausted') then
    raise exception 'Motivo de handoff desconhecido: %', p_reason using errcode = 'P0001';
  end if;

  -- Porta. `auth.uid()` nulo = chamada do servidor (edge function / cron com
  -- service role), que é o caminho normal deste fluxo. Vindo do app, só quem
  -- opera o SDR: sem isto, qualquer autenticado devolvia lead alheio à roleta.
  if auth.uid() is not null and not public.has_any_role('admin','sdr','marketing') then
    raise exception 'Sem permissão para devolver a conversa do SDR à roleta.'
      using errcode = '42501';
  end if;

  select * into v_conv from public.sdr_conversations
  where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  if v_conv.status = 'handed_off' then
    return v_conv.handed_off_to;
  end if;

  select coalesce(a.handoff_group_id,
                  (select g.id from public.distribution_groups g
                   where g.kind = 'general' and g.active limit 1))
    into v_group
  from public.sdr_agents a where a.id = v_conv.agent_id;

  -- Sem agente na conversa o select acima não devolve linha nenhuma e v_group
  -- fica nulo: cai na fila geral do mesmo jeito.
  if v_group is null then
    select g.id into v_group from public.distribution_groups g
    where g.kind = 'general' and g.active limit 1;
  end if;

  -- Devolve o lead à fila do grupo alvo e roda a roleta. A etapa do funil só
  -- avança quando houve qualificação de verdade.
  update public.leads
     set distribution_group_id = coalesce(v_group, distribution_group_id),
         status                = 'queued',
         assigned_to           = null,
         assigned_at           = null,
         attend_deadline       = null,
         sdr_qualified_at      = case when p_reason = 'qualified' then now() else sdr_qualified_at end,
         funnel_stage          = case when p_reason = 'qualified' then 'qualified'::lead_funnel_stage else funnel_stage end,
         last_activity_at      = now()
   where id = v_conv.lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, detail)
  values (v_conv.lead_id, null, 'sdr_qualified',
          jsonb_build_object('conversation_id', p_conversation_id,
                             'reason', p_reason,
                             'score', v_conv.score,
                             'group_id', v_group));

  v_broker := public.assign_lead(v_conv.lead_id);

  update public.sdr_conversations
     set status        = 'handed_off',
         qualified_at  = case when p_reason = 'qualified' then coalesce(qualified_at, now()) else qualified_at end,
         handed_off_at = now(),
         handed_off_to = v_broker
   where id = p_conversation_id;

  return v_broker;
end;
$$;

revoke all on function public.sdr_handoff(uuid, text) from public, anon;
grant execute on function public.sdr_handoff(uuid, text) to authenticated, service_role;

comment on function public.sdr_handoff(uuid, text) is
  'Devolve o lead da conversa à roleta. p_reason = ''qualified'' (a IA qualificou) ou ''exhausted'' (teto de turnos). Só ''qualified'' avança o funil.';

-- -----------------------------------------------------------------------------
-- 4. Encadeamento de agentes sem ciclo
-- -----------------------------------------------------------------------------
create or replace function public.sdr_agents_no_handoff_cycle()
returns trigger
language plpgsql
as $$
declare
  v_next  uuid := new.handoff_to_agent_id;
  v_steps int  := 0;
begin
  while v_next is not null loop
    if v_next = new.id then
      raise exception 'Encadeamento em ciclo: o agente "%" voltaria para ele mesmo.', new.name
        using errcode = 'P0001';
    end if;
    v_steps := v_steps + 1;
    if v_steps > 50 then
      raise exception 'Encadeamento de handoff longo demais a partir de "%".', new.name
        using errcode = 'P0001';
    end if;
    select handoff_to_agent_id into v_next from public.sdr_agents where id = v_next;
  end loop;
  return new;
end;
$$;

drop trigger if exists sdr_agents_no_handoff_cycle on public.sdr_agents;
create trigger sdr_agents_no_handoff_cycle
  before insert or update of handoff_to_agent_id on public.sdr_agents
  for each row execute function public.sdr_agents_no_handoff_cycle();

-- -----------------------------------------------------------------------------
-- 5. A fila geral não sai pela tela
-- -----------------------------------------------------------------------------
create or replace function public.distribution_groups_protect_general()
returns trigger
language plpgsql
as $$
begin
  if old.kind = 'general' and not exists (
    select 1 from public.distribution_groups g
    where g.kind = 'general' and g.active and g.id <> old.id
  ) then
    raise exception 'A fila geral não pode ser excluída: é para ela que o lead volta quando o SDR qualifica sem grupo específico. Crie outra fila geral antes.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists distribution_groups_protect_general on public.distribution_groups;
create trigger distribution_groups_protect_general
  before delete on public.distribution_groups
  for each row execute function public.distribution_groups_protect_general();

-- -----------------------------------------------------------------------------
-- 6. O operador do SDR lê o lead da conversa que já enxerga
--
-- A policy de `leads` só alcança lead atribuído a perfil visível ou fila com
-- `leads.view_queue` — permissão que o papel `sdr` não tem. Resultado: a aba
-- Conversas não conseguia mostrar de quem era a conversa.
--
-- A função é SECURITY DEFINER de propósito: `sdr_conversations_select` consulta
-- `leads`, e uma policy de `leads` consultando `sdr_conversations` diretamente
-- fecharia o ciclo ("infinite recursion detected in policy"). Dentro da função,
-- dona das tabelas, a RLS não se aplica e a recursão não acontece.
-- -----------------------------------------------------------------------------
create or replace function public.lead_in_sdr_conversation(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.sdr_conversations c where c.lead_id = p_lead);
$$;

revoke all on function public.lead_in_sdr_conversation(uuid) from public, anon;
grant execute on function public.lead_in_sdr_conversation(uuid) to authenticated, service_role;

drop policy if exists leads_select_sdr on public.leads;
create policy leads_select_sdr on public.leads
  for select to authenticated
  using (
    public.has_any_role('admin','sdr','marketing')
    and public.lead_in_sdr_conversation(id)
  );
