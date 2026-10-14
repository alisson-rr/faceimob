-- 0276 — Descartar candidato direto do card (disponível ou já pego).
--
-- Antes só quem pegou o candidato (ou admin) mudava o status, e candidato
-- disponível não tinha como sair da lista. Descartar vira uma ação própria:
-- grava `descartado`, atribui o descarte a quem o fez (a constraint
-- `candidatos_dono_coerente` exige dono em tudo que não é disponível) e a tela
-- some com o card para os usuários; o painel do admin continua contando.
create or replace function public.candidato_descartar(p_id uuid)
returns public.candidatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.candidatos;
begin
  if auth.uid() is null or not (public.is_admin() or public.has_any_role('manager', 'director')) then
    raise exception 'Só gerentes, diretores, sócios e administradores descartam candidatos.' using errcode = '42501';
  end if;
  update public.candidatos
     set status = 'descartado', status_em = now(),
         responsavel_id = coalesce(responsavel_id, auth.uid()),
         pego_em = coalesce(pego_em, now())
   where id = p_id and status <> 'descartado'
     and (status = 'disponivel' or responsavel_id = auth.uid() or public.is_admin())
  returning * into v;
  if not found then
    raise exception 'Candidato não encontrado, já descartado ou pego por outro gestor.' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function public.candidato_descartar(uuid) from public, anon;
grant execute on function public.candidato_descartar(uuid) to authenticated;
comment on function public.candidato_descartar(uuid) is
  'Descarta um candidato disponível ou pego pelo próprio gestor (admin descarta qualquer um) — 0276.';
