-- =============================================================================
-- 0039 — O checkpoint da diretoria diz quem cobrar e entrega o mês que rotula
--
-- Dois achados da auditoria de 01/09 em `public_director_checkpoint`:
--
--  1. "Clique para ver quem não preencheu" abria um diálogo com "Gerente: —".
--     A RPC nunca devolveu o gerente; `teams.manager_id` está ali do lado. O
--     nome sai pelo mesmo padrão do nome do diretor, que a RPC já expõe — o
--     link é protegido por PIN e mostra a operação inteira, o nome do gerente
--     não acrescenta exposição.
--  2. "Funil acumulado — mês" e "Resumo do mês" somavam a semana navegada e
--     escreviam o mês de hoje no título. Não há como somar o mês no cliente sem
--     cinco chamadas públicas (e errando na semana que cruza o mês), então o
--     bloco `month` nasce aqui: do dia 1 do mês da semana navegada até o fim
--     desse mês ou hoje, o que vier antes. Os `missing_days` continuam
--     semanais — é a cobrança da reunião de segunda-feira.
--
-- Mesma assinatura, mesmo grant, mesma recusa em NULL (0034); `pin_required`
-- e o contrato `teams[].team_id/team_name/daily_slug/totals` da 0026 ficam.
-- =============================================================================

create or replace function public.public_director_checkpoint(
  p_slug       text,
  p_week_start date default null,
  p_pin        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate   public.public_links;
  v_link        public.public_links;
  v_start       date;
  v_end         date;
  v_month_start date;
  v_month_end   date;
  v_out         jsonb;
begin
  -- Permite à tela pedir o PIN sem expor os dados da diretoria.
  select * into v_candidate
  from public.public_links
  where slug = p_slug
    and kind = 'director_checkpoint'
    and active
    and (expires_at is null or expires_at > now());

  if not found then
    return null;
  end if;

  if v_candidate.pin_hash is not null
     and (p_pin is null or btrim(p_pin) = '') then
    return jsonb_build_object('pin_required', true);
  end if;

  v_link := private.resolve_public_link(p_slug, p_pin);
  if v_link.id is null or v_link.kind <> 'director_checkpoint' then
    return null;
  end if;

  v_start := coalesce(p_week_start, date_trunc('week', current_date)::date);
  v_end   := v_start + 6;

  -- O mês acompanha a semana navegada. Semana futura: intervalo vazio, zeros.
  v_month_start := date_trunc('month', v_start)::date;
  v_month_end   := least((v_month_start + interval '1 month')::date - 1, current_date);

  select jsonb_build_object(
    'director',   (select p.full_name from public.profiles p where p.id = v_link.director_id),
    'week_start', v_start,
    'week_end',   v_end,
    'targets', (
      select jsonb_build_object(
        'lead_to_analysis_pct',     ft.lead_to_analysis_pct,
        'analysis_to_approval_pct', ft.analysis_to_approval_pct,
        'approval_to_sale_pct',     ft.approval_to_sale_pct
      )
      from public.funnel_targets ft
      where (ft.scope = 'director' and ft.director_id = v_link.director_id)
         or ft.scope = 'global'
      order by (ft.scope = 'director') desc, ft.effective_from desc
      limit 1
    ),
    'month', jsonb_build_object(
      'start', v_month_start,
      'end',   v_month_end,
      'totals', (
        select jsonb_build_object(
          'leads',             coalesce(sum(e.leads), 0),
          'calls',             coalesce(sum(e.calls), 0),
          'doc_collections',   coalesce(sum(e.doc_collections), 0),
          'visits_scheduled',  coalesce(sum(e.visits_scheduled), 0),
          'visits_done',       coalesce(sum(e.visits_done), 0),
          'analyses_sent',     coalesce(sum(e.analyses_sent), 0),
          'analyses_approved', coalesce(sum(e.analyses_approved), 0),
          'sales',             coalesce(sum(e.sales), 0)
        )
        from public.teams t
        join public.daily_reports r
          on r.team_id = t.id and r.report_date between v_month_start and v_month_end
        join public.daily_entries e on e.report_id = r.id
        where t.director_id = v_link.director_id and t.active
      )
    ),
    'teams', coalesce((
      select jsonb_agg(team_block order by team_name)
      from (
        select
          t.name as team_name,
          jsonb_build_object(
            'team_id',      t.id,
            'team_name',    t.name,
            'manager_name', (select p.full_name from public.profiles p where p.id = t.manager_id),
            'daily_slug', (
              select pl.slug
              from public.public_links pl
              where pl.kind = 'daily_team'
                and pl.team_id = t.id
                and pl.active
                and (pl.expires_at is null or pl.expires_at > now())
              order by pl.created_at desc
              limit 1
            ),
            'totals', jsonb_build_object(
              'leads',             coalesce(sum(e.leads), 0),
              'calls',             coalesce(sum(e.calls), 0),
              'doc_collections',   coalesce(sum(e.doc_collections), 0),
              'visits_scheduled',  coalesce(sum(e.visits_scheduled), 0),
              'visits_done',       coalesce(sum(e.visits_done), 0),
              'analyses_sent',     coalesce(sum(e.analyses_sent), 0),
              'analyses_approved', coalesce(sum(e.analyses_approved), 0),
              'sales',             coalesce(sum(e.sales), 0)
            ),
            'missing_days', (
              select coalesce(jsonb_agg(d::date order by d), '[]'::jsonb)
              from generate_series(v_start, least(v_end, current_date), interval '1 day') d
              where not exists (
                select 1 from public.daily_reports r2
                where r2.team_id = t.id and r2.report_date = d::date
              )
            )
          ) as team_block
        from public.teams t
        left join public.daily_reports r
          on r.team_id = t.id and r.report_date between v_start and v_end
        left join public.daily_entries e on e.report_id = r.id
        where t.director_id = v_link.director_id and t.active
        group by t.id, t.name, t.manager_id
      ) s
    ), '[]'::jsonb)
  ) into v_out;

  update public.public_links set last_seen_at = now() where id = v_link.id;

  return v_out;
end;
$$;

comment on function public.public_director_checkpoint(text, date, text) is
  'Funil da semana por equipe (com gerente e link do Diário), pendências da semana e acumulado do mês da semana navegada. NULL em qualquer recusa.';

grant execute on function public.public_director_checkpoint(text, date, text) to anon, authenticated;
