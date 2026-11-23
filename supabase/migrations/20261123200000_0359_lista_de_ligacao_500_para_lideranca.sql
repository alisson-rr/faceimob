-- =============================================================================
-- 0359 · Lista de ligação: 500 contatos sortidos para gerente e diretor
--
-- Pedido do Douglas (23/11/2026): a lista sem filtro saía com ~30 mil contatos
-- para todo mundo. Gerente e diretor recebem 500 contatos sorteados a cada
-- extração; mês, DDD e lista sem limite seguem só para administrador e sócio
-- (`is_admin()` cobre os dois). O corte fica aqui, no banco: limitar só na
-- tela deixaria a lista inteira a um clique de quem chama a RPC direto.
-- =============================================================================

create or replace function public.lista_de_ligacao()
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.has_permission('leads.call_list') then
    raise exception 'Seu perfil não extrai a lista de ligação.' using errcode = '42501';
  end if;
  if public.is_admin() then
    return query select * from public.lista_de_ligacao_base(
      date_trunc('year', now() at time zone 'America/Sao_Paulo')::date,
      date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
      null);
    return;
  end if;
  return query
  select b.* from public.lista_de_ligacao_base(
    date_trunc('year', now() at time zone 'America/Sao_Paulo')::date,
    date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
    null) b
   order by random()
   limit 500;
end;
$$;
