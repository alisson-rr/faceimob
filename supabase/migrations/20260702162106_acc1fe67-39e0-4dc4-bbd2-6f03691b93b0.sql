CREATE OR REPLACE FUNCTION public.sync_deal_to_cca()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.developer IN ('MRV','Tenda','TENDA','Direcional','DIRECIONAL') THEN
    INSERT INTO public.cca_deals (deal_id, status, notes)
    VALUES (NEW.id, 'credit_analysis'::cca_status, NEW.notes)
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;