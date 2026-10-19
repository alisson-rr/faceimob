-- =============================================================================
-- 0292 · CCA oculta coluna da esteira e não exclui mais
--
-- 19/10/2026: uma analista da CCA excluiu colunas da esteira e os casos delas
-- sumiram do quadro (`cca_cases.stage_id` vira nulo no delete, e sem coluna o
-- negócio não aparece). A 0242 dava à CCA `for all` em `cca_stages`. Agora a
-- CCA cria, edita e oculta (`active = false`, reversível pela própria tela);
-- excluir fica só com o administrador.
-- =============================================================================

drop policy if exists cca_stages_write on public.cca_stages;
drop policy if exists cca_stages_insert on public.cca_stages;
drop policy if exists cca_stages_delete on public.cca_stages;

create policy cca_stages_insert on public.cca_stages
  for insert to authenticated
  with check (public.is_admin() or public.has_role('cca'));

create policy cca_stages_write on public.cca_stages
  for update to authenticated
  using (public.is_admin() or public.has_role('cca'))
  with check (public.is_admin() or public.has_role('cca'));

create policy cca_stages_delete on public.cca_stages
  for delete to authenticated
  using (public.is_admin());

comment on policy cca_stages_delete on public.cca_stages is
  'Excluir coluna da esteira é só do admin (0292): a CCA oculta (active = false), que não solta os casos.';
