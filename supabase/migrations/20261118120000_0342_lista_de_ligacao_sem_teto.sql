-- =============================================================================
-- 0342 · Lista de ligação inteira, sem o teto de 1.000 linhas
--
-- 18/11/2026: a lista de novembro DDD 51 parava em 1.000. Em função que
-- devolve linhas, o PostgREST aplica o `db-max-rows` (1.000) ANTES do offset:
-- a segunda parte vinha vazia e o `count=exact` dizia 1000 no total — a busca
-- em partes da 0340 não tinha efeito. Um único valor jsonb não sofre esse
-- corte. As regras e permissões continuam nas duas funções de antes
-- (`lista_de_ligacao()` da liderança e a de mês/DDD só do admin); esta só
-- empacota o resultado.
-- =============================================================================

create or replace function public.lista_de_ligacao_completa(
  p_inicio date default null,
  p_fim date default null,
  p_ddd text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_inicio is null and p_fim is null and p_ddd is null then
    return (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.lista_de_ligacao() l);
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.lista_de_ligacao(p_inicio, p_fim, p_ddd) l);
end;
$$;
revoke all on function public.lista_de_ligacao_completa(date, date, text) from public, anon;
grant execute on function public.lista_de_ligacao_completa(date, date, text) to authenticated, service_role;
