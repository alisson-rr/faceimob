-- =============================================================================
-- 0147 · search_path fixo nas funções auxiliares do push (0143)
--
-- O linter do Supabase (function_search_path_mutable) acusou push_category,
-- push_destino e push_pendentes: sem `set search_path`, a resolução de nomes
-- dentro delas depende do search_path de quem chama. Hoje só funções SECURITY
-- DEFINER com search_path fixo e a service role as chamam, mas o push_category
-- tem EXECUTE para authenticated (o aviso local do Electron usa). Fixar custa
-- uma linha e tira a dúvida.
-- =============================================================================

alter function public.push_category(text)          set search_path = public, pg_temp;
alter function public.push_destino(uuid, text)     set search_path = public, pg_temp;
alter function public.push_pendentes(integer)      set search_path = public, pg_temp;
