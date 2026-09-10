-- =============================================================================
-- 0094 · Desfaz a promoção AUTOMÁTICA de sócio a administrador (0093)
--
-- A 0093 leu o pedido do dono — "admin e sócio têm as permissões iguais, é só
-- porque o cliente quer outro nome" — e o implementou dando o papel `admin` a
-- TODO `partner`, na hora, por gatilho. Funcionava. O problema é o que ela
-- apagava de passagem.
--
-- O QUE FOI MEDIDO DEPOIS. `partner` não é um papel vazio esperando um nome:
-- é um observador de LEITURA AMPLA e ESCRITA NENHUMA, e essa fronteira está
-- provada em 15 asserções espalhadas por 12 arquivos de `supabase/tests/` —
-- entre elas "sócio não edita lead (leitura ampla, escrita nenhuma)" (01),
-- "sócio não apaga cliente" e "sócio não edita cliente" (03), "sócio não
-- cadastra IP" e "sócio não desativa IP" (21), "o sócio não escreve no lead
-- alheio" (56), "sócio encerrou lead de outro corretor" (74), "sócio não
-- enumera a corretagem" (76) e "a tela dele é somente leitura" na esteira (77).
-- Com a 0093 as quinze passam a afirmar o contrário do que o banco faz.
--
-- POR QUE VOLTAR ATRÁS E NÃO REESCREVER AS QUINZE. A frase do dono aceita duas
-- leituras, e o custo de errar é assimétrico:
--
--   · se ele quis "um papel só com dois nomes" e eu ficar no caminho estreito,
--     o custo é UM clique a mais: marcar também "Administrador" na ficha;
--   · se ele quis apenas o NOME e eu promover todo sócio, a operação ganha
--     gente com poder de trocar papéis, mexer na matriz de permissões, fechar
--     mês e apagar dado — sem ninguém ter pedido, e sem aviso na tela.
--
-- Entre um clique a mais e uma fronteira de segurança apagada em silêncio, o
-- clique ganha. E a volta é barata: reaplicar a 0093 é uma migration.
--
-- O QUE CONTINUA VALENDO DA 0093: nada no banco. O pedido do NOME é atendido no
-- front por `roleLabelFor` (`src/integrations/supabase/permissions.ts`): quem
-- tem `partner` aparece como "Sócio" em toda a interface, inclusive quando
-- também é `admin` — porque `primaryRole` devolve `admin` para ele e precisa
-- devolver (é ele que espelha `auth_effective_role()` nas travas de escrita).
--
-- COMO DAR PODER DE ADMIN A UM SÓCIO, a partir daqui: marcar os DOIS papéis na
-- ficha (Equipes → papéis). Ele fica com tudo que o administrador pode e a tela
-- continua chamando-o de "Sócio". Sócio que só acompanha recebe só `partner` e
-- segue como observador — que é o que as quinze asserções cobram.
--
-- Idempotente: `drop trigger if exists`, `create or replace` e um `delete`
-- filtrado pelo conjunto exato de papéis.
-- =============================================================================

drop trigger if exists user_roles_partner_implica_admin on public.user_roles;
drop function if exists public.user_roles_partner_implica_admin();

-- Desfaz o backfill: tira `admin` de quem tem EXATAMENTE {admin, partner}, que
-- é a assinatura de quem foi promovido pela 0093 e não por decisão de ninguém.
-- Quem acumula outro papel junto (um diretor que também é sócio, por exemplo)
-- não é tocado: ali o `admin` pode ter sido concedido à mão antes da 0093, e
-- remover seria decidir por quem concedeu.
delete from public.user_roles ur
 where ur.role = 'admin'
   and exists (
     select 1 from public.user_roles p
      where p.profile_id = ur.profile_id and p.role = 'partner'
   )
   and (
     select array_agg(r.role order by r.role)
       from public.user_roles r
      where r.profile_id = ur.profile_id
   ) = array['admin', 'partner']::app_role[];

-- `set_profile_roles` volta ao contrato da 0046: grava exatamente os papéis
-- pedidos, sem expandir `partner` para `admin`.
create or replace function public.set_profile_roles(p_profile_id uuid, p_roles app_role[])
returns app_role[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_roles  app_role[] := (
    select array_agg(distinct r) from unnest(coalesce(p_roles, '{}'::app_role[])) as r
  );
  v_before app_role[];
  v_after  app_role[];
begin
  if not public.is_admin() then
    raise exception 'Somente o administrador altera funções.' using errcode = '42501';
  end if;

  if v_roles is null or cardinality(v_roles) = 0 then
    raise exception 'Escolha ao menos uma função para o colaborador.';
  end if;

  select array_agg(role order by role) into v_before
    from public.user_roles where profile_id = p_profile_id;

  if p_profile_id = auth.uid() and not ('admin' = any(v_roles)) then
    raise exception 'Você não pode remover a sua própria função de administrador.';
  end if;

  -- Insere antes de apagar: em nenhum instante o perfil fica sem papel.
  insert into public.user_roles (profile_id, role, granted_by)
  select p_profile_id, r, auth.uid()
    from unnest(v_roles) as r
  on conflict (profile_id, role) do nothing;

  delete from public.user_roles
   where profile_id = p_profile_id
     and role <> all(v_roles);

  select array_agg(role order by role) into v_after
    from public.user_roles where profile_id = p_profile_id;

  if coalesce(v_before, '{}'::app_role[]) is distinct from coalesce(v_after, '{}'::app_role[]) then
    insert into public.role_change_log
      (profile_id, profile_email, actor_id, actor_email, roles_before, roles_after)
    values (
      p_profile_id,
      (select email::text from public.profiles where id = p_profile_id),
      auth.uid(),
      (select email::text from public.profiles where id = auth.uid()),
      coalesce(v_before, '{}'::app_role[]),
      coalesce(v_after, '{}'::app_role[])
    );
  end if;

  return v_after;
end;
$$;
