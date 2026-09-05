-- =============================================================================
-- 0076 · Pipeline: realtime de `deals`, registro da reabertura de mês e a lista
--        de corretores que o rateio precisa oferecer
--
-- Três buracos que só o banco fecha:
--
-- 1. **`deals` nunca entrou na publication `supabase_realtime`.** O front assina
--    a tabela desde a 0020 (hoje `usePipelineRealtime`, canal `pipeline-live`) e
--    nunca recebeu um evento: o `subscribe()` sobe, o canal fica aberto e nada
--    chega.
--    Na prática dois operadores no mesmo funil não veem o movimento um do
--    outro, e a aprovação do CCA em outra tela não atualiza o Pipeline aberto.
--    Medido em 02/09/2026: a publication tem 8 tabelas e `deals` não é uma
--    delas. O laço abaixo é o mesmo da 0020, idempotente.
--
--    `stage_permissions` e `closed_months` entram pelo mesmo motivo: as duas são
--    TRAVAS lidas pela tela. Sem realtime, o admin revoga uma etapa (ou fecha um
--    mês) e quem está com o Pipeline aberto continua movendo negócio até dar F5
--    - a própria tela de Permissões avisa isso hoje em texto.
--
-- 2. **Reabrir mês não deixava rastro.** A tela ganhou o caminho de reabertura
--    (só admin, `closed_months_write` já era `is_admin()`), e apagar a linha de
--    `closed_months` é um ato que muda relatório já lido pela diretoria — sem
--    registro, ninguém sabe que o período foi reaberto, por quem, nem quando.
--    O gatilho grava o fato na saída da linha: não depende de a tela lembrar de
--    registrar, e vale também para reabertura feita por SQL.
--
--    **Limite conhecido:** ele não distingue reabertura de LIMPEZA. Todo
--    `delete` em `closed_months` vira linha — inclusive o teardown de teste e o
--    `059_test_scenarios_rollback.sql`, que apagam o mês para devolver o banco
--    ao estado anterior e gerariam reabertura que nunca aconteceu, com
--    `reopened_by` nulo. Filtrar por `auth.uid() is not null` resolveria, mas
--    descartaria justamente a reabertura por SQL que o parágrafo acima exige;
--    quem limpa é que limpa também `month_reopenings` (feito nos specs desta
--    frente; o seed de rollback está registrado como pendência).
--
--    **Não** desfaz a migração de propostas. `close_month_and_season` move todo
--    `outcome = 'open'` para o mês seguinte e não guarda quais linhas moveu;
--    reverter seria adivinhação, e devolveria negócio para um mês que a
--    diretoria já leu como fechado. O que a reabertura faz é destravar a edição.
--
-- 3. **O corretor não consegue montar negócio rateado.** `auth_visible_profiles()`
--    entrega ao corretor só o próprio perfil (medido: 15 corretores puros
--    enxergam 1 pessoa), então "Corretor 2" e "Corretor 3" abrem com uma opção
--    só — ele mesmo. O rateio de VGV da ata de 14/07 é justamente a divisão
--    entre corretores, e o banco já a calcula sozinho (`recalc_deal_shares`)
--    assim que o segundo entra. `selectable_brokers()` é o mesmo padrão de
--    `deal_participant_names()`: `security definer`, devolve só id e nome, e
--    não abre mais nada de `profiles`.
--
--    E o mesmo RECORTE: quem monta negócio rateado é quem o banco deixa gravar
--    negócio. O predicado é literalmente o `with check` de `deals_insert`
--    (0053) — `auth_effective_role(auth.uid())` na lista de escritores —, e não
--    `has_role('broker')`: `handle_new_auth_user` (0002) concede `broker` a
--    todo perfil novo e nunca o retira, então `has_role` responderia "sim" para
--    sócio, SDR e marketing e a função viraria um diretório de corretores para
--    qualquer autenticado. `auth_effective_role` usa a MESMA precedência do
--    `primaryRole` do front (broker é o último da fila), então sócio-que-também-
--    é-corretor sai como sócio nos dois lados.
--
-- Asserts: `supabase/tests/76_pipeline_reabertura.sql`.
-- =============================================================================

-- 1. Realtime de `deals` -----------------------------------------------------

do $do$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['deals', 'stage_permissions', 'closed_months'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$do$;

-- 2. Registro da reabertura de mês -------------------------------------------

create table if not exists public.month_reopenings (
  id           uuid primary key default gen_random_uuid(),
  period       date not null,
  closed_at    timestamptz,
  closed_by    uuid references public.profiles(id) on delete set null,
  reopened_at  timestamptz not null default now(),
  reopened_by  uuid references public.profiles(id) on delete set null
);

create index if not exists month_reopenings_period_idx
  on public.month_reopenings (period, reopened_at desc);

alter table public.month_reopenings enable row level security;

-- Leitura para quem lê resultado consolidado; escrita, ninguém: a linha nasce
-- do gatilho (que roda como dono da tabela e passa por cima da RLS). Uma tela
-- que pudesse inserir aqui poderia inventar reabertura que não aconteceu.
drop policy if exists month_reopenings_select on public.month_reopenings;
create policy month_reopenings_select on public.month_reopenings
  for select using (public.is_admin() or public.has_role('director'));

create or replace function public.closed_months_log_reopen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.month_reopenings (period, closed_at, closed_by, reopened_by)
  values (old.period, old.closed_at, old.closed_by, auth.uid());
  return old;
end;
$$;

drop trigger if exists closed_months_log_reopen on public.closed_months;
create trigger closed_months_log_reopen
  after delete on public.closed_months
  for each row execute function public.closed_months_log_reopen();

-- 3. Corretores selecionáveis para o rateio ----------------------------------

create or replace function public.selectable_brokers()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name
    from public.profiles p
   where public.auth_effective_role(auth.uid()) = any (
           array['admin', 'director', 'manager', 'broker', 'cca']::app_role[]
         )
     and p.status = 'active'
     and exists (
       select 1 from public.user_roles ur
        where ur.profile_id = p.id and ur.role = 'broker'
     )
   order by p.full_name;
$$;

revoke all on function public.selectable_brokers() from public;
grant execute on function public.selectable_brokers() to authenticated;

-- (Não há seção 4: a matriz de `stage_permissions` JÁ é semeada pela migration
-- 0061, seção 7, com as mesmas 39 linhas e `on conflict do nothing`. Repetir o
-- seed aqui seria uma segunda fonte de verdade para a mesma regra.)
