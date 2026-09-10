-- =============================================================================
-- 0038 — O Diário grava o que a tela pede e devolve o mês que a tela promete
--
-- Quatro achados da auditoria de 01/09, todos no mesmo par de RPCs:
--
--  1. "Gerente" era obrigatório na tela e não chegava ao banco. `submitted_by`
--     é uuid de profile, e o link anônimo não tem identidade — a coluna certa
--     é um texto, como no schema antigo (`filled_by_name`).
--  2. "Observações do dia" era digitada e descartada: `daily_reports.notes`
--     existia desde a 0009 e nenhum caminho a preenchia.
--  3. A tela aceita meio ponto (0,5 venda = venda dividida entre dois
--     corretores, o mesmo rateio que o pipeline faz) e o banco recusava com
--     22P02, perdendo o lançamento da equipe inteira. As 8 métricas passam a
--     `numeric(6,1)` com passo de 0,5 imposto por constraint — a regra mora no
--     banco, não em cada cliente.
--  4. "Funil do mês", "Totais do mês" e o Histórico só enxergavam `current_date`:
--     a RPC não devolvia nada do resto do mês e a tela pintava todo dia anterior
--     como "Não preenchido". Passa a devolver `month` (mapa data → checkpoint)
--     e `today_date`, porque o banco está em UTC e é ele quem decide que dia é
--     "hoje" — a tela só conhece a data do navegador.
--
-- A assinatura de `public_daily_submit` muda: `create or replace` não adiciona
-- parâmetro, e um overload de 3 args ao lado do de 5 vira "function is not
-- unique" para quem chama com 3. Então é drop + create, e o grant para `anon`
-- volta explícito (a 0019 revoga EXECUTE de função nova por default). A chamada
-- com 3 argumentos continua resolvendo pelos defaults.
--
-- O que NÃO muda: a superfície anônima segue sendo exatamente três RPCs; a
-- recusa continua sendo NULL (0034), nunca exceção; `today` continua no retorno
-- de `public_daily_team` (tests/11 e o front em produção leem essa chave).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quem preencheu
-- -----------------------------------------------------------------------------
alter table public.daily_reports
  add column if not exists filled_by_name text;

comment on column public.daily_reports.filled_by_name is
  'Nome digitado no link público. submitted_by fica para lançamentos com sessão.';

-- -----------------------------------------------------------------------------
-- 2. Meio ponto
--
-- Idempotente: só converte o que ainda é integer. Os checks `>= 0` da 0009
-- sobrevivem à troca de tipo; o passo de 0,5 entra como uma constraint só.
-- -----------------------------------------------------------------------------
do $$
declare
  col text;
begin
  foreach col in array array[
    'leads', 'calls', 'doc_collections', 'visits_scheduled',
    'visits_done', 'analyses_sent', 'analyses_approved', 'sales'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'daily_entries'
        and column_name = col and data_type = 'integer'
    ) then
      execute format('alter table public.daily_entries alter column %I type numeric(6,1)', col);
    end if;
  end loop;
end
$$;

alter table public.daily_entries drop constraint if exists daily_entries_half_steps;
alter table public.daily_entries add constraint daily_entries_half_steps check (
      leads             * 2 = trunc(leads             * 2)
  and calls             * 2 = trunc(calls             * 2)
  and doc_collections   * 2 = trunc(doc_collections   * 2)
  and visits_scheduled  * 2 = trunc(visits_scheduled  * 2)
  and visits_done       * 2 = trunc(visits_done       * 2)
  and analyses_sent     * 2 = trunc(analyses_sent     * 2)
  and analyses_approved * 2 = trunc(analyses_approved * 2)
  and sales             * 2 = trunc(sales             * 2)
);

comment on constraint daily_entries_half_steps on public.daily_entries is
  'Métricas do Diário andam de 0,5 em 0,5 (venda dividida entre dois corretores).';

-- -----------------------------------------------------------------------------
-- 3. Lançamento: notas e gerente entram; meio ponto passa
-- -----------------------------------------------------------------------------
drop function if exists public.public_daily_submit(text, text, jsonb);

create or replace function public.public_daily_submit(
  p_slug      text,
  p_pin       text,
  p_entries   jsonb,
  p_notes     text default null,
  p_filled_by text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link      public.public_links;
  v_report_id uuid;
  v_entry     jsonb;
  v_count     int := 0;
  -- Fronteira anônima: corta espaço e tamanho antes de gravar. Vazio vira NULL.
  v_notes     text := nullif(left(btrim(p_notes), 2000), '');
  v_filled_by text := nullif(left(btrim(p_filled_by), 120), '');
begin
  v_link := private.resolve_public_link(p_slug, p_pin);

  -- Recusa é NULL, nunca exceção (0034): exceção faria rollback do contador do
  -- lockout que o resolvedor acabou de gravar.
  if v_link.id is null or v_link.kind <> 'daily_team' then
    return null;
  end if;

  -- O formulário é o estado inteiro do dia: reenviar sem notas limpa as notas.
  insert into public.daily_reports (team_id, report_date, submitted_at, notes, filled_by_name)
  values (v_link.team_id, current_date, now(), v_notes, v_filled_by)
  on conflict (team_id, report_date) do update
    set submitted_at   = now(),
        notes          = excluded.notes,
        filled_by_name = excluded.filled_by_name
  returning id into v_report_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    -- Só aceita corretor que realmente pertence à equipe deste link.
    if not exists (
      select 1 from public.team_members tm
      where tm.team_id = v_link.team_id
        and tm.profile_id = (v_entry ->> 'profile_id')::uuid
        and tm.left_at is null
    ) then
      continue;
    end if;

    -- `::numeric` em vez de `::int`: 2.5 deixa de ser 22P02. Fora do passo de
    -- 0,5 a constraint recusa com 23514 — o cliente vê "fora do valor
    -- permitido", não um arredondamento silencioso.
    insert into public.daily_entries (
      report_id, profile_id, leads, calls, doc_collections,
      visits_scheduled, visits_done, analyses_sent, analyses_approved, sales
    )
    values (
      v_report_id,
      (v_entry ->> 'profile_id')::uuid,
      coalesce((v_entry ->> 'leads')::numeric, 0),
      coalesce((v_entry ->> 'calls')::numeric, 0),
      coalesce((v_entry ->> 'doc_collections')::numeric, 0),
      coalesce((v_entry ->> 'visits_scheduled')::numeric, 0),
      coalesce((v_entry ->> 'visits_done')::numeric, 0),
      coalesce((v_entry ->> 'analyses_sent')::numeric, 0),
      coalesce((v_entry ->> 'analyses_approved')::numeric, 0),
      coalesce((v_entry ->> 'sales')::numeric, 0)
    )
    on conflict (report_id, profile_id) do update set
      leads             = excluded.leads,
      calls             = excluded.calls,
      doc_collections   = excluded.doc_collections,
      visits_scheduled  = excluded.visits_scheduled,
      visits_done       = excluded.visits_done,
      analyses_sent     = excluded.analyses_sent,
      analyses_approved = excluded.analyses_approved,
      sales             = excluded.sales;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('report_id', v_report_id, 'saved', v_count);
end;
$$;

comment on function public.public_daily_submit(text, text, jsonb, text, text) is
  'Lançamento do Diário pelo link público, com notas e nome de quem preencheu. Recusa devolve NULL (nunca exceção): exceção faria rollback do contador do lockout gravado por resolve_public_link.';

-- Função nova nasce sem EXECUTE para anon (0019): o grant é explícito, e é ele
-- que `tests/06_anon_surface.sql` cobra.
grant execute on function public.public_daily_submit(text, text, jsonb, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Leitura: o mês inteiro, dia a dia
--
-- Mesma assinatura, mesma exposição (o recorte é a equipe que o link já libera).
-- `month` é um objeto {"2026-09-01": {filled_by, notes, entries}} do dia 1 até
-- hoje; `today` fica por compatibilidade. Volume: ~30 dias × corretores.
-- -----------------------------------------------------------------------------
create or replace function public.public_daily_team(p_slug text, p_pin text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.public_links;
  v_out  jsonb;
begin
  v_link := private.resolve_public_link(p_slug, p_pin);
  if v_link.id is null or v_link.kind <> 'daily_team' then
    return null;
  end if;

  select jsonb_build_object(
    'team_id',    t.id,
    'team_name',  t.name,
    'has_pin',    v_link.pin_hash is not null,
    -- O banco roda em UTC e `public_daily_submit` grava em `current_date`: a
    -- tela precisa saber qual chave de `month` é "hoje" para o banco.
    'today_date', current_date,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', p.id,
               'full_name',  p.full_name
             ) order by p.full_name)
      from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = t.id and tm.left_at is null and p.status = 'active'
    ), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id',        e.profile_id,
               'leads',             e.leads,
               'calls',             e.calls,
               'doc_collections',   e.doc_collections,
               'visits_scheduled',  e.visits_scheduled,
               'visits_done',       e.visits_done,
               'analyses_sent',     e.analyses_sent,
               'analyses_approved', e.analyses_approved,
               'sales',             e.sales
             ))
      from public.daily_entries e
      join public.daily_reports r on r.id = e.report_id
      where r.team_id = t.id and r.report_date = current_date
    ), '[]'::jsonb),
    'month', coalesce((
      select jsonb_object_agg(
               r.report_date::text,
               jsonb_build_object(
                 'filled_by', r.filled_by_name,
                 'notes',     r.notes,
                 'entries', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'profile_id',        e.profile_id,
                            'leads',             e.leads,
                            'calls',             e.calls,
                            'doc_collections',   e.doc_collections,
                            'visits_scheduled',  e.visits_scheduled,
                            'visits_done',       e.visits_done,
                            'analyses_sent',     e.analyses_sent,
                            'analyses_approved', e.analyses_approved,
                            'sales',             e.sales
                          ))
                   from public.daily_entries e
                   where e.report_id = r.id
                 ), '[]'::jsonb)
               ))
      from public.daily_reports r
      where r.team_id = t.id
        and r.report_date >= date_trunc('month', current_date)::date
        and r.report_date <= current_date
    ), '{}'::jsonb)
  )
  into v_out
  from public.teams t
  where t.id = v_link.team_id;

  update public.public_links set last_seen_at = now() where id = v_link.id;

  return v_out;
end;
$$;

comment on function public.public_daily_team(text, text) is
  'Equipe, escala, checkpoint de hoje e o mês corrente dia a dia, para o link público do Diário. NULL em qualquer recusa.';

grant execute on function public.public_daily_team(text, text) to anon, authenticated;
