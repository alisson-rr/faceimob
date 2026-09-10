-- -----------------------------------------------------------------------------
-- 0024 — IP de host único volta a liberar o check-in
--
-- `ip_is_allowed` comparava com `<<`, que em Postgres é "contido ESTRITAMENTE".
-- Para um /32 isso é sempre falso: `inet '200.1.2.3' << inet '200.1.2.3/32'`
-- devolve false porque a rede é a mesma, não uma sub-rede.
--
-- Consequência em produção: o administrador cadastrava o IP fixo da loja
-- (`AdminAllowedIps` grava host único como /32), via o toast verde e a faixa na
-- lista — e nenhum corretor conseguia bater ponto daquele IP. A trava só
-- funcionava por acaso, quando a faixa era cadastrada em CIDR mais largo.
-- Regra da ata de 14/07: "o check-in permanece restrito por IP".
--
-- `<<=` é "contido ou igual": mantém o comportamento de faixa (um /24 continua
-- cobrindo os 256 hosts) e passa a cobrir o host único.
-- -----------------------------------------------------------------------------
create or replace function public.ip_is_allowed(candidate inet, who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((select p.bypass_ip_check from public.profiles p where p.id = who), false)
    or exists (
      select 1
      from public.allowed_ips a
      where a.active
        and candidate <<= a.ip_range
        and (
          a.team_id is null
          or a.team_id in (
            select tm.team_id from public.team_members tm
            where tm.profile_id = who and tm.left_at is null
          )
        )
    );
$$;

revoke execute on function public.ip_is_allowed(inet, uuid) from public, anon;
