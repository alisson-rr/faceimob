CREATE OR REPLACE FUNCTION public.get_daily_team_month_summary(_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from  date := date_trunc('month', v_today)::date;
  v_to    date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  v_totals jsonb;
  v_filled_dates date[];
BEGIN
  SELECT jsonb_build_object(
    'leads',        COALESCE(SUM(e.leads),0),
    'ligacoes',     COALESCE(SUM(e.ligacoes),0),
    'coleta_docs',  COALESCE(SUM(e.coleta_docs),0),
    'atendimentos', COALESCE(SUM(e.atendimentos),0),
    'propostas',    COALESCE(SUM(e.propostas),0),
    'visitas_agendadas',  COALESCE(SUM(e.visitas_agendadas),0),
    'visitas_realizadas', COALESCE(SUM(e.visitas_realizadas),0),
    'analises',     COALESCE(SUM(e.analises),0),
    'aprovados',    COALESCE(SUM(e.aprovados),0),
    'vendas',       COALESCE(SUM(e.vendas),0)
  )
  INTO v_totals
  FROM public.daily_team_reports r
  JOIN public.daily_broker_entries e ON e.report_id = r.id
  WHERE r.team_id = _team_id
    AND r.report_date BETWEEN v_from AND v_to;

  SELECT COALESCE(array_agg(DISTINCT r.report_date), '{}')
    INTO v_filled_dates
    FROM public.daily_team_reports r
   WHERE r.team_id = _team_id
     AND r.report_date BETWEEN v_from AND v_to;

  RETURN jsonb_build_object(
    'totals', COALESCE(v_totals, '{}'::jsonb),
    'filled_dates', to_jsonb(v_filled_dates),
    'from', v_from,
    'to', v_to,
    'today', v_today
  );
END;
$$;