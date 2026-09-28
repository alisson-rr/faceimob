-- Meta remuneração só o administrador grava (pedido do cliente em 29/09/2026).
--
-- `sales_comp` é o patamar que define a remuneração dos gestores (0158). Até
-- aqui o `goals_write` da 0061 deixava o diretor gravar qualquer meta de quem
-- ele enxerga — inclusive a própria Meta remuneração e a dos gerentes dele. A
-- tela esconder o campo não bastava: a policy é a fronteira.
--
-- O diretor segue gravando todo o resto (meta global, de equipe e as demais
-- métricas por pessoa). A condição fica no USING e no WITH CHECK: sem ela no
-- USING, o diretor apagaria ou mudaria uma `sales_comp` existente.
drop policy if exists goals_write on public.goals;
create policy goals_write on public.goals
  for all to authenticated
  using (
    public.is_admin()
    or (public.has_any_role('director') and metric <> 'sales_comp' and (
          scope = 'global'
          or (scope = 'team'    and team_id    in (select public.auth_led_team_ids()))
          or (scope = 'profile' and profile_id in (select public.auth_visible_profiles()))
       ))
  )
  with check (
    public.is_admin()
    or (public.has_any_role('director') and metric <> 'sales_comp' and (
          scope = 'global'
          or (scope = 'team'    and team_id    in (select public.auth_led_team_ids()))
          or (scope = 'profile' and profile_id in (select public.auth_visible_profiles()))
       ))
  );
