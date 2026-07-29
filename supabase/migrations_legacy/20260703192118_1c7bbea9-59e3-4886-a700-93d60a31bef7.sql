
-- Add role column to brokers to differentiate managers, directors, and brokers
ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'broker';

-- Reset any existing manager role and set only the 8 provided people as managers
UPDATE public.brokers SET role = 'broker' WHERE role = 'manager';

UPDATE public.brokers SET role = 'manager', active = true
WHERE id IN (
  'c7758278-70c9-4b5f-bd21-bd445755465d', -- Alexandre Chaves
  '15e448a2-a7f1-4451-b595-217c3878644c', -- Alisson Luiz
  '19d6f0e0-d3d6-4fb6-8e81-c096d33e00a9', -- Daiane Dias
  'eb859acf-01b8-4235-b60b-a18ac66230d7', -- Jose Portilho
  'dc488f7a-3c0d-4cdd-b329-ed8972217cb5', -- Leonardo Vallier
  '386aa8c6-30c7-41ad-a473-c93e20d6071b', -- Susana Cristina Prates
  '1296f605-51e2-432f-a433-7fbc0adf4fbf', -- Veronica Oliveira
  '526042d1-2b27-4a3d-b386-047ea97f20fe'  -- Victor Rafael
);
