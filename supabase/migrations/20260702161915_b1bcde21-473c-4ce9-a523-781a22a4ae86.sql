ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS director1_id uuid REFERENCES public.brokers(id);
CREATE INDEX IF NOT EXISTS deals_director1_idx ON public.deals(director1_id);