-- =============================================================================
-- 0197 — renomear campanha na Meta e sincronização de hora em hora
--
-- Pedido do cliente em 03/10/2026: "no marketing atualize de hora em hora e me
-- permita alterar o nome da campanha".
--
-- 1. RENOMEAR passa pela mesma porta e pelo mesmo registro das outras ações
--    (meta_actions, marketing.meta_manage, quem pediu e quando). Nome não é
--    dinheiro nem mexe na fase de aprendizado: a ação nasce já 'executando'
--    (sem fila nem claim) e a edge `meta-campaign-action` encerra com o
--    meta_action_finish de sempre. O nome novo vai para `ad_campaigns` pela
--    edge, com a service role, só depois de a Meta aceitar.
-- 2. SINCRONIZAÇÃO: a completa (gasto, insights, estado da conta e alertas)
--    passa de uma vez às 06:00 para toda hora cheia. Ela já lê o estado da
--    conta, então o job só de estado (faceimob-meta-estado-conta) sai.
-- =============================================================================

alter table public.meta_actions drop constraint if exists meta_actions_acao_check;
alter table public.meta_actions
  add constraint meta_actions_acao_check check (acao in ('pausar', 'ativar', 'verba', 'renomear'));

alter table public.meta_actions add column if not exists nome_novo text;
alter table public.meta_actions drop constraint if exists meta_actions_nome_so_em_renomear;
alter table public.meta_actions
  add constraint meta_actions_nome_so_em_renomear check (
    (acao = 'renomear' and nome_novo is not null and length(btrim(nome_novo)) between 1 and 400)
    or (acao <> 'renomear' and nome_novo is null));

comment on column public.meta_actions.nome_novo is
  'Só em renomear: o nome pedido. O anterior fica em campaign_name (0197).';

create or replace function public.meta_action_renomear(p_campaign_id uuid, p_nome text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_chk  record;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_id   uuid;
  v_act  text;
begin
  if not public.has_permission('marketing.meta_manage') then
    raise exception 'Sem permissão para mexer em campanha na Meta (Gerenciar campanhas na Meta).'
      using errcode = '42501';
  end if;
  if length(v_nome) not between 1 and 400 then
    raise exception 'O nome da campanha precisa ter de 1 a 400 caracteres.' using errcode = '22023';
  end if;

  -- As travas de pausar (campanha sincronizada, conta ligada) valem igual aqui.
  select * into v_chk from public.meta_action_validar(p_campaign_id, 'pausar', null);
  if v_chk.o_name = v_nome then
    raise exception 'A campanha já tem esse nome.' using errcode = '22023';
  end if;
  select a.act_id into v_act from public.meta_ad_accounts a where a.id = v_chk.o_account_id;

  insert into public.meta_actions
    (account_id, campaign_id, campaign_external_id, campaign_name, origem, acao, nome_novo,
     status, requested_by, decided_by, decided_at, executed_at)
  values
    (v_chk.o_account_id, p_campaign_id, v_chk.o_external_id, v_chk.o_name, 'manual', 'renomear', v_nome,
     'executando', auth.uid(), auth.uid(), clock_timestamp(), clock_timestamp())
  returning id into v_id;

  return jsonb_build_object(
    'status', 'executando', 'action_id', v_id, 'campaign_external_id', v_chk.o_external_id,
    'act_id', v_act, 'nome_anterior', v_chk.o_name, 'nome_novo', v_nome);
end;
$$;

revoke all on function public.meta_action_renomear(uuid, text) from public, anon;
grant execute on function public.meta_action_renomear(uuid, text) to authenticated, service_role;
comment on function public.meta_action_renomear(uuid, text) is
  'Registra a troca de nome de uma campanha sincronizada (marketing.meta_manage) e devolve o que a edge meta-campaign-action precisa para mandar à Meta; ela encerra com meta_action_finish (0197).';

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0197] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-sync') then
      perform cron.unschedule('faceimob-meta-sync');
    end if;
    perform cron.schedule('faceimob-meta-sync', '0 * * * *', $cmd$select public.dispatch_meta_sync();$cmd$);
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-estado-conta') then
      perform cron.unschedule('faceimob-meta-estado-conta');
    end if;
  exception when others then
    raise warning '[0197] não foi possível agendar a sincronização de hora em hora: %', sqlerrm;
  end;
end
$do$;
