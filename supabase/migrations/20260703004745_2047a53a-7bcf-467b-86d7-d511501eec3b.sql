DROP FUNCTION IF EXISTS public.get_dashboard_bi();

CREATE TABLE IF NOT EXISTS public.dashboard_bi_cache (
  id boolean PRIMARY KEY DEFAULT true,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_bi_cache_single_row CHECK (id = true)
);

GRANT SELECT ON public.dashboard_bi_cache TO anon;
GRANT SELECT ON public.dashboard_bi_cache TO authenticated;
GRANT ALL ON public.dashboard_bi_cache TO service_role;

ALTER TABLE public.dashboard_bi_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dashboard BI cache is readable" ON public.dashboard_bi_cache;
CREATE POLICY "Dashboard BI cache is readable"
ON public.dashboard_bi_cache
FOR SELECT
TO anon, authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.rebuild_dashboard_bi_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  WITH sanitized_deals AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', d.id::text,
        'developer', d.developer,
        'stage', d.stage::text,
        'status', d.status,
        'deal_value', d.deal_value,
        'active', d.active,
        'month_base', COALESCE(d.month_base, to_char(d.created_at, 'MM/YYYY')),
        'created_at', d.created_at,
        'broker1_id', d.broker1_id::text,
        'broker1_name', b1.name,
        'manager1_id', COALESCE(d.manager1_id, b1.manager_id)::text,
        'manager1_name', COALESCE(m1.name, mb.name),
        'director1_id', COALESCE(d.director1_id, b1.director_id)::text,
        'director1_name', COALESCE(dr1.name, db.name)
      )
      ORDER BY d.created_at DESC
    ) AS rows
    FROM public.deals d
    LEFT JOIN public.brokers b1 ON b1.id = d.broker1_id
    LEFT JOIN public.brokers m1 ON m1.id = d.manager1_id
    LEFT JOIN public.brokers mb ON mb.id = b1.manager_id
    LEFT JOIN public.brokers dr1 ON dr1.id = d.director1_id
    LEFT JOIN public.brokers db ON db.id = b1.director_id
  ),
  leads_by_source AS (
    SELECT jsonb_agg(jsonb_build_object('name', source_name, 'v', total) ORDER BY total DESC, source_name) AS rows
    FROM (
      SELECT COALESCE(NULLIF(TRIM(source), ''), 'Sem origem') AS source_name, count(*)::int AS total
      FROM public.leads
      GROUP BY 1
    ) s
  ),
  cca_counts AS (
    SELECT COALESCE(jsonb_object_agg(status_name, total), '{}'::jsonb) AS rows
    FROM (
      SELECT COALESCE(status::text, 'pendente') AS status_name, count(*)::int AS total
      FROM public.cca_deals
      GROUP BY 1
    ) c
  ),
  staff AS (
    SELECT jsonb_build_object(
      'brokersTotal', count(*)::int,
      'active', count(*) FILTER (WHERE active IS DISTINCT FROM false)::int,
      'managers', count(DISTINCT manager_id) FILTER (WHERE manager_id IS NOT NULL)::int,
      'directors', count(DISTINCT director_id) FILTER (WHERE director_id IS NOT NULL)::int
    ) AS row
    FROM public.brokers
  ),
  closed AS (
    SELECT COALESCE(jsonb_agg(month_base ORDER BY month_base), '[]'::jsonb) AS rows
    FROM public.closed_months
  ),
  lead_total AS (
    SELECT count(*)::int AS total FROM public.leads
  )
  SELECT jsonb_build_object(
    'deals', COALESCE((SELECT rows FROM sanitized_deals), '[]'::jsonb),
    'leadsBySource', COALESCE((SELECT rows FROM leads_by_source), '[]'::jsonb),
    'leadsCount', (SELECT total FROM lead_total),
    'ccaCounts', COALESCE((SELECT rows FROM cca_counts), '{}'::jsonb),
    'staff', (SELECT row FROM staff),
    'closedMonths', COALESCE((SELECT rows FROM closed), '[]'::jsonb)
  ) INTO v_payload;

  INSERT INTO public.dashboard_bi_cache (id, payload, updated_at)
  VALUES (true, v_payload, now())
  ON CONFLICT (id) DO UPDATE
  SET payload = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_dashboard_bi_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rebuild_dashboard_bi_cache() FROM anon;
REVOKE ALL ON FUNCTION public.rebuild_dashboard_bi_cache() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_dashboard_bi_cache() TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_dashboard_bi_cache_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.rebuild_dashboard_bi_cache();
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_dashboard_bi_cache_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_dashboard_bi_cache_trigger() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_dashboard_bi_cache_trigger() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_dashboard_bi_cache_trigger() TO service_role;

DROP TRIGGER IF EXISTS refresh_dashboard_bi_cache_deals ON public.deals;
CREATE TRIGGER refresh_dashboard_bi_cache_deals
AFTER INSERT OR UPDATE OR DELETE ON public.deals
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_dashboard_bi_cache_trigger();

DROP TRIGGER IF EXISTS refresh_dashboard_bi_cache_leads ON public.leads;
CREATE TRIGGER refresh_dashboard_bi_cache_leads
AFTER INSERT OR UPDATE OR DELETE ON public.leads
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_dashboard_bi_cache_trigger();

DROP TRIGGER IF EXISTS refresh_dashboard_bi_cache_cca_deals ON public.cca_deals;
CREATE TRIGGER refresh_dashboard_bi_cache_cca_deals
AFTER INSERT OR UPDATE OR DELETE ON public.cca_deals
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_dashboard_bi_cache_trigger();

DROP TRIGGER IF EXISTS refresh_dashboard_bi_cache_brokers ON public.brokers;
CREATE TRIGGER refresh_dashboard_bi_cache_brokers
AFTER INSERT OR UPDATE OR DELETE ON public.brokers
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_dashboard_bi_cache_trigger();

DROP TRIGGER IF EXISTS refresh_dashboard_bi_cache_closed_months ON public.closed_months;
CREATE TRIGGER refresh_dashboard_bi_cache_closed_months
AFTER INSERT OR UPDATE OR DELETE ON public.closed_months
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_dashboard_bi_cache_trigger();

SELECT public.rebuild_dashboard_bi_cache();