CREATE OR REPLACE FUNCTION public.get_daily_team_report(_team_id uuid, _date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_entries jsonb;
  v_notes text;
  v_filled_by text;
BEGIN
  SELECT id, notes, filled_by_name INTO v_report_id, v_notes, v_filled_by
  FROM public.daily_team_reports
  WHERE team_id = _team_id AND report_date = _date
  LIMIT 1;

  IF v_report_id IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'broker_id', e.broker_id,
    'broker_name', e.broker_name,
    'leads', e.leads, 'ligacoes', e.ligacoes, 'coleta_docs', e.coleta_docs,
    'atendimentos', e.atendimentos, 'propostas', e.propostas,
    'visitas_agendadas', e.visitas_agendadas, 'visitas_realizadas', e.visitas_realizadas,
    'analises', e.analises, 'aprovados', e.aprovados, 'vendas', e.vendas
  )), '[]'::jsonb)
  INTO v_entries
  FROM public.daily_broker_entries e
  WHERE e.report_id = v_report_id;

  RETURN jsonb_build_object(
    'exists', true,
    'notes', v_notes,
    'filled_by_name', v_filled_by,
    'entries', v_entries
  );
END;
$$;