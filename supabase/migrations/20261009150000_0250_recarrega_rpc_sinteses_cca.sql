-- A migration 0248 criou a RPC usada pelo segundo filtro do CCA. Em produção,
-- o PostgREST manteve o cache anterior e respondeu como se a função ainda não
-- existisse. Recarregar o schema publica a RPC; nenhuma linha e nenhuma data de
-- negócio são alteradas.
notify pgrst, 'reload schema';

