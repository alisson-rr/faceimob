-- 0122 — deal_id_of_object sem cast avaliado antes da guarda
--
-- A 0059 protegia o `::uuid` com um WHERE. A partir do Postgres 18 as funções
-- SQL passam pelo plan cache: num plano customizado o parâmetro vira constante,
-- o planner dobra `'qualquer'::uuid` antes de olhar o WHERE e a chamada estoura
-- 22P02 em vez de devolver NULL. Na policy de storage isso derruba a leitura de
-- caminhos fora do padrão (os `seed/leads/...`). O CASE resolve: o planner
-- descarta o ramo cuja condição dobrou para falso sem avaliar o resultado.
-- `create or replace` mantém os grants (e os revokes da 0080).
create or replace function public.deal_id_of_object(p_name text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when split_part(coalesce(p_name, ''), '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;
