-- Create table for custom CCA stages
CREATE TABLE IF NOT EXISTS public.cca_stages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  "order" INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cca_stages ENABLE ROW LEVEL SECURITY;

-- Allow all users to read stages
CREATE POLICY "Public read stages" ON public.cca_stages FOR SELECT USING (true);
CREATE POLICY "Admin manage stages" ON public.cca_stages FOR ALL USING (true); -- In a real app, restrict to admins

-- Add some default stages if none exist
INSERT INTO public.cca_stages (name, color, "order")
SELECT 'Análise de Crédito', 'text-amber-400', 0 WHERE NOT EXISTS (SELECT 1 FROM public.cca_stages);
INSERT INTO public.cca_stages (name, color, "order")
SELECT 'Pendência de Documentos', 'text-blue-400', 1 WHERE NOT EXISTS (SELECT 1 FROM public.cca_stages WHERE name = 'Pendência de Documentos');
INSERT INTO public.cca_stages (name, color, "order")
SELECT 'Aprovado', 'text-emerald-400', 2 WHERE NOT EXISTS (SELECT 1 FROM public.cca_stages WHERE name = 'Aprovado');
INSERT INTO public.cca_stages (name, color, "order")
SELECT 'Rejeitado', 'text-red-400', 3 WHERE NOT EXISTS (SELECT 1 FROM public.cca_stages WHERE name = 'Rejeitado');
INSERT INTO public.cca_stages (name, color, "order")
SELECT 'Enviado à Agência', 'text-purple-400', 4 WHERE NOT EXISTS (SELECT 1 FROM public.cca_stages WHERE name = 'Enviado à Agência');

-- Ensure cca_deals exists and has the right structure
CREATE TABLE IF NOT EXISTS public.cca_deals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE UNIQUE,
  status TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cca_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access cca_deals" ON public.cca_deals FOR ALL USING (true);

-- Function to sync deals to CCA if they belong to certain developers
CREATE OR REPLACE FUNCTION public.sync_deal_to_cca()
RETURNS TRIGGER AS $$
BEGIN
  -- If developer is MRV, Tenda or Direcional, ensure a record exists in cca_deals
  IF NEW.developer IN ('MRV', 'Tenda', 'Direcional') THEN
    INSERT INTO public.cca_deals (deal_id, status, notes)
    VALUES (NEW.id, 'Análise de Crédito', NEW.notes)
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_deal_to_cca_trigger
AFTER INSERT ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.sync_deal_to_cca();
