
-- 1) Closed months table
CREATE TABLE public.closed_months (
  month_base text PRIMARY KEY,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.closed_months TO authenticated;
GRANT SELECT ON public.closed_months TO anon;
GRANT ALL ON public.closed_months TO service_role;

ALTER TABLE public.closed_months ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read closed months"
  ON public.closed_months FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can insert closed months"
  ON public.closed_months FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete closed months"
  ON public.closed_months FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Index to speed up dashboard/pipeline aggregations
CREATE INDEX IF NOT EXISTS idx_deals_status_month ON public.deals(status, month_base);
CREATE INDEX IF NOT EXISTS idx_deals_month_base ON public.deals(month_base);
