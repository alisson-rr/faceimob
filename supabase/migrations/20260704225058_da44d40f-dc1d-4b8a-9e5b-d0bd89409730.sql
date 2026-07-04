ALTER TABLE public.daily_broker_entries
  ALTER COLUMN leads TYPE numeric(8,1) USING leads::numeric,
  ALTER COLUMN ligacoes TYPE numeric(8,1) USING ligacoes::numeric,
  ALTER COLUMN coleta_docs TYPE numeric(8,1) USING coleta_docs::numeric,
  ALTER COLUMN atendimentos TYPE numeric(8,1) USING atendimentos::numeric,
  ALTER COLUMN propostas TYPE numeric(8,1) USING propostas::numeric,
  ALTER COLUMN visitas_agendadas TYPE numeric(8,1) USING visitas_agendadas::numeric,
  ALTER COLUMN visitas_realizadas TYPE numeric(8,1) USING visitas_realizadas::numeric,
  ALTER COLUMN analises TYPE numeric(8,1) USING analises::numeric,
  ALTER COLUMN aprovados TYPE numeric(8,1) USING aprovados::numeric,
  ALTER COLUMN vendas TYPE numeric(8,1) USING vendas::numeric;