-- =============================================================================
-- 0338 · Exigir nova senha de equipes inteiras (notebooks roubados, 16/11/2026)
--
-- Pedido do Douglas: trocar em massa a senha das equipes de dois diretores e
-- derrubar o acesso dos notebooks roubados. Trocar só a senha não basta: a
-- sessão aberta no notebook continua valendo pelo refresh token.
--
-- Fluxo (a edge `provision-broker-user`, ramo `exigir_nova_senha`):
--  1. troca a senha no Auth por um valor aleatório que ninguém conhece;
--  2. `aplicar_exigencia_nova_senha` apaga as sessões e refresh tokens do
--     GoTrue (o notebook roubado não renova mais), apaga a senha do cofre e
--     marca a pessoa em `senha_troca_exigida`;
--  3. a pessoa entra pelo link do e-mail, o CRM a leva para Configurações e só
--     libera as telas depois de `concluir_nova_senha()`.
-- Limite: o access token já emitido segue válido no PostgREST até expirar
-- (padrão 1 h). O GoTrue recusa trocar a senha com ele, porque a sessão sumiu.
-- =============================================================================

create table if not exists public.senha_troca_exigida (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  exigida_em  timestamptz not null default now(),
  exigida_por uuid references public.profiles(id) on delete set null
);
comment on table public.senha_troca_exigida is
  'Quem precisa criar uma senha nova antes de usar o CRM (0338). Só a service role grava; a pessoa apaga a própria linha por concluir_nova_senha().';

alter table public.senha_troca_exigida enable row level security;
drop policy if exists senha_troca_exigida_select on public.senha_troca_exigida;
create policy senha_troca_exigida_select on public.senha_troca_exigida
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());
revoke all on public.senha_troca_exigida from anon, authenticated;
grant select on public.senha_troca_exigida to authenticated;

alter table public.access_provision_log drop constraint if exists access_provision_log_action_check;
alter table public.access_provision_log add constraint access_provision_log_action_check
  check (action in ('create', 'reset', 'denied', 'revoked', 'restored', 'password', 'nova_senha_exigida'));

-- Quem entra no corte: membros ativos das equipes escolhidas, mais gerente,
-- diretor e diretor 2 delas. A tela mostra a lista e o admin pode desmarcar.
create or replace function public.exigir_nova_senha_alvos(p_team_ids uuid[])
returns table (profile_id uuid, full_name text, email text, equipes text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Só administrador ou sócio.' using errcode = '42501';
  end if;
  return query
    with alvo as (
      select tm.profile_id as pid, t.name from public.team_members tm
        join public.teams t on t.id = tm.team_id
       where tm.team_id = any (p_team_ids) and tm.left_at is null
      union
      select x.pid, t.name from public.teams t
        cross join lateral (values (t.manager_id), (t.director_id), (t.co_director_id)) x(pid)
       where t.id = any (p_team_ids) and x.pid is not null
    )
    select p.id, p.full_name, p.email, string_agg(distinct a.name, ', ' order by a.name)
      from alvo a join public.profiles p on p.id = a.pid
     where p.status <> 'terminated' and p.id <> auth.uid()
     group by p.id, p.full_name, p.email
     order by p.full_name;
end;
$$;
revoke all on function public.exigir_nova_senha_alvos(uuid[]) from public, anon;
grant execute on function public.exigir_nova_senha_alvos(uuid[]) to authenticated;

-- Derruba as sessões, esquece a senha do cofre e marca a troca. Service role:
-- a edge já conferiu que quem pediu é admin e já trocou a senha no Auth.
create or replace function public.aplicar_exigencia_nova_senha(p_profile_id uuid, p_actor_id uuid)
returns int
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
declare
  v_sessoes int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role.' using errcode = '42501';
  end if;
  delete from auth.refresh_tokens where user_id = p_profile_id::text;
  delete from auth.sessions where user_id = p_profile_id;
  get diagnostics v_sessoes = row_count;
  delete from private.operation_credentials where profile_id = p_profile_id;
  insert into public.senha_troca_exigida (profile_id, exigida_por)
  values (p_profile_id, p_actor_id)
  on conflict (profile_id) do update set exigida_em = now(), exigida_por = excluded.exigida_por;
  return v_sessoes;
end;
$$;
revoke all on function public.aplicar_exigencia_nova_senha(uuid, uuid) from public, anon, authenticated;
grant execute on function public.aplicar_exigencia_nova_senha(uuid, uuid) to service_role;

-- A pessoa acabou de salvar a senha nova em Configurações.
create or replace function public.concluir_nova_senha()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.senha_troca_exigida where profile_id = auth.uid();
  return found;
end;
$$;
revoke all on function public.concluir_nova_senha() from public, anon;
grant execute on function public.concluir_nova_senha() to authenticated;
