-- =============================================================================
-- 0181 · Administrador/sócio sem trava operacional e Esteira Ágil na coluna certa
--
-- 1. O editor do negócio já libera administrador e sócio, mas o gatilho antigo
--    da CCA ainda recusava a troca do Status 2 enquanto o caso estava em análise.
--    A exceção passa a usar `is_admin()` (admin OU partner), sem liberar os
--    rótulos de sistema: "ESTEIRA AGIL" continua sendo escrito somente pelo
--    envio real, para não forjar uma entrada na esteira.
-- 2. Um caso cujo negócio está em "13. ESTEIRA AGIL" deve aparecer na coluna
--    editável "ESTEIRA ÁGIL", mesmo se guardar um `stage_id` histórico de antes
--    da reorganização. Corrigimos os existentes sem inventar movimento/tempo e
--    roteamos os próximos envios para essa coluna quando ela existir.
-- 3. Arrastar no front continua chamando `move_cca_case`: a mensagem obrigatória,
--    o comentário, o histórico e os avisos permanecem numa única transação.
-- =============================================================================

create or replace function public.deals_guard_esteira_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new     text := public.deal_status_bare(new.status_detail);
  v_old     text := case when tg_op = 'UPDATE' then public.deal_status_bare(old.status_detail) else '' end;
  v_priv    boolean := current_user in ('postgres', 'service_role');
  v_sistema constant text[] := array['ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANÁLISE P/ VIRAR NEGÓCIO'];
begin
  if tg_op = 'UPDATE' and new.status_detail is not distinct from old.status_detail then
    return new;
  end if;

  if v_priv then
    return new;
  end if;

  -- Continua sendo rótulo de sistema, inclusive para administrador e sócio.
  -- A exceção administrativa é para ATUAR no negócio, não para simular envio.
  if v_new = any (v_sistema) then
    raise exception
      'O rótulo "%" é escrito pelo sistema quando o negócio entra na esteira. Aprove a conferência documental em vez de marcá-lo.',
      new.status_detail
      using errcode = '42501';
  end if;

  -- Corretor, gerente, diretor e CCA continuam respeitando a decisão do caso.
  -- Administrador e sócio podem corrigir/concluir o negócio durante a análise.
  if tg_op = 'UPDATE'
     and not public.is_admin()
     and v_new not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF')
     and exists (
       select 1 from public.cca_cases c
         left join public.cca_stages s on s.id = c.stage_id
         left join public.deal_statuses ds on ds.id = s.deal_status_id
        where c.deal_id = new.id
          and c.status in ('under_review', 'pending_documents')
          and (v_old = any (v_sistema)
               or (ds.value is not null and public.deal_status_bare(ds.value) = v_old))
     ) then
    raise exception
      'O negócio está na esteira de crédito: o Status 2 volta a ser editável quando o CCA decidir o caso.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.deals_guard_esteira_label() is
  'Protege os rótulos de envio e trava o Status 2 durante análise para perfis operacionais; administrador e sócio podem corrigir o negócio sem aguardar a decisão da CCA (0181).';

-- Chave de comparação para nomes configuráveis da CCA. A extensão unaccent não
-- é pressuposta: `translate` cobre os acentos usados nos rótulos em português.
create or replace function public.cca_stage_name_key(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select translate(
    public.deal_status_bare(p_name),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'AAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

revoke all on function public.cca_stage_name_key(text) from public, anon;
grant execute on function public.cca_stage_name_key(text) to authenticated, service_role;

create or replace function public.cca_cases_route_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_route text;
  v_stage uuid;
begin
  -- Só a entrada/reentrada oficial. Movimento manual continua obedecendo
  -- exatamente à coluna escolhida em `move_cca_case`.
  if new.status <> 'under_review'
     or (tg_op = 'UPDATE' and new.submitted_at is not distinct from old.submitted_at) then
    return new;
  end if;

  select case
           when public.cca_stage_name_key(d.status_detail) = 'ESTEIRA AGIL'
                or d.review_esteira = 'agil' then 'ESTEIRA AGIL'
           when public.cca_stage_name_key(d.status_detail) = 'ANALISE P/ VIRAR NEGOCIO'
                or d.review_esteira = 'virar' then 'ANALISE P/ VIRAR NEGOCIO'
         end
    into v_route
    from public.deals d
   where d.id = new.deal_id;

  if v_route is null then
    return new;
  end if;

  select s.id into v_stage
    from public.cca_stages s
   where s.active and public.cca_stage_name_key(s.name) = v_route
   order by s.position, s.id
   limit 1;

  if v_stage is not null then
    new.stage_id := v_stage;
  end if;
  return new;
end;
$$;

revoke all on function public.cca_cases_route_submission() from public, anon, authenticated;

drop trigger if exists cca_cases_route_submission on public.cca_cases;
create trigger cca_cases_route_submission
  before insert or update of status, submitted_at on public.cca_cases
  for each row execute function public.cca_cases_route_submission();

comment on function public.cca_cases_route_submission() is
  'Na entrada oficial da CCA, direciona cada esteira para a coluna homônima configurada; não interfere nos movimentos com comentário (0181).';

-- Corrige somente os casos existentes que ainda têm o rótulo de entrada Ágil.
-- Não é um movimento de operador: preserva relógio, updated_at, Status 2 e
-- histórico. Os ALTERs e o UPDATE são transacionais; uma falha desfaz tudo.
do $$
declare
  v_stage uuid;
begin
  select s.id into v_stage
    from public.cca_stages s
   where s.active and public.cca_stage_name_key(s.name) = 'ESTEIRA AGIL'
   order by s.position, s.id
   limit 1;

  if v_stage is null then
    return;
  end if;

  alter table public.cca_cases disable trigger cca_cases_set_updated_at;
  alter table public.cca_cases disable trigger cca_cases_track_stage_entry;
  alter table public.cca_cases disable trigger cca_cases_sync_esteira_label;
  alter table public.cca_cases disable trigger cca_cases_log;

  update public.cca_cases c
     set stage_id = v_stage
    from public.deals d
   where d.id = c.deal_id
     and c.status = 'under_review'
     and c.stage_id is distinct from v_stage
     and public.cca_stage_name_key(d.status_detail) = 'ESTEIRA AGIL';

  alter table public.cca_cases enable trigger cca_cases_log;
  alter table public.cca_cases enable trigger cca_cases_sync_esteira_label;
  alter table public.cca_cases enable trigger cca_cases_track_stage_entry;
  alter table public.cca_cases enable trigger cca_cases_set_updated_at;
end;
$$;

