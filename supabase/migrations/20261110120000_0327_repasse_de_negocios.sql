-- =============================================================================
-- 0327 · Repasse dos negócios de corretor desligado para um corretor ativo
--
-- Pedido de 10/11/2026: ver, por corretor inativo (desligado ou suspenso), as
-- propostas que ainda estão no pipeline e passá-las a um corretor ativo.
-- Antes só dava para abrir negócio por negócio e trocar o corretor na ficha.
--
-- Regras:
--   * Só negócio ABERTO (`outcome = 'open'`). Ganho e perdido ficam como estão:
--     mexer neles moveria comissão e ponto do game de quem vendeu.
--   * O corretor novo entra no lugar do antigo; o rateio se refaz sozinho
--     (`recalc_deal_shares`) e o gerente/diretor da equipe dele entra pelo
--     `deal_participants_autofill`.
--   * Gerente/diretor que só estava por causa do corretor antigo sai: fica quem
--     lidera a equipe de algum corretor que continua no negócio. Se a regra
--     deixaria o papel vazio (corretor novo sem equipe), os atuais ficam.
--   * Só administrador/sócio. Cada negócio ganha uma linha no histórico.
-- =============================================================================

create or replace function public.negocios_de_corretores_inativos()
returns table (
  deal_id uuid, code text, cliente text, etapa text, status_detail text,
  vgv numeric, month_base date, corretor_id uuid, corretor_nome text,
  corretor_status text, outros_corretores integer, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin') then
    raise exception 'Só o administrador repassa negócios.' using errcode = '42501';
  end if;

  return query
  select d.id, d.code, c.full_name, s.label, d.status_detail,
         d.vgv_gross, d.month_base, p.id, p.full_name, p.status::text,
         (select count(*)::int from public.deal_participants o
           where o.deal_id = d.id and o.role = 'broker' and o.profile_id <> p.id),
         d.updated_at
    from public.deals d
    join public.deal_participants dp on dp.deal_id = d.id and dp.role = 'broker'
    join public.profiles p on p.id = dp.profile_id and p.status <> 'active'
    left join public.pipeline_stages s on s.id = d.stage_id
    left join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
   where d.outcome = 'open'
   order by p.full_name, d.updated_at desc;
end;
$$;
comment on function public.negocios_de_corretores_inativos() is
  'Negócios abertos com corretor que não está ativo (desligado ou suspenso), para o repasse (0327). Só admin/sócio.';
revoke all on function public.negocios_de_corretores_inativos() from public, anon;
grant execute on function public.negocios_de_corretores_inativos() to authenticated;

create or replace function public.repassar_negocios(p_de uuid, p_para uuid, p_deal_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_deal uuid;
  v_feitos integer := 0;
  v_papel text;
  v_lideres uuid[];
  v_nome_de text;
  v_nome_para text;
begin
  if not public.has_any_role('admin') then
    raise exception 'Só o administrador repassa negócios.' using errcode = '42501';
  end if;
  if p_de is null or p_para is null or p_de = p_para then
    raise exception 'Escolha o corretor de origem e um corretor de destino diferente.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_deal_ids, 1), 0) = 0 then
    raise exception 'Escolha ao menos um negócio.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = p_de and status = 'active') then
    raise exception 'O corretor de origem ainda está ativo: o repasse é para quem saiu.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p join public.user_roles r on r.profile_id = p.id and r.role = 'broker'
     where p.id = p_para and p.status = 'active'
  ) then
    raise exception 'O corretor de destino precisa estar ativo e ser corretor.' using errcode = '22023';
  end if;

  select full_name into v_nome_de from public.profiles where id = p_de;
  select full_name into v_nome_para from public.profiles where id = p_para;

  for v_deal in
    select d.id from public.deals d
     where d.id = any (p_deal_ids)
       and d.outcome = 'open'
       and exists (select 1 from public.deal_participants dp
                    where dp.deal_id = d.id and dp.role = 'broker' and dp.profile_id = p_de)
     for update of d
  loop
    -- Entra primeiro e sai depois: o negócio nunca fica sem corretor no meio.
    -- Já estava no rateio: não duplica (o índice é por deal, perfil e papel).
    insert into public.deal_participants (deal_id, profile_id, role, auto_added)
    values (v_deal, p_para, 'broker', false)
    on conflict (deal_id, profile_id, role) do nothing;
    delete from public.deal_participants
     where deal_id = v_deal and role = 'broker' and profile_id = p_de;

    -- Liderança das equipes dos corretores que ficaram no negócio.
    foreach v_papel in array array['manager', 'director'] loop
      select coalesce(array_agg(distinct x), '{}') into v_lideres
        from public.deal_participants b
        join public.team_members tm on tm.profile_id = b.profile_id and tm.left_at is null
        join public.teams t on t.id = tm.team_id and t.active
        cross join lateral unnest(case when v_papel = 'manager' then array[t.manager_id]
                                       else array[t.director_id, t.co_director_id] end) as x
       where b.deal_id = v_deal and b.role = 'broker' and x is not null;
      if cardinality(v_lideres) > 0 then
        delete from public.deal_participants
         where deal_id = v_deal and role = v_papel and not (profile_id = any (v_lideres));
      end if;
    end loop;

    insert into public.deal_history (deal_id, actor_id, kind, to_value, detail)
    values (v_deal, v_actor, 'comment',
            format('REPASSE: negócio passado de %s (inativo) para %s.', v_nome_de, v_nome_para),
            jsonb_build_object('repasse', true, 'de', p_de, 'para', p_para));
    v_feitos := v_feitos + 1;
  end loop;

  return v_feitos;
end;
$$;
comment on function public.repassar_negocios(uuid, uuid, uuid[]) is
  'Passa os negócios ABERTOS escolhidos do corretor inativo p_de para o corretor ativo p_para: troca no rateio, refaz a liderança pela equipe e registra no histórico (0327). Só admin/sócio. Devolve quantos foram repassados.';
revoke all on function public.repassar_negocios(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.repassar_negocios(uuid, uuid, uuid[]) to authenticated;
