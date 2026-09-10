-- =============================================================================
-- 0046 — Ficha do colaborador: as colunas que o modal prometia, e papel N:N
--
-- O modal "Editar Colaborador" (Equipes) sempre mostrou CPF, CRECI, habilitação,
-- nascimento, endereço, divisão, indicação e crachá — e nenhum desses campos
-- tinha coluna em lugar nenhum: o Salvar dizia "Dados atualizados" e descartava
-- tudo (auditoria de 01/09/2026). "Entrada" já existia como `profiles.hired_at`;
-- o resto entra aqui, em `profiles` mesmo, porque é dado 1:1 do perfil e quem
-- lê é a mesma tela que grava.
--
-- Papel: `user_roles` é N:N — um diretor que também é gerente e corretor é o
-- caso normal, não a exceção (CONTEXT.md). O front fazia `upsert(profile_id,
-- role)` e chamava isso de "trocar a função": como a PK é (profile_id, role),
-- rebaixar nunca removia o papel antigo e o banco acumulava lixo
-- ("admin,director,manager,broker" no mesmo perfil). `set_profile_roles()`
-- passa a ser o único ponto que grava papel: recebe o conjunto inteiro, insere
-- o que falta e apaga o que sobrou, numa transação só. As regras moram aqui,
-- não na tela:
--   · só admin — a RLS de `user_roles` já era admin-only; a função repete o
--     guard porque é SECURITY DEFINER e passa por cima da policy;
--   · ninguém fica sem papel: conjunto vazio é recusado;
--   · o admin não tira o próprio `admin` — trancaria a porta por dentro.
-- =============================================================================

alter table public.profiles
  add column if not exists cpf                text,
  add column if not exists creci              text,
  add column if not exists habilitation       text,
  add column if not exists birth_date         date,
  add column if not exists address            text,
  add column if not exists division           text,
  add column if not exists indication         text,
  add column if not exists badge_requested_at date,
  add column if not exists badge_delivered_at date;

comment on column public.profiles.cpf is
  'Só os 11 dígitos; a tela limpa pontuação antes de gravar.';
comment on column public.profiles.habilitation is
  'CRECI, CRECI-ESTAGIARIO ou OUTRO. Corretor estagiário atende com CRECI de estágio.';
comment on column public.profiles.indication is
  'Quem indicou o colaborador — texto livre, só para a ficha.';
comment on column public.profiles.badge_requested_at is
  'Data em que o crachá foi pedido; null = não solicitado.';
comment on column public.profiles.badge_delivered_at is
  'Data de entrega do crachá; exige badge_requested_at e nunca vem antes dele.';

-- `add constraint` não tem `if not exists`: o guard é pelo nome.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_cpf_digits') then
    alter table public.profiles add constraint profiles_cpf_digits
      check (cpf is null or cpf ~ '^[0-9]{11}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_habilitation_values') then
    alter table public.profiles add constraint profiles_habilitation_values
      check (habilitation is null or habilitation in ('CRECI', 'CRECI-ESTAGIARIO', 'OUTRO'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_badge_order') then
    alter table public.profiles add constraint profiles_badge_order
      check (badge_delivered_at is null
             or (badge_requested_at is not null and badge_delivered_at >= badge_requested_at));
  end if;
end;
$$;

-- Dois colaboradores com o mesmo CPF é erro de digitação, e o 23505 vira
-- "Já existe um registro com esses dados." na tela.
create unique index if not exists profiles_cpf_key on public.profiles (cpf) where cpf is not null;

-- -----------------------------------------------------------------------------
-- set_profile_roles — troca o conjunto de papéis de um perfil de uma vez
-- -----------------------------------------------------------------------------
create or replace function public.set_profile_roles(p_profile_id uuid, p_roles app_role[])
returns app_role[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_roles app_role[] := (
    select array_agg(distinct r) from unnest(coalesce(p_roles, '{}'::app_role[])) as r
  );
begin
  if not public.is_admin() then
    raise exception 'Somente o administrador altera funções.' using errcode = '42501';
  end if;

  if v_roles is null or cardinality(v_roles) = 0 then
    raise exception 'Escolha ao menos uma função para o colaborador.';
  end if;

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

  return (
    select array_agg(role order by role)
      from public.user_roles
     where profile_id = p_profile_id
  );
end;
$$;

comment on function public.set_profile_roles(uuid, app_role[]) is
  'Substitui o conjunto de papéis do perfil (insere o que falta, apaga o que sobrou). Só admin; recusa conjunto vazio e o admin remover o próprio admin.';

-- Função nova nasce executável por `public`; a superfície anônima são só as 3
-- RPCs do Diário (0019) e o teste 06 acusa qualquer sobra.
revoke all on function public.set_profile_roles(uuid, app_role[]) from public, anon;
grant execute on function public.set_profile_roles(uuid, app_role[]) to authenticated, service_role;
