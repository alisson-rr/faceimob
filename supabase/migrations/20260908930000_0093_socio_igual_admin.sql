-- =============================================================================
-- 0093 · Sócio tem as MESMAS permissões do administrador
--
-- Decisão do dono em 05/09/2026, literal: "admin e sócio têm as permissões
-- iguais, é só porque o cliente quer outro nome".
--
-- POR QUE NÃO MEXER NAS POLICIES. `'admin'` aparece 124 vezes nas migrations —
-- em `is_admin()`, `can_read_all()`, dezenas de `has_any_role('admin', …)`, no
-- `auth_effective_role()` e ainda em edge functions que leem `user_roles` e
-- comparam `role === 'admin'` na mão (`provision-broker-user`). Acrescentar
-- `'partner'` em cada uma seria 124 chances de errar uma, e a que passasse
-- despercebida viraria um sócio recusado numa tela só — o tipo de defeito que
-- só aparece na frente do cliente.
--
-- O PONTO COMPARTILHADO É O PAPEL, NÃO A CHECAGEM: quem é sócio passa a ter
-- TAMBÉM o papel `admin` em `user_roles`. Papel é N:N desde a 0002, então isso
-- não é gambiarra — é o mesmo mecanismo que faz um diretor ser gerente. Nenhuma
-- policy muda, nenhuma edge function muda, e `auth_effective_role()` devolve
-- `admin` para o sócio, que é o que as travas de escrita esperam.
--
-- `partner` continua existindo e é o que a TELA lê para escrever "Sócio" em vez
-- de "Administrador" — o pedido era de nome, e o nome mora no front.
--
-- CONSEQUÊNCIA, dita com todas as letras: sócio passa a poder tudo que o
-- administrador pode, inclusive alterar papéis de outras pessoas, mexer na
-- matriz de permissões, fechar o mês e apagar dado. Era isso que estava sendo
-- pedido. Quem quiser um sócio "só de leitura" não deve receber o papel
-- `partner` — deve receber `director`, que é o papel de quem lê tudo sem
-- administrar (`can_read_all()`).
--
-- CONSEQUÊNCIA 2: a linha de `partner` na matriz de permissões vira decorativa,
-- porque `has_permission()` curto-circuita em `is_admin()`. Desmarcar uma
-- permissão de sócio ali não tira nada dele. Está anotado na descrição do papel.
--
-- TRÊS CAMINHOS DE ESCRITA, TODOS COBERTOS:
--   1. o que já existe no banco → backfill abaixo;
--   2. `set_profile_roles()` (a tela de Equipes) → a função passa a expandir o
--      conjunto antes de gravar. Sem isso ela DESFARIA o gatilho: ela insere os
--      papéis pedidos e logo depois apaga `role <> all(v_roles)`, então o
--      `admin` que o gatilho acabou de pôr sairia na linha seguinte;
--   3. insert direto (semente, script, SQL na mão) → gatilho.
--
-- LIMITE CONHECIDO: um `delete` direto na linha de `admin` de um sócio desfaz a
-- equivalência sem aviso. Não há gatilho de DELETE de propósito — ele
-- atrapalharia a própria troca de papéis, que apaga e reinsere. O caminho da
-- tela passa por `set_profile_roles`, que está coberto.
--
-- Idempotente: `on conflict do nothing` no backfill, `create or replace` na
-- função e `drop trigger if exists` no gatilho.
-- =============================================================================

-- ── 1. O que já existe ───────────────────────────────────────────────────────
insert into public.user_roles (profile_id, role)
select ur.profile_id, 'admin'::app_role
  from public.user_roles ur
 where ur.role = 'partner'
on conflict (profile_id, role) do nothing;

-- ── 2. Gatilho para inserts diretos ──────────────────────────────────────────
create or replace function public.user_roles_partner_implica_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Só o papel de sócio interessa; o insert do próprio 'admin' reentra aqui e
  -- sai por este if, sem recursão.
  if new.role = 'partner' then
    insert into public.user_roles (profile_id, role)
    values (new.profile_id, 'admin')
    on conflict (profile_id, role) do nothing;
  end if;
  return null;
end;
$$;

comment on function public.user_roles_partner_implica_admin() is
  'Sócio tem as mesmas permissões do administrador (0093): todo `partner` ganha também `admin`. SECURITY DEFINER porque a policy de escrita de `user_roles` é de admin e o gatilho roda no insert de quem for; não há escape por `current_user` aqui.';

drop trigger if exists user_roles_partner_implica_admin on public.user_roles;
create trigger user_roles_partner_implica_admin
  after insert on public.user_roles
  for each row execute function public.user_roles_partner_implica_admin();

-- ── 3. A tela de Equipes ─────────────────────────────────────────────────────
-- Mesma função da 0046, com UMA mudança: `v_roles` passa a incluir `admin`
-- quando `partner` está no conjunto. Sem isso o `delete` do final apagaria o
-- `admin` que o gatilho acabou de inserir.
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

  -- Sócio implica administrador (0093). Feito ANTES da checagem de auto-remoção
  -- logo abaixo: quem é sócio e se marca só como sócio não pode ser barrado por
  -- "você não pode remover a sua própria função de administrador" — ele não a
  -- está removendo.
  if 'partner' = any(v_roles) and not ('admin' = any(v_roles)) then
    v_roles := v_roles || 'admin'::app_role;
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
