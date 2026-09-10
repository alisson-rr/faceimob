-- Migration 0024: IP de host único (/32) tem que liberar o check-in.
--
-- Regressão real: com `<<` (contido estritamente) o `/32` nunca casava, então o
-- IP fixo da loja era cadastrado, aparecia na lista e não liberava ninguém.
--
-- Endereços de 198.51.100.0/24 (TEST-NET-2, RFC 5737): reservada para
-- documentação. 203.0.113.0/24 NÃO serve aqui — o `03_crud_audit.sql` cadastra
-- essa faixa inteira, e um teste que roda dentro de uma faixa já liberada não
-- prova nada sobre o /32.
\echo 'ip_is_allowed — host único e faixa'

do $$
declare
  v_profile uuid;
begin
  select id into v_profile from public.profiles where bypass_ip_check is not true limit 1;
  if v_profile is null then
    raise exception 'FALHOU: sem perfil para testar (o bypass mascararia o resultado)';
  end if;

  -- Pré-condição: sem isso, "liberou" não distingue a correção de uma faixa
  -- larga cadastrada por outro teste.
  if public.ip_is_allowed('198.51.100.7'::inet, v_profile) then
    raise exception 'FALHOU: cenário inválido — 198.51.100.7 já está liberado antes do cadastro';
  end if;

  insert into public.allowed_ips (ip_range, label, active)
  values ('198.51.100.7/32', 'teste host 0024', true),
         ('198.51.100.128/25', 'teste faixa 0024', true);

  if not public.ip_is_allowed('198.51.100.7'::inet, v_profile) then
    raise exception 'FALHOU: host cadastrado como /32 não libera o check-in';
  end if;
  raise notice '  ok  /32 libera o próprio host';

  if not public.ip_is_allowed('198.51.100.200'::inet, v_profile) then
    raise exception 'FALHOU: faixa /25 deixou de cobrir os hosts dela';
  end if;
  raise notice '  ok  /25 continua cobrindo a faixa';

  if public.ip_is_allowed('198.51.100.9'::inet, v_profile) then
    raise exception 'FALHOU: IP fora das faixas cadastradas foi liberado';
  end if;
  raise notice '  ok  IP fora das faixas continua barrado';

  delete from public.allowed_ips where label in ('teste host 0024', 'teste faixa 0024');
end
$$;

\echo 'ip_is_allowed ok'
