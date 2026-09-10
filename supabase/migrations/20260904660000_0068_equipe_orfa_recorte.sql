-- =============================================================================
-- 0068 — equipe órfã deixa de ser porta de entrada para outra diretoria
--
-- A 0061 fechou o "qualquer diretor mexe em qualquer equipe", mas o ramo
-- `director_id is null` do `using` de `teams_admin_write` ficou mais largo do
-- que o comentário dela descrevia ("equipe recém-criada"). Órfã não é caso de
-- canto neste schema:
--
--   * `teams.director_id` é `on delete set null` (0002:119) — excluir um
--     diretor ORFANA todas as equipes da diretoria dele de uma vez;
--   * `src/pages/Equipes.tsx` criava equipe com `director_id = null` sempre que
--     quem clicava era ADMIN (o campo "Equipe" da coluna Gerentes).
--
-- Com `teams_select` aberto a todo autenticado, descobrir o id de uma órfã é
-- trivial. E como o `with check` aceita `director_id = auth.uid()`, um PATCH em
-- /teams bastava para QUALQUER diretor adotá-la. Adotada a equipe, ela entra em
-- `auth_led_team_ids()` e `auth_visible_profiles()` passa a entregar todos os
-- membros dela: perfis, leads e negócios de uma diretoria alheia.
--
-- A correção é exigir que adotar pressuponha ENXERGAR: o gerente da equipe
-- órfã precisa já estar entre os perfis visíveis de quem adota
-- (`auth_visible_profiles()`). Um diretor continua adotando a equipe do gerente
-- que ele já acompanha — que é o caso real de "acabei de criar" e o de
-- "o diretor anterior saiu da empresa" — e para de alcançar a equipe de um
-- gerente que nunca esteve na subárvore dele. Órfã de gerente NULO passa a ser
-- só do admin, que é quem tem como saber a quem ela pertence.
--
-- O lado da tela (equipe do admin nascer com a diretoria do gerente) está em
-- `src/pages/Equipes.tsx`; esta migration é o ponto que vale mesmo quando a
-- chamada não vem da tela.
--
-- Idempotente: `drop policy if exists` + `create policy`.
-- =============================================================================

drop policy if exists teams_admin_write on public.teams;
create policy teams_admin_write on public.teams
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.has_any_role('director')
      and (
        director_id = auth.uid()
        -- Órfã só é alcançável por quem já enxerga o gerente dela. Sem este
        -- recorte, qualquer diretor adotava qualquer equipe sem diretoria.
        or (director_id is null and manager_id in (select public.auth_visible_profiles()))
      )
    )
  )
  with check (
    public.is_admin()
    or (public.has_any_role('director') and director_id = auth.uid())
  );
