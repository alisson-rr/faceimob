-- =============================================================================
-- 0328 · Repasse não leva venda, e o repasse indevido pode ser desfeito
--
-- Achado de 10/11/2026: o repasse (0327) passou negócio "aberto" que já era
-- VENDA para o game — Status 1 do grupo VENDA (em contrato, assinado, ass.
-- banco, RC emitida; 0163). O corretor novo entrou no rateio e pontuou a venda
-- (Alexandre e Débora), e quem vendeu perdeu os pontos.
--
-- 1. O repasse e a lista passam a excluir o que `deal_counts_as_game_sale`
--    já chama de venda: só vai o que está em negociação.
-- 2. `desfazer_repasse(deal)` devolve o negócio a quem estava antes: o corretor
--    original volta ao rateio (e, pelos gatilhos da 0142/0163, recupera a venda
--    e os eventos), quem recebeu sai (e perde os pontos da temporada aberta), e
--    a liderança volta a ser a da última equipe do corretor original.
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
     -- 0328: contrato/assinado (Status 1 VENDA) já é venda: fica com quem vendeu.
     and not public.deal_counts_as_game_sale(d.outcome, d.status_group_id)
   order by p.full_name, d.updated_at desc;
end;
$$;
comment on function public.negocios_de_corretores_inativos() is
  'Negócios em negociação (abertos e fora do Status 1 VENDA) com corretor que não está ativo, para o repasse (0327/0328). Só admin/sócio.';
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
       and not public.deal_counts_as_game_sale(d.outcome, d.status_group_id)
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
  'Passa os negócios EM NEGOCIAÇÃO (abertos e fora do Status 1 VENDA, 0328) escolhidos do corretor inativo p_de para o corretor ativo p_para: troca no rateio, refaz a liderança pela equipe e registra no histórico (0327). Só admin/sócio. Devolve quantos foram repassados.';
revoke all on function public.repassar_negocios(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.repassar_negocios(uuid, uuid, uuid[]) to authenticated;

create or replace function public.desfazer_repasse(p_deal_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_de uuid;
  v_para uuid;
  v_papel text;
  v_lideres uuid[];
begin
  if not public.has_any_role('admin') then
    raise exception 'Só o administrador desfaz repasse.' using errcode = '42501';
  end if;

  select (h.detail->>'de')::uuid, (h.detail->>'para')::uuid into v_de, v_para
    from public.deal_history h
   where h.deal_id = p_deal_id and h.detail->>'repasse' = 'true'
   order by h.created_at desc
   limit 1;
  if v_de is null then
    raise exception 'Este negócio não tem repasse registrado.' using errcode = '22023';
  end if;
  perform 1 from public.deals where id = p_deal_id for update;
  if exists (select 1 from public.deal_participants
              where deal_id = p_deal_id and role = 'broker' and profile_id = v_de)
     or not exists (select 1 from public.deal_participants
              where deal_id = p_deal_id and role = 'broker' and profile_id = v_para) then
    raise exception 'O repasse deste negócio já foi desfeito ou o rateio mudou depois dele.' using errcode = '22023';
  end if;

  -- Volta primeiro, sai depois: o negócio nunca fica sem corretor.
  insert into public.deal_participants (deal_id, profile_id, role, auto_added)
  values (p_deal_id, v_de, 'broker', false)
  on conflict (deal_id, profile_id, role) do nothing;
  delete from public.deal_participants
   where deal_id = p_deal_id and role = 'broker' and profile_id = v_para;

  -- Liderança: a da ÚLTIMA equipe do corretor original (ele saiu, então a
  -- participação pode estar encerrada) mais a das equipes atuais dos outros
  -- corretores que continuam no negócio.
  foreach v_papel in array array['manager', 'director'] loop
    with equipes as (
      (select tm.team_id from public.team_members tm
        where tm.profile_id = v_de
        order by tm.left_at desc nulls first, tm.joined_at desc nulls last, tm.created_at desc
        limit 1)
      union
      select tm.team_id from public.deal_participants b
        join public.team_members tm on tm.profile_id = b.profile_id and tm.left_at is null
       where b.deal_id = p_deal_id and b.role = 'broker' and b.profile_id <> v_de
    )
    select coalesce(array_agg(distinct x), '{}') into v_lideres
      from equipes e
      join public.teams t on t.id = e.team_id
      cross join lateral unnest(case when v_papel = 'manager' then array[t.manager_id]
                                     else array[t.director_id, t.co_director_id] end) as x
     where x is not null;
    if cardinality(v_lideres) > 0 then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      select p_deal_id, x, v_papel, true from unnest(v_lideres) as x
      on conflict (deal_id, profile_id, role) do nothing;
      delete from public.deal_participants
       where deal_id = p_deal_id and role = v_papel and not (profile_id = any (v_lideres));
    end if;
  end loop;

  insert into public.deal_history (deal_id, actor_id, kind, to_value, detail)
  values (p_deal_id, v_actor, 'comment',
          format('REPASSE DESFEITO: negócio voltou para %s.', (select full_name from public.profiles where id = v_de)),
          jsonb_build_object('repasse_desfeito', true, 'de', v_para, 'para', v_de));

  return (select full_name from public.profiles where id = v_de);
end;
$$;
comment on function public.desfazer_repasse(uuid) is
  'Devolve o negócio ao corretor de antes do último repasse (0328): ele volta ao rateio, quem recebeu sai, a liderança volta à da equipe dele e o histórico registra. Só admin/sócio.';
revoke all on function public.desfazer_repasse(uuid) from public, anon;
grant execute on function public.desfazer_repasse(uuid) to authenticated;
