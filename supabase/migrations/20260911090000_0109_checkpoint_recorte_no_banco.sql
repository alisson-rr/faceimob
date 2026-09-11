-- =============================================================================
-- 0109 · O recorte do diário sai da tela e entra no banco
--
-- Regra do cliente: "o diretor vê só o dele e o dos gerentes dele". Ela já
-- estava escrita — em React. `src/components/checkpoint/visibility.ts` recorta
-- o quadro por `teams.director_id`, mas `daily_reports_select` (0009) libera o
-- diretor por `can_read_all()` e `src/pages/Checkpoint.tsx` consulta
-- `daily_reports`/`daily_entries` só por intervalo de datas, sem filtro de
-- equipe. Resultado: o diário de TODAS as equipes da casa chega ao navegador
-- do diretor e é o JavaScript que joga fora o que não é dele. Abrir a aba de
-- rede — ou trocar o `select` no console — devolve a operação inteira. Isso é
-- exposição de dado, não detalhe de UI.
--
-- ── A DECISÃO: `can_read_all()` NÃO é tocada ───────────────────────────────
--
-- O caminho óbvio seria tirar 'director' de `can_read_all()` (0002). Medido
-- antes (`grep -rn can_read_all supabase/migrations`), ela tem CINCO
-- consumidores, e só um é o diário:
--
--   · `can_see_deal()`            (0006) — negócio e histórico do pipeline;
--   · `goals_select`              (0011) — metas de escopo `team`;
--   · `visible_brokers` / produto (0027) — quais corretores aparecem;
--   · `can_see_game_profile()`    (0060) — ranking e pontos da gamificação;
--   · `daily_reports_select` / `daily_entries_select` (0009) — o diário.
--
-- Estreitar a função resolveria o diário e, no mesmo commit, tiraria do diretor
-- negócio, meta, corretor e ranking de fora das equipes dele — quatro frentes
-- que ninguém está olhando agora e cujo pedido do cliente pode muito bem ser o
-- oposto (o diretor participa do rateio de VGV da casa). MENOR ESTRAGO:
-- `can_read_all()` fica como está, e o estreitamento vale só para as duas
-- policies do diário. Se um dia a regra "diretor só vê o dele" valer para
-- pipeline e ranking também, aí sim a função é o lugar — e será uma decisão
-- consciente, com as quatro telas na mesa.
--
-- ── O QUE MUDA, POLICY A POLICY ────────────────────────────────────────────
--
-- `daily_reports_select`: `can_read_all()` vira `has_any_role('admin',
-- 'partner')`. Os outros dois ramos (liderar a equipe em `auth_led_team_ids()`,
-- ser membro dela em `team_members`) continuam intactos — é por eles que o
-- diretor passa a entrar, e são exatamente as equipes que ele dirige. Sócio
-- segue junto do administrador (0099).
--
-- `daily_entries_select`: dois estreitamentos, nenhum alargamento.
--   1. O ramo por PESSOA era `profile_id in (select auth_visible_profiles())`
--      e vira `profile_id = auth.uid()`. `auth_visible_profiles()` é o conjunto
--      de PESSOAS que eu enxergo, e a linha do diário pende de um RELATÓRIO, que
--      é de uma EQUIPE: um gerente lia o lançamento de um corretor dele mesmo
--      quando a linha pendia do relatório de OUTRA equipe (corretor que trocou
--      de equipe, ou linha gravada direto). Era o último caminho cross-team que
--      sobrava para gerente. Fica só "a minha própria linha", que preserva o
--      corretor lendo o próprio histórico inclusive depois de sair da equipe.
--   2. `can_read_all()` vira `has_any_role('admin','partner')`, como acima.
--
-- MEMBRO NÃO ENTRA em `daily_entries_select` — de propósito. Hoje o corretor lê
-- só a própria linha; copiar para cá o terceiro ramo de `daily_reports_select`
-- abriria o número de cada colega de equipe para todos os corretores dela. Ser
-- membro continua dando o CABEÇALHO do relatório, não as linhas dos outros.
--
-- ── CONSEQUÊNCIAS ASSUMIDAS ────────────────────────────────────────────────
--
--   · `auth_led_team_ids()` exige `teams.active`. Diretor de equipe DESATIVADA
--     perde o diário dela — hoje ele o alcançava por `can_read_all()`. É a
--     mesma regra que o gerente já vive desde a 0009, e a tela do checkpoint já
--     tem o aviso ("equipe fora do recorte"); ver o risco anotado sobre
--     `readsEveryReport` em `src/components/checkpoint/visibility.ts`, que ainda
--     lista 'director' como quem lê tudo.
--   · O diário PÚBLICO com PIN não é afetado: `public_daily_team`,
--     `public_daily_submit` e `public_director_checkpoint` são SECURITY DEFINER
--     (0062/0080) e não passam por RLS. Coberto por asserção em
--     `supabase/tests/97_diario_hierarquia.sql`.
--   · `daily_reports_write` / `daily_entries_write` não são tocadas: escrita já
--     era `is_admin() or auth_led_team_ids()`, que é o recorte pedido.
--
-- Idempotente: `drop policy if exists` + `create`.
-- =============================================================================

drop policy if exists daily_reports_select on public.daily_reports;
create policy daily_reports_select on public.daily_reports
  for select to authenticated
  using (
    public.has_any_role('admin', 'partner')
    or team_id in (select public.auth_led_team_ids())
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = daily_reports.team_id
        and tm.profile_id = auth.uid() and tm.left_at is null
    )
  );

drop policy if exists daily_entries_select on public.daily_entries;
create policy daily_entries_select on public.daily_entries
  for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.daily_reports r
      where r.id = daily_entries.report_id
        and (
          public.has_any_role('admin', 'partner')
          or r.team_id in (select public.auth_led_team_ids())
        )
    )
  );

-- Verificação executável barata: se um `create or replace` futuro reintroduzir
-- `can_read_all()` em qualquer das duas, a migration falha aqui em vez de
-- devolver o diário da casa inteira ao navegador do diretor. A prova de
-- COMPORTAMENTO (quem lê o quê, com `set local role authenticated`) está em
-- `supabase/tests/97_diario_hierarquia.sql`.
do $$
declare
  sobrou text;
begin
  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into sobrou
    from pg_policies
   where schemaname = 'public'
     and policyname in ('daily_reports_select', 'daily_entries_select')
     and qual like '%can_read_all%';

  if sobrou is not null then
    raise exception '0109: policy do diário ainda passa por can_read_all(): %', sobrou;
  end if;
end;
$$;

comment on policy daily_reports_select on public.daily_reports is
  'Leitura do cabeçalho do diário: admin/sócio veem tudo; quem lidera a equipe ATIVA (gerente ou diretor, via auth_led_team_ids) vê a dela; membro vê a da própria equipe. Diretor NÃO passa mais por can_read_all() (0109).';

comment on policy daily_entries_select on public.daily_entries is
  'Leitura das linhas do diário: a própria linha sempre; as demais só se o relatório for de equipe que eu lidero, ou se eu for admin/sócio. Não recorta por pessoa (auth_visible_profiles) — a linha pende de uma EQUIPE (0109).';
