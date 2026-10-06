-- =============================================================================
-- 0221 — Universidade dentro do CRM
--
-- Etapa 1 de levar a administração do site para o CRM (04/10/2026): o corretor
-- assiste às aulas na Central do Corretor, sem ir ao site. Os dados são os do
-- site (`site.university_*`, 0169) e a leitura e o progresso próprio já saem
-- pela RLS de lá. Faltava o que o servidor do site fazia com chave de servidor:
--   · contar a visualização da aula (o corretor não edita a aula);
--   · concluir a aula e dar +50 XP na primeira vez (nível = XP / 100 + 1) —
--     a mesma regra do site, num lugar só e sem o corretor escrever o próprio XP.
-- =============================================================================

create or replace function public.universidade_registrar_visualizacao(p_video uuid)
returns integer
language plpgsql
security definer
set search_path = site, public, pg_temp
as $$
declare
  v_total integer;
begin
  if auth.uid() is null or not site.has_role(auth.uid(), 'corretor') then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  update site.university_videos
     set views_count = views_count + 1
   where id = p_video and active
  returning views_count into v_total;
  return coalesce(v_total, 0);
end;
$$;

revoke all on function public.universidade_registrar_visualizacao(uuid) from public, anon;
grant execute on function public.universidade_registrar_visualizacao(uuid) to authenticated;

create or replace function public.universidade_concluir_aula(p_video uuid)
returns jsonb
language plpgsql
security definer
set search_path = site, public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_antes timestamptz;
  v_xp    integer;
begin
  if v_user is null or not site.has_role(v_user, 'corretor') then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if not exists (select 1 from site.university_videos where id = p_video and active) then
    raise exception 'Aula não encontrada.' using errcode = 'P0002';
  end if;

  select completed_at into v_antes
    from site.university_watched where user_id = v_user and video_id = p_video;

  insert into site.university_watched (user_id, video_id, completed_at, updated_at)
  values (v_user, p_video, now(), now())
  on conflict (user_id, video_id)
  do update set completed_at = coalesce(site.university_watched.completed_at, now()), updated_at = now();

  if v_antes is not null then
    select experiencia into v_xp from site.evolucao_universidade where user_id = v_user;
    return jsonb_build_object('primeira', false, 'experiencia', coalesce(v_xp, 0),
                              'nivel', coalesce(v_xp, 0) / 100 + 1);
  end if;

  insert into site.evolucao_universidade (user_id, experiencia, nivel, dados, atualizado_em)
  values (v_user, 50, 1, '{}', now())
  on conflict (user_id)
  do update set experiencia = site.evolucao_universidade.experiencia + 50,
                nivel = (site.evolucao_universidade.experiencia + 50) / 100 + 1,
                atualizado_em = now()
  returning experiencia into v_xp;

  return jsonb_build_object('primeira', true, 'experiencia', v_xp, 'nivel', v_xp / 100 + 1);
end;
$$;

revoke all on function public.universidade_concluir_aula(uuid) from public, anon;
grant execute on function public.universidade_concluir_aula(uuid) to authenticated;

comment on function public.universidade_concluir_aula(uuid) is
  'Conclui a aula para quem está logado e dá +50 XP na primeira conclusão (nível = XP/100 + 1), a regra do site (0221).';
