-- =============================================================================
-- 0117 · Estado da conta de anúncios, alertas da Meta e o resumo diário
--
-- O PEDIDO (F1.5, F1.6, F2.4): saber de verdade quando a conta para (sem saldo,
-- saldo baixo, bloqueada) e quando volta; avisar custo por resultado alto, gasto
-- sem lead e verba do mês; e mandar um resumo por WhatsApp toda manhã.
--
-- ESTADO DA CONTA (uma regra, uma função: `meta_classifica_conta`). `balance`
-- nunca entra: na Meta ele é valor A PAGAR, e o sistema antigo anunciava "sem
-- saldo" justamente quando não havia nada a pagar. O estado sai de status,
-- motivo de bloqueio, limite de gastos e saldo pré-pago, e só avisa na MUDANÇA.
--
-- ALERTAS (`meta_avaliar_alertas`). Números "segundo a Meta" só vêm de
-- `meta_metricas` (0115): aqui não se soma nem divide nada de novo. Cada alerta
-- tem uma `dedupe_key` que é única enquanto aberto (0116): avisa ao abrir, fecha
-- sozinho quando a condição some e não repete a cada sincronização.
--
-- FALHA NÃO VIRA AVISO DE SALDO. Se a última sincronização falhou, o estado da
-- conta e os alertas de número ficam como estavam: com dado velho, "a condição
-- sumiu" seria só falta de dado. Só o alerta `sync_falhou` abre, uma vez.
--
-- NINGUÉM ESCOLHE O DESTINO. Nenhuma função recebe telefone: o aviso vai para o
-- perfil (profile_id) e o notify-dispatch lê o telefone do perfil.
--
-- Idempotente: `create or replace` nas funções e o cron desagendado antes de
-- agendar. Nenhuma tabela nova: as colunas são da 0115 e da 0116.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O estado da conta — a regra da decisão (d), pura
-- -----------------------------------------------------------------------------
create or replace function public.meta_classifica_conta(
  p_status           int,
  p_disable_reason   int,
  p_is_prepay        boolean,
  p_prepay_available numeric,
  p_spend_cap        numeric,
  p_amount_spent     numeric,
  p_limite           numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_status is null then 'desconhecido'
    -- Desativada, em revisão ou encerrando; ou bloqueio que não é de pagamento.
    when p_status in (2, 7, 100, 101) or coalesce(p_disable_reason, 0) not in (0, 3) then 'bloqueada'
    -- Pagamento pendente, risco de pagamento, limite de gastos atingido ou
    -- pré-paga zerada. spend_cap = 0 na Meta é "sem limite".
    when p_status in (3, 8) or p_disable_reason = 3
         or (p_spend_cap > 0 and p_amount_spent >= p_spend_cap)
         or (p_is_prepay and p_prepay_available <= 0) then 'sem_saldo'
    -- Período de tolerância (ainda roda), ou pouco limite / pouco saldo.
    -- Pós-paga sem limite de gastos não tem saldo: nunca cai aqui por valor.
    when p_status = 9
         or (p_spend_cap > 0 and p_spend_cap - p_amount_spent < p_limite)
         or (p_is_prepay and p_prepay_available < p_limite) then 'saldo_baixo'
    else 'rodando'
  end;
$$;

comment on function public.meta_classifica_conta(int, int, boolean, numeric, numeric, numeric, numeric) is
  'Estado da conta de anúncios a partir dos campos crus da Meta (já em reais): bloqueada, sem_saldo, saldo_baixo, rodando, ou desconhecido sem leitura. Nunca usa balance (valor a pagar). p_limite = saldo_baixo_limite da conta. Única fonte da regra.';

-- -----------------------------------------------------------------------------
-- 2. Ajudantes internos: dinheiro em pt-BR, o título de cada alerta e o aviso
--    para quem cuida da conta
-- -----------------------------------------------------------------------------

-- `.` e `,` no padrão do to_char são literais (G e D é que seguem o locale do
-- servidor, que não é pt-BR): formata em inglês e troca os dois de lugar.
create or replace function public.meta_brl(p_valor numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_valor is null then '—'
    else 'R$ ' || translate(to_char(round(p_valor, 2), 'FM999,999,999,990.00'), ',.', '.,')
  end;
$$;

-- O mesmo nome no WhatsApp, no sino e no resumo. O custo por resultado leva
-- "segundo a Meta" porque o CPL da tela é o do CRM, e são números diferentes.
create or replace function public.meta_alerta_titulo(p_kind text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'cpl_alto'           then 'Custo por resultado (segundo a Meta) acima do limite'
    when 'gasto_sem_lead'     then 'Gasto sem lead'
    when 'verba_mes_aviso'    then 'Verba do mês perto do fim'
    when 'verba_mes_esgotada' then 'Verba do mês esgotada'
    when 'sync_falhou'        then 'A sincronização com a Meta falhou'
    else p_kind
  end;
$$;

-- Sino e WhatsApp para quem cuida das campanhas: administrador, sócio e
-- marketing. O `group by` não é enfeite: papel é acumulável (a sócia que também
-- é marketing receberia duas linhas iguais), mesmo cuidado da 0083.
create or replace function public.meta_notificar(p_kind text, p_titulo text, p_corpo text)
returns int
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_titulo text := left(p_titulo, 200);
  v_n      int;
begin
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select d.profile_id,
         p_kind,
         v_titulo,
         -- O notify-dispatch manda "título + corpo" e o template corta em 1.024.
         left(p_corpo, greatest(0, 998 - length(v_titulo))),
         '/marketing',
         c.canal
    from (
      select ur.profile_id
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role in ('admin', 'partner', 'marketing')
       group by ur.profile_id
    ) d
    cross join (values ('in_app'::notification_channel), ('whatsapp'::notification_channel)) as c(canal);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Avaliar a conta: estado, alertas, avisos
-- -----------------------------------------------------------------------------
create or replace function public.meta_avaliar_alertas(p_account_id uuid, p_so_estado boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_conta       public.meta_ad_accounts;
  v_nome        text;
  v_run_status  text;
  v_run_erro    text;
  v_run_quando  timestamptz;
  v_estado      text;
  v_problema    text[] := array['sem_saldo', 'saldo_baixo', 'bloqueada'];
  v_tz          text;
  v_hoje        date;
  v_dias        int;
  v_claims      text;
  v_disparados  jsonb;
  v_novos       jsonb;
  v_msg         text;
  v_n_novos     int := 0;
  v_n_resolv    int := 0;
  v_n           int;
begin
  -- A trava da linha põe em fila a sincronização e o "salvar limites" da mesma
  -- conta: sem ela, as duas veriam a mesma transição e avisariam duas vezes.
  select * into v_conta from public.meta_ad_accounts where id = p_account_id for update;
  if not found then
    raise exception 'Conta de anúncios não encontrada.' using errcode = '22023';
  end if;
  v_nome := coalesce(v_conta.name, v_conta.act_id);

  select r.status, r.error, coalesce(r.finished_at, r.started_at)
    into v_run_status, v_run_erro, v_run_quando
    from public.meta_sync_runs r
   where r.account_id = p_account_id and r.status <> 'rodando'
   order by r.started_at desc
   limit 1;

  -- 3a. Estado da conta. No modo só-estado quem chama acabou de ler a conta na
  --     Meta; no modo completo, só se a última sincronização não falhou.
  v_estado := v_conta.balance_state;
  if p_so_estado or v_run_status is distinct from 'falhou' then
    v_estado := public.meta_classifica_conta(
      v_conta.account_status, v_conta.disable_reason, v_conta.is_prepay, v_conta.prepay_available,
      v_conta.spend_cap, v_conta.amount_spent, v_conta.saldo_baixo_limite);

    if v_estado is distinct from v_conta.balance_state then
      update public.meta_ad_accounts
         set balance_state = v_estado, balance_state_changed_at = clock_timestamp()
       where id = p_account_id;

      if v_estado = any (v_problema) or (v_estado = 'rodando' and v_conta.balance_state = any (v_problema)) then
        perform public.meta_notificar(
          'meta_conta_estado',
          case v_estado
            when 'sem_saldo'   then format('Conta de anúncios sem saldo: %s', v_nome)
            when 'saldo_baixo' then format('Saldo baixo na conta de anúncios %s', v_nome)
            when 'bloqueada'   then format('Conta de anúncios bloqueada: %s', v_nome)
            else format('A conta de anúncios %s voltou a rodar', v_nome)
          end,
          -- Fatos, não a regra de novo: o que a Meta disse e quando.
          concat_ws(' ',
            case v_estado
              when 'sem_saldo'   then 'Os anúncios pararam por falta de saldo ou de pagamento.'
              when 'saldo_baixo' then 'Os anúncios ainda rodam, mas o saldo ou o limite de gastos está no fim, ou a Meta deu prazo de tolerância para o pagamento.'
              when 'bloqueada'   then 'A Meta desativou ou bloqueou a conta: os anúncios só voltam depois de resolver no Gerenciador de Anúncios.'
              else 'Os anúncios voltaram a ser veiculados.'
            end,
            format('Status na Meta: %s.', case v_conta.account_status
              when 1 then 'ativa' when 2 then 'desativada' when 3 then 'pagamento pendente'
              when 7 then 'em revisão pela Meta' when 8 then 'acerto pendente'
              when 9 then 'em período de tolerância' when 100 then 'encerrando' when 101 then 'encerrada'
              else 'código ' || v_conta.account_status end),
            case when coalesce(v_conta.disable_reason, 0) <> 0
                 then format('Motivo de bloqueio informado pela Meta: código %s.', v_conta.disable_reason) end,
            case when v_conta.spend_cap > 0
                 then format('Limite de gastos: %s usados de %s.',
                             public.meta_brl(v_conta.amount_spent), public.meta_brl(v_conta.spend_cap)) end,
            case when v_conta.is_prepay and v_conta.prepay_available is not null
                 then format('Saldo pré-pago: %s.', public.meta_brl(v_conta.prepay_available)) end,
            format('Verificado em %s.',
                   to_char(coalesce(v_conta.account_checked_at, clock_timestamp()) at time zone 'America/Sao_Paulo',
                           'DD/MM "às" HH24:MI'))));
      end if;
    end if;
  end if;

  if p_so_estado then
    return jsonb_build_object(
      'estado_conta', v_estado,
      'abertos', (select count(*) from public.meta_alerts where account_id = p_account_id and resolved_at is null),
      'novos', 0,
      'resolvidos', 0);
  end if;

  -- 3b. Sincronização que falhou: abre UM alerta, e nada mais se mexe.
  if v_run_status = 'falhou' then
    insert into public.meta_alerts (account_id, kind, dedupe_key, mensagem, notified_at)
    values (
      p_account_id, 'sync_falhou', 'sync_falhou:' || p_account_id,
      format('%s na conta %s em %s: %s. %s',
             public.meta_alerta_titulo('sync_falhou'), v_nome,
             to_char(v_run_quando at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
             coalesce(nullif(btrim(v_run_erro), ''), 'sem motivo informado'),
             case when v_conta.last_sync_ok_at is null
                  then 'A conta ainda não teve sincronização boa: não há números da Meta dela.'
                  else format('Os números mostrados continuam os da última sincronização boa, em %s.',
                              to_char(v_conta.last_sync_ok_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'))
             end),
      clock_timestamp())
    on conflict (dedupe_key) where resolved_at is null do nothing
    returning mensagem into v_msg;

    -- Segunda falha seguida: o alerta já está aberto e ninguém é avisado de novo.
    if v_msg is not null then
      v_n_novos := 1;
      perform public.meta_notificar('meta_sync_falhou',
        format('%s: %s', public.meta_alerta_titulo('sync_falhou'), v_nome), v_msg);
    end if;

    return jsonb_build_object(
      'estado_conta', v_estado,
      'abertos', (select count(*) from public.meta_alerts where account_id = p_account_id and resolved_at is null),
      'novos', v_n_novos,
      'resolvidos', 0);
  end if;

  update public.meta_alerts
     set resolved_at = clock_timestamp()
   where account_id = p_account_id and kind = 'sync_falhou' and resolved_at is null;
  get diagnostics v_n_resolv = row_count;

  -- 3c. O que dispara agora. "Hoje" no fuso da conta, o mesmo dos insights.
  v_tz := coalesce(nullif(v_conta.timezone_name, ''), 'America/Sao_Paulo');
  begin
    v_hoje := (now() at time zone v_tz)::date;
  exception when invalid_parameter_value then
    v_tz   := 'America/Sao_Paulo';
    v_hoje := (now() at time zone v_tz)::date;
  end;
  v_dias := coalesce(v_conta.gasto_sem_lead_dias, 3);

  -- meta_metricas confere reports.view_finance ou service_role pelo JWT, e o
  -- pg_cron e o "salvar limites" não trazem o JWT da service role. Esta função
  -- só é executável pela service role (e pelos definers desta migration): o
  -- claim vale só para a leitura abaixo e volta ao que era.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
    into v_disparados
    from (
      -- Custo por resultado no canal da campanha, 7 dias, só com resultado.
      select 'cpl_alto'::text                  as kind,
             m.campaign_id                     as campaign_id,
             'cpl_alto:' || m.campaign_id      as dedupe_key,
             m.custo_por_resultado             as valor,
             v_conta.cpl_limite                as limite,
             format('%s: %s em %s nos últimos 7 dias, com %s resultado(s); o limite é %s. O CPL do CRM é outro número.',
                    public.meta_alerta_titulo('cpl_alto'), public.meta_brl(m.custo_por_resultado), m.name,
                    m.resultados, public.meta_brl(v_conta.cpl_limite)) as mensagem
        from public.meta_metricas(v_hoje - 6, v_hoje) m
       where m.account_id = p_account_id
         and v_conta.cpl_limite > 0
         and m.resultados > 0
         and m.custo_por_resultado > v_conta.cpl_limite

      union all

      -- Gasto sem lead: NEM a Meta (formulário, conversa ou pixel) NEM o CRM
      -- viram lead. Uma fonte só dá alarme falso: WhatsApp não gera lead no CRM
      -- e LP sem pixel não gera resultado na Meta.
      select 'gasto_sem_lead',
             m.campaign_id,
             'gasto_sem_lead:' || m.campaign_id,
             m.spend,
             v_conta.gasto_sem_lead_limite,
             format('%s: %s em %s nos últimos %s dias, sem lead no CRM e sem resultado na Meta; o limite é %s.',
                    public.meta_alerta_titulo('gasto_sem_lead'), public.meta_brl(m.spend), m.name, v_dias,
                    public.meta_brl(v_conta.gasto_sem_lead_limite))
        from public.meta_metricas(v_hoje - (v_dias - 1), v_hoje) m
       where m.account_id = p_account_id
         and v_conta.gasto_sem_lead_limite > 0
         and m.spend >= v_conta.gasto_sem_lead_limite
         and m.leads_form + m.conversations + m.lp_leads = 0
         and not exists (
           select 1 from public.leads l
            where l.campaign_id = m.external_id
              and l.created_at >= (v_hoje - (v_dias - 1))::timestamp at time zone v_tz)

      union all

      -- Verba do mês: aviso no percentual e de novo em 100%. Com o mês sincronizado
      -- só em parte, o texto diz desde quando e não chama a soma de total do mês.
      select k.kind,
             null::uuid,
             k.kind || ':' || p_account_id,
             g.gasto,
             v_conta.verba_mensal,
             format('%s na conta %s: %s, %s%% da verba de %s.',
                    public.meta_alerta_titulo(k.kind), v_nome,
                    case when g.desde > date_trunc('month', v_hoje)::date
                         then format('dados desde %s (o mês não está todo sincronizado); só desde então já são %s gastos segundo a Meta',
                                     to_char(g.desde, 'DD/MM'), public.meta_brl(g.gasto))
                         else format('%s gastos no mês segundo a Meta', public.meta_brl(g.gasto))
                    end,
                    floor(g.gasto * 100 / v_conta.verba_mensal)::int,
                    public.meta_brl(v_conta.verba_mensal))
        from (
          select sum(m.spend) as gasto, min(m.cobertura_desde) as desde
            from public.meta_metricas(date_trunc('month', v_hoje)::date, v_hoje) m
           where m.account_id = p_account_id
        ) g
        cross join lateral (values
          ('verba_mes_aviso',    v_conta.verba_mensal * coalesce(v_conta.verba_aviso_pct, 85) / 100.0),
          ('verba_mes_esgotada', v_conta.verba_mensal)) as k(kind, gatilho)
       where v_conta.verba_mensal > 0
         and g.gasto >= k.gatilho
    ) f;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- 3d. Abre o que disparou e não estava aberto (o índice único é o dedupe).
  with novos as (
    insert into public.meta_alerts (account_id, campaign_id, kind, dedupe_key, valor, limite, mensagem, notified_at)
    select p_account_id, f.campaign_id, f.kind, f.dedupe_key, f.valor, f.limite, f.mensagem, clock_timestamp()
      from jsonb_to_recordset(v_disparados)
        as f(kind text, campaign_id uuid, dedupe_key text, valor numeric, limite numeric, mensagem text)
    on conflict (dedupe_key) where resolved_at is null do nothing
    returning kind, mensagem
  )
  select count(*)::int, jsonb_agg(jsonb_build_object('kind', kind, 'mensagem', mensagem))
    into v_n_novos, v_novos
    from novos;

  -- O que continua aberto mostra o número de hoje, sem avisar de novo.
  update public.meta_alerts al
     set valor = f.valor, limite = f.limite, mensagem = f.mensagem
    from jsonb_to_recordset(v_disparados) as f(dedupe_key text, valor numeric, limite numeric, mensagem text)
   where al.dedupe_key = f.dedupe_key
     and al.resolved_at is null
     and (al.valor, al.limite, al.mensagem) is distinct from (f.valor, f.limite, f.mensagem);

  -- Fecha o que parou de disparar.
  update public.meta_alerts al
     set resolved_at = clock_timestamp()
   where al.account_id = p_account_id
     and al.resolved_at is null
     and al.kind in ('cpl_alto', 'gasto_sem_lead', 'verba_mes_aviso', 'verba_mes_esgotada')
     and not exists (select 1 from jsonb_to_recordset(v_disparados) as f(dedupe_key text)
                      where f.dedupe_key = al.dedupe_key);
  get diagnostics v_n = row_count;
  v_n_resolv := v_n_resolv + v_n;

  -- Um aviso por pessoa com tudo o que abriu agora, não um por alerta.
  if v_n_novos > 0 then
    perform public.meta_notificar(
      'meta_alerta',
      case when v_n_novos = 1
           then format('%s: %s', public.meta_alerta_titulo(v_novos #>> '{0,kind}'), v_nome)
           else format('%s alertas novos da Meta na conta %s', v_n_novos, v_nome)
      end,
      (select string_agg(x->>'mensagem', E'\n') from jsonb_array_elements(v_novos) as x));
  end if;

  return jsonb_build_object(
    'estado_conta', v_estado,
    'abertos', (select count(*) from public.meta_alerts where account_id = p_account_id and resolved_at is null),
    'novos', v_n_novos,
    'resolvidos', v_n_resolv);
end;
$$;

comment on function public.meta_avaliar_alertas(uuid, boolean) is
  'Avalia uma conta e devolve {estado_conta, abertos, novos, resolvidos}. Service role. p_so_estado = false (padrão, chamado pelo meta-sync depois de meta_sync_apply ou meta_sync_finish): recalcula o estado (se a última sincronização não falhou) e abre/fecha cpl_alto, gasto_sem_lead, verba_mes_aviso, verba_mes_esgotada e sync_falhou; com a última sincronização falhada, só abre sync_falhou e o resto fica como estava. p_so_estado = true (cron leve de hora em hora da frente de sincronização): o chamador grava ANTES em meta_ad_accounts os campos crus lidos agora na Meta (account_status, disable_reason, is_prepay, amount_spent, spend_cap, prepay_available, account_checked_at) e chama só se a leitura deu certo; recalcula o estado e avisa a transição (sem saldo, saldo baixo, bloqueada, voltou a rodar), sem tocar em alertas. Avisa na abertura: sino e WhatsApp para administrador, sócio e marketing, link /marketing.';

-- -----------------------------------------------------------------------------
-- 4. Limites dos alertas — marketing.meta_manage (trava no banco; a tela repete)
-- -----------------------------------------------------------------------------
create or replace function public.meta_account_thresholds_set(
  p_account_id            uuid,
  p_cpl_limite            numeric,
  p_gasto_sem_lead_limite numeric,
  p_gasto_sem_lead_dias   int,
  p_verba_mensal          numeric,
  p_verba_aviso_pct       int,
  p_saldo_baixo_limite    numeric)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('marketing.meta_manage') then
    raise exception 'Sem permissão para mudar os limites dos alertas (Gerenciar campanhas na Meta).'
      using errcode = '42501';
  end if;
  if p_gasto_sem_lead_dias is null or p_gasto_sem_lead_dias not between 1 and 30 then
    raise exception 'Gasto sem lead: a janela vai de 1 a 30 dias.' using errcode = '22023';
  end if;
  if p_verba_aviso_pct is null or p_verba_aviso_pct not between 50 and 100 then
    raise exception 'Verba do mês: o aviso vai de 50%% a 100%% da verba.' using errcode = '22023';
  end if;
  if least(p_cpl_limite, p_gasto_sem_lead_limite, p_verba_mensal, p_saldo_baixo_limite) < 0 then
    raise exception 'Os limites em reais não podem ser negativos (vazio desliga o alerta).' using errcode = '22023';
  end if;

  update public.meta_ad_accounts
     set cpl_limite            = round(p_cpl_limite, 2),
         gasto_sem_lead_limite = round(p_gasto_sem_lead_limite, 2),
         gasto_sem_lead_dias   = p_gasto_sem_lead_dias,
         verba_mensal          = round(p_verba_mensal, 2),
         verba_aviso_pct       = p_verba_aviso_pct,
         saldo_baixo_limite    = round(p_saldo_baixo_limite, 2)
   where id = p_account_id;
  if not found then
    raise exception 'Conta de anúncios não encontrada.' using errcode = '22023';
  end if;

  -- O limite novo vale já: sem isto, o alerta que ele abre ou fecha esperaria a
  -- sincronização de amanhã, e a tela mostraria o estado do limite antigo.
  perform public.meta_avaliar_alertas(p_account_id);
end;
$$;

comment on function public.meta_account_thresholds_set(uuid, numeric, numeric, int, numeric, int, numeric) is
  'Grava os limites dos alertas de uma conta e reavalia na hora. Exige marketing.meta_manage (42501). Valor em reais nulo desliga o alerta; dias de 1 a 30 e aviso de verba de 50 a 100% (22023).';

-- -----------------------------------------------------------------------------
-- 5. Resumo diário por WhatsApp — administrador, sócio e diretor
-- -----------------------------------------------------------------------------
create or replace function public.meta_enfileirar_resumo_diario()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje       date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ontem      date := v_hoje - 1;
  v_inicio     timestamptz := v_hoje::timestamp at time zone 'America/Sao_Paulo';
  v_contas     uuid[];
  v_ok_min     timestamptz;
  v_nunca      boolean;
  v_claims     text;
  v_gasto      numeric;
  v_result     int;
  v_qualif     int;
  v_melhor     text;
  v_melhor_cpr numeric;
  v_pior       text;
  v_pior_cpr   numeric;
  v_leads      int;
  v_abertos    int;
  v_titulos    text;
  v_titulo     text;
  v_corpo      text;
  v_n          int;
begin
  -- Cron chamado duas vezes ao mesmo tempo não manda dois resumos.
  perform pg_advisory_xact_lock(hashtext('meta_enfileirar_resumo_diario'));

  select array_agg(a.id), min(a.last_sync_ok_at), bool_or(a.last_sync_ok_at is null)
    into v_contas, v_ok_min, v_nunca
    from public.meta_ad_accounts a
   where a.enabled;
  if v_contas is null then
    return 0;
  end if;

  -- Mesma razão do claim em meta_avaliar_alertas: o pg_cron não traz JWT.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select coalesce(sum(m.spend), 0),
         coalesce(sum(m.resultados), 0)::int,
         count(*) filter (where m.spend >= 20 and m.custo_por_resultado is not null)::int
    into v_gasto, v_result, v_qualif
    from public.meta_metricas(v_ontem, v_ontem) m
   where m.account_id = any (v_contas);

  select m.name, m.custo_por_resultado into v_melhor, v_melhor_cpr
    from public.meta_metricas(v_ontem, v_ontem) m
   where m.account_id = any (v_contas) and m.spend >= 20 and m.custo_por_resultado is not null
   order by m.custo_por_resultado, m.spend desc
   limit 1;

  select m.name, m.custo_por_resultado into v_pior, v_pior_cpr
    from public.meta_metricas(v_ontem, v_ontem) m
   where m.account_id = any (v_contas) and m.spend >= 20 and m.custo_por_resultado is not null
   order by m.custo_por_resultado desc, m.spend desc
   limit 1;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- Lead do CRM de ontem nas campanhas dessas contas (o mesmo casamento do
  -- painel: leads.campaign_id = ad_campaigns.external_id).
  select count(*)::int into v_leads
    from public.leads l
   where l.created_at >= v_ontem::timestamp at time zone 'America/Sao_Paulo'
     and l.created_at <  v_inicio
     and exists (select 1 from public.ad_campaigns c
                  where c.external_id = l.campaign_id and c.meta_account_id = any (v_contas));

  select count(*)::int into v_abertos
    from public.meta_alerts al
   where al.account_id = any (v_contas) and al.resolved_at is null;

  select string_agg(x.t, '; ') into v_titulos
    from (
      select public.meta_alerta_titulo(al.kind) || coalesce(' (' || c.name || ')', '') as t
        from public.meta_alerts al
        left join public.ad_campaigns c on c.id = al.campaign_id
       where al.account_id = any (v_contas) and al.resolved_at is null
       order by al.opened_at desc
       limit 3
    ) x;

  v_titulo := format('Resumo da Meta de ontem (%s)', to_char(v_ontem, 'DD/MM'));
  v_corpo := concat_ws(E'\n',
    -- Falha aparece como falha, com a data dos números: nunca número velho
    -- apresentado como de ontem.
    nullif(concat_ws(' ',
      case when v_ok_min < v_inicio
           then format('A sincronização de hoje falhou; números até %s.',
                       to_char(v_ok_min at time zone 'America/Sao_Paulo', 'DD/MM')) end,
      case when v_nunca
           then 'Há conta de anúncios que nunca sincronizou com a Meta; ela fica fora destes números.' end), ''),
    format('Gasto: %s.', public.meta_brl(v_gasto)),
    format('Leads no CRM: %s. Resultados segundo a Meta: %s.', v_leads, v_result),
    format('CPL do CRM: %s.',
           case when v_leads > 0 then public.meta_brl(v_gasto / v_leads) else 'sem lead no CRM' end),
    case when v_melhor is not null
         then format('Melhor custo por resultado (campanhas com gasto a partir de R$ 20): %s, %s.',
                     v_melhor, public.meta_brl(v_melhor_cpr)) end,
    case when v_qualif >= 2
         then format('Pior: %s, %s.', v_pior, public.meta_brl(v_pior_cpr)) end,
    case when v_abertos = 0 then 'Nenhum alerta aberto.'
         else format('Alertas abertos: %s. %s%s', v_abertos, v_titulos, case when v_abertos > 3 then '; …' else '.' end)
    end);
  -- O notify-dispatch manda "título + corpo" e o template corta em 1.024.
  v_corpo := left(v_corpo, 998 - length(v_titulo));

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select d.profile_id, 'meta_resumo_diario', v_titulo, v_corpo, '/marketing', 'whatsapp'
    from (
      select ur.profile_id
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role in ('admin', 'partner', 'director')
       group by ur.profile_id
    ) d
   where not exists (
     select 1 from public.notifications n
      where n.profile_id = d.profile_id
        and n.kind = 'meta_resumo_diario'
        and n.created_at >= v_inicio);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.meta_enfileirar_resumo_diario() is
  'Enfileira o resumo de ontem por WhatsApp (kind meta_resumo_diario) para administrador, sócio e diretor ativos, um por pessoa por dia (São Paulo): gasto, leads do CRM, resultados segundo a Meta, CPL do CRM, melhor e pior custo por resultado entre campanhas com gasto a partir de R$ 20 e alertas abertos. Com a última sincronização boa antes de hoje, começa com o aviso de falha e a data dos números. Até 1.000 caracteres. Retorna 0 sem conta ligada. Service role e pg_cron.';

-- -----------------------------------------------------------------------------
-- 6. Grants
--
-- A 0023 concede EXECUTE de função nova a `authenticated` por default
-- privileges: as internas e as de service role precisam do revoke explícito.
-- -----------------------------------------------------------------------------
revoke all on function public.meta_classifica_conta(int, int, boolean, numeric, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.meta_classifica_conta(int, int, boolean, numeric, numeric, numeric, numeric)
  to service_role;

revoke all on function public.meta_brl(numeric)                 from public, anon, authenticated, service_role;
revoke all on function public.meta_alerta_titulo(text)          from public, anon, authenticated, service_role;
revoke all on function public.meta_notificar(text, text, text)  from public, anon, authenticated, service_role;

revoke all on function public.meta_avaliar_alertas(uuid, boolean)   from public, anon, authenticated;
revoke all on function public.meta_enfileirar_resumo_diario()       from public, anon, authenticated;
grant execute on function public.meta_avaliar_alertas(uuid, boolean) to service_role;
grant execute on function public.meta_enfileirar_resumo_diario()     to service_role;

revoke all on function public.meta_account_thresholds_set(uuid, numeric, numeric, int, numeric, int, numeric)
  from public, anon;
grant execute on function public.meta_account_thresholds_set(uuid, numeric, numeric, int, numeric, int, numeric)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Agendamento: 11:00 UTC = 08:00 em São Paulo (UTC-3 o ano todo), depois da
--    sincronização das 06:00. Só SQL: a entrega é do faceimob-notify-dispatch.
--    Falha de agendamento vira aviso, não derruba a migration (0083).
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0117] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-resumo-diario') then
      perform cron.unschedule('faceimob-meta-resumo-diario');
    end if;
    perform cron.schedule(
      'faceimob-meta-resumo-diario',
      '0 11 * * *',
      $cmd$select public.meta_enfileirar_resumo_diario();$cmd$
    );
    raise notice '[0117] resumo diário da Meta agendado para 08:00 em São Paulo.';
  exception when others then
    raise warning '[0117] não foi possível agendar o resumo diário da Meta: %', sqlerrm;
  end;
end
$do$;
