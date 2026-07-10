
CREATE OR REPLACE FUNCTION public.get_daily_team_broker_month_summary(_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from  date := date_trunc('month', v_today)::date;
  v_to    date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  v_rows  jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      e.broker_id,
      MAX(e.broker_name) AS broker_name,
      COALESCE(SUM(e.leads),0)              AS leads,
      COALESCE(SUM(e.ligacoes),0)           AS ligacoes,
      COALESCE(SUM(e.coleta_docs),0)        AS coleta_docs,
      COALESCE(SUM(e.atendimentos),0)       AS atendimentos,
      COALESCE(SUM(e.propostas),0)          AS propostas,
      COALESCE(SUM(e.visitas_agendadas),0)  AS visitas_agendadas,
      COALESCE(SUM(e.visitas_realizadas),0) AS visitas_realizadas,
      COALESCE(SUM(e.analises),0)           AS analises,
      COALESCE(SUM(e.aprovados),0)          AS aprovados,
      COALESCE(SUM(e.vendas),0)             AS vendas,
      COUNT(DISTINCT r.report_date)         AS days_filled
    FROM public.daily_team_reports r
    JOIN public.daily_broker_entries e ON e.report_id = r.id
    WHERE r.team_id = _team_id
      AND r.report_date BETWEEN v_from AND v_to
    GROUP BY e.broker_id
  ) x;

  RETURN jsonb_build_object('rows', v_rows, 'from', v_from, 'to', v_to);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_daily_team_broker_month_summary(uuid) TO anon, authenticated, service_role;
