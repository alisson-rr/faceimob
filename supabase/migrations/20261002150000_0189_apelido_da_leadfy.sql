-- =============================================================================
-- 0189 — nome curto da Leadfy vira apelido do corretor
--
-- Pedido do cliente em 02/10/2026: "coloque esses nomes curtos do Leadfy no
-- apelido do corretor no cadastro". A planilha traz "Marco Antonio" para
-- "Marco Antonio Torres"; gravado como apelido, ele aparece no game e no
-- ranking (0183) e casa direto nas próximas importações (0188).
--
-- Só preenche quem está SEM apelido: apelido escolhido pela pessoa ou pelo
-- admin não é trocado em silêncio — volta como "mantido" para a tela listar.
-- =============================================================================

create or replace function public.gravar_apelidos_leadfy(p_nomes text[])
returns table (nome text, perfil text, situacao text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome   text;
  v_id     uuid;
  v_atual  text;
  v_perfil text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só administrador e sócio gravam apelidos.' using errcode = '42501';
  end if;

  for v_nome in select distinct btrim(n) from unnest(p_nomes) n where btrim(coalesce(n, '')) <> '' loop
    v_id := public.perfil_pelo_nome_leadfy(v_nome);
    if v_id is null then
      nome := v_nome; perfil := null; situacao := 'sem_corretor';
      return next;
      continue;
    end if;
    select p.full_name, p.nickname into v_perfil, v_atual from public.profiles p where p.id = v_id;
    nome := v_nome; perfil := v_perfil;
    if nullif(btrim(v_atual), '') is null then
      update public.profiles set nickname = left(v_nome, 40) where id = v_id;
      situacao := 'gravado';
    elsif public.nome_comparavel(v_atual) = public.nome_comparavel(v_nome) then
      situacao := 'ja_era';
    else
      situacao := 'mantido: ' || v_atual;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.gravar_apelidos_leadfy(text[]) from public, anon;
grant execute on function public.gravar_apelidos_leadfy(text[]) to authenticated;
comment on function public.gravar_apelidos_leadfy(text[]) is
  'Grava o nome curto da Leadfy como apelido do corretor casado, só onde o apelido está vazio (0189).';
