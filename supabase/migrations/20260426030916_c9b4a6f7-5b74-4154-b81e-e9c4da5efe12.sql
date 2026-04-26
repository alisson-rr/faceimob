-- Enable RLS on all tables
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cca_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cca_developers ENABLE ROW LEVEL SECURITY;

-- Allow public read access (SELECT) for all tables to fix the "zero data" issue
-- Note: In production, these should be restricted with auth.uid() checks
CREATE POLICY "Public read access for leads" ON public.leads FOR SELECT USING (true);
CREATE POLICY "Public read access for deals" ON public.deals FOR SELECT USING (true);
CREATE POLICY "Public read access for brokers" ON public.brokers FOR SELECT USING (true);
CREATE POLICY "Public read access for profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Public read access for cca_deals" ON public.cca_deals FOR SELECT USING (true);
CREATE POLICY "Public read access for cca_developers" ON public.cca_developers FOR SELECT USING (true);

-- Allow all access for testing/debugging purposes (this bypasses standard auth checks)
CREATE POLICY "Full access for leads" ON public.leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for deals" ON public.deals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for brokers" ON public.brokers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for cca_deals" ON public.cca_deals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for cca_developers" ON public.cca_developers FOR ALL USING (true) WITH CHECK (true);
