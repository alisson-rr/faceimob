-- =============================================================================
-- O sino de notificações — o que a tela passou a depender do banco.
--
-- Duas mudanças de front nasceram apoiadas em policies que ninguém verificava:
--
--   1. O CONTADOR DO BADGE deixou de ser `items.filter(...)` sobre a página
--      baixada (teto de 30) e virou uma consulta de contagem própria. As duas
--      — lista e contagem — atravessam a MESMA policy de SELECT, e é isso que
--      impede o número de discordar da lista. Se `notifications_select` deixar
--      de restringir a `profile_id = auth.uid()` e `channel = 'in_app'`, o
--      corretor passa a contar aviso de outra pessoa (ou a contar a linha de
--      `whatsapp`, que é do despachante e não dele) — e o badge some com o
--      dobro do número certo sem nada quebrar.
--
--   2. O BOTÃO DE APAGAR só existe porque `notifications_delete` já permitia
--      apagar a própria linha. Some a policy, e o botão passa a errar em
--      silêncio: o PostgREST responde 204 para um DELETE que a RLS recusou.
--      (Quem trata isso do lado da tela é o `select('id')` de
--      `deleteNotification`, em src/integrations/supabase/notifications.ts.
--      Este assert é a outra ponta: garantir que o botão tem direito de
--      existir.)
--
-- O que este arquivo NÃO prova: que o despacho por WhatsApp funciona. `channel`
-- só aparece aqui como a fronteira entre o que o sino mostra e o que o
-- `notify-dispatch` entrega.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.assert_eq(got anyelement, want anyelement, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % | esperado=% obtido=%', label, want, got;
  end if;
  raise notice '  ok  %', label;
end;
$$;

\echo '== policies do sino =='

do $$
declare
  v_select text;
  v_delete text;
begin
  select qual into v_select
    from pg_policies
   where schemaname = 'public' and tablename = 'notifications' and cmd = 'SELECT';

  perform pg_temp.assert_eq(v_select is not null, true,
    'notifications tem policy de SELECT');

  -- Dono: sem isto, a contagem do badge somaria aviso de outra pessoa.
  perform pg_temp.assert_eq(v_select like '%auth.uid()%', true,
    'SELECT de notifications e restrito ao proprio perfil');

  -- Canal: a linha `whatsapp` existe para o despachante, nao para o sino.
  -- Contar as duas dobraria o numero que o corretor le.
  perform pg_temp.assert_eq(v_select like '%in_app%', true,
    'SELECT de notifications so expoe o canal in_app');

  select qual into v_delete
    from pg_policies
   where schemaname = 'public' and tablename = 'notifications' and cmd = 'DELETE';

  perform pg_temp.assert_eq(v_delete is not null, true,
    'notifications tem policy de DELETE (o botao de apagar depende dela)');
  perform pg_temp.assert_eq(v_delete like '%auth.uid()%', true,
    'DELETE de notifications alcanca so a propria linha');
end;
$$;

\echo '== o sino nao e superficie anonima =='

do $$
begin
  -- A tabela inteira fica atras de sessao: as unicas policies sao de
  -- `authenticated`. `anon` lendo notificacao entregaria nome de lead e prazo
  -- de atendimento a quem so tem a URL.
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'notifications'
        and 'anon' = any (roles)),
    0,
    'nenhuma policy de notifications alcanca anon'
  );
end;
$$;

\echo '== menu.settings foi aposentado (0072) =='

do $$
begin
  -- `/settings` e o FALLBACK do pos-login (routePermissions.ts) e por isso saiu
  -- de `ROUTE_PERMISSION`. Enquanto a permissao continuasse no catalogo, a aba
  -- Menu da tela de Permissoes seguiria oferecendo um interruptor que grava em
  -- `role_permissions` e o sistema ignora — nenhuma policy consulta o codigo e
  -- a barra lateral libera rota sem codigo.
  --
  -- Se alguem reintroduzir `menu.settings`, ou o guard da rota volta, ou o
  -- interruptor volta a mentir. Este assert quebra antes disso chegar na tela.
  perform pg_temp.assert_eq(
    (select count(*)::int from public.permissions where code = 'menu.settings'),
    0,
    'menu.settings nao esta mais no catalogo de permissoes'
  );
  perform pg_temp.assert_eq(
    (select count(*)::int from public.role_permissions where permission = 'menu.settings'),
    0,
    'nenhuma concessao de menu.settings sobrou em role_permissions'
  );

  -- E a contraprova de que ele era mesmo morto: nenhuma policy o consulta.
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_policies
      where coalesce(qual, '') like '%menu.settings%'
         or coalesce(with_check, '') like '%menu.settings%'),
    0,
    'nenhuma policy dependia de menu.settings'
  );
end;
$$;

\echo 'OK 72_entrada_sino'
