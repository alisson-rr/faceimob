-- =============================================================================
-- 0207 — mês-base até dois meses à frente; diretoria sem ex-gerente
--
-- Pedidos do cliente em 03/10/2026:
--   · "deixe apenas 2 meses para frente para alterar data base": a troca com
--     motivo (0201) recusa mês além de corrente + 2. A tela mostra a mesma faixa.
--   · "a Verônica não é mais gerente e aparece como gerente na diretoria": a
--     causa é a equipe que ela liderava continuar ATIVA com ela em
--     `teams.manager_id` — tirar a função não mexe na equipe. O resumo da
--     diretoria (0202) passa a mostrar como gerente só quem ainda tem a função
--     de gerente ou diretor e está ativo; o ajuste definitivo é o admin dar um
--     gerente novo à equipe ou desativá-la em Equipes.
-- =============================================================================

create or replace function public.alterar_mes_base(p_deal_id uuid, p_mes date, p_motivo text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal   public.deals;
  v_mes    date := date_trunc('month', p_mes)::date;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if p_mes is null then
    raise exception 'Escolha o novo mês-base.' using errcode = '22023';
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 1000 then
    raise exception 'Escreva o motivo da troca do mês-base (de 3 a 1000 caracteres).' using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not (public.is_admin()
          or (public.has_any_role('manager', 'director') and public.can_edit_deal(p_deal_id))) then
    raise exception 'Só o administrador, o gerente ou o diretor do negócio altera o mês-base.' using errcode = '42501';
  end if;

  -- 0207: no máximo dois meses à frente do mês corrente (horário de Brasília).
  if v_mes > (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '2 months')::date then
    raise exception 'O mês-base pode ir no máximo dois meses à frente.' using errcode = '22023';
  end if;

  if v_deal.month_base = v_mes then
    raise exception 'O negócio já está nesse mês-base.' using errcode = '22023';
  end if;

  update public.deals set month_base = v_mes where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment',
          'MÊS-BASE ALTERADO de ' || coalesce(to_char(v_deal.month_base, 'MM/YYYY'), '—')
          || ' para ' || to_char(v_mes, 'MM/YYYY') || ': ' || v_motivo);
end;
$$;

revoke all on function public.alterar_mes_base(uuid, date, text) from public, anon;
grant execute on function public.alterar_mes_base(uuid, date, text) to authenticated;

create or replace function public.resumo_da_diretoria(p_mes date)
returns table (
  director_id   uuid,
  director_name text,
  team_id       uuid,
  team_name     text,
  manager_name  text,
  vendas        integer,
  vgv           numeric,
  total_vendas  integer,
  total_vgv     numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with diretorias as (
    select distinct t.director_id
      from public.teams t
     where t.active and t.director_id is not null
       and auth.uid() is not null
       and (public.is_admin() or auth.uid() in (t.manager_id, t.director_id))
  ),
  equipes as (
    select t.id, t.name, t.director_id, t.manager_id
      from public.teams t
      join diretorias d on d.director_id = t.director_id
     where t.active
  ),
  vendas as (
    select distinct e.director_id, e.id as team_id, dl.id as deal_id, dl.vgv_net
      from public.deals dl
      left join public.deal_status_groups g on g.id = dl.status_group_id
      join public.deal_participants dp on dp.deal_id = dl.id and dp.role = 'broker'
      join public.team_members tm on tm.profile_id = dp.profile_id and tm.left_at is null
      join equipes e on e.id = tm.team_id
     where dl.month_base = date_trunc('month', p_mes)::date
       and (dl.outcome = 'won' or (dl.outcome = 'open' and g.code = 'VENDA'))
  ),
  totais as (
    select x.director_id, count(*)::int as n, coalesce(sum(x.vgv_net), 0) as v
      from (select distinct v.director_id, v.deal_id, v.vgv_net from vendas v) x
     group by x.director_id
  )
  select e.director_id,
         dp.full_name,
         e.id,
         e.name,
         mp.full_name,
         (select count(*)::int from vendas v where v.team_id = e.id),
         (select coalesce(sum(v.vgv_net), 0) from vendas v where v.team_id = e.id),
         coalesce(tt.n, 0),
         coalesce(tt.v, 0)
    from equipes e
    join public.profiles dp on dp.id = e.director_id
    -- 0207: só é gerente quem ainda tem a função e está ativo. Tirar a função
    -- não mexe na equipe que a pessoa liderava; a equipe segue (os corretores
    -- dela contam), mas sem gerente, até o admin ajustar em Equipes.
    left join public.profiles mp on mp.id = e.manager_id and mp.status = 'active'
      and exists (select 1 from public.user_roles ur
                   where ur.profile_id = mp.id and ur.role in ('manager', 'director'))
    left join totais tt on tt.director_id = e.director_id
   order by dp.full_name, 7 desc, e.name;
$$;

revoke all on function public.resumo_da_diretoria(date) from public, anon;
grant execute on function public.resumo_da_diretoria(date) to authenticated;
