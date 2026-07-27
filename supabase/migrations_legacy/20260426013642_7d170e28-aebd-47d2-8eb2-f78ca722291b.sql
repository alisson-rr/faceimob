-- Create custom types for stages and statuses
DO $$ BEGIN
    CREATE TYPE deal_stage AS ENUM ('incomplete', 'lead', 'proposal', 'visit_scheduled', 'under_analysis', 'approved', 'contract', 'closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'qualified', 'converted', 'lost');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Brokers Table
CREATE TABLE IF NOT EXISTS public.brokers (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Leads Table
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    whatsapp TEXT,
    source TEXT,
    status lead_status DEFAULT 'new',
    broker_id UUID REFERENCES public.brokers(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Deals (Pipeline) Table
CREATE TABLE IF NOT EXISTS public.deals (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    client TEXT NOT NULL,
    developer TEXT,
    project TEXT,
    unit TEXT,
    deal_value DECIMAL(12,2) DEFAULT 0,
    stage deal_stage DEFAULT 'lead',
    status TEXT DEFAULT 'Ativo',
    active BOOLEAN DEFAULT true,
    broker1_id UUID REFERENCES public.brokers(id),
    broker2_id UUID REFERENCES public.brokers(id),
    manager1_id UUID REFERENCES public.brokers(id),
    manager2_id UUID REFERENCES public.brokers(id),
    visit_date DATE,
    visit_result TEXT,
    month_base TEXT,
    notes TEXT,
    history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

-- Simple policies (allowing all authenticated users for now, can be restricted later)
CREATE POLICY "Allow authenticated users to read brokers" ON public.brokers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert brokers" ON public.brokers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update brokers" ON public.brokers FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to read leads" ON public.leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert leads" ON public.leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update leads" ON public.leads FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete leads" ON public.leads FOR DELETE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to read deals" ON public.deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert deals" ON public.deals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update deals" ON public.deals FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete deals" ON public.deals FOR DELETE TO authenticated USING (true);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_brokers_updated_at BEFORE UPDATE ON public.brokers FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
