-- =============================================================================
-- Entrada no sistema — o que o pós-login e o sino dependem do banco.
--
-- O QUE ESTE ARQUIVO PROVA (e o que NÃO prova)
--
--   1. `notifications.link` é um destino de navegação: o sino chama
--      `navigate()` com ele. Caminho que não é interno (`//host`, `\\host`,
--      `https://…`, `javascript:`) é redirecionamento para outra origem. A
--      lista branca abaixo é a MESMA de `INTERNAL_PATH`
--      (src/lib/notificationLink.ts) e de `safeRedirect`
--      (src/lib/routePermissions.ts) — o bloco de sondas existe para que o
--      assert seguinte não passe por tabela vazia: sem elas, `count(*) = 0`
--      diria "nenhum link torto" tanto com a regra certa quanto com uma regra
--      que não casa nada.
--
--   2. O bucket `avatars` tem teto de tamanho e lista de tipos (0054). É a
--      única trava que vale: as DUAS telas que sobem foto (Settings e
--      BrokerEditModal) validam no cliente, e validação de cliente não é
--      fronteira.
--
-- O que este arquivo NÃO prova: que o seed parou de escrever '/daily'. O
-- harness roda migrations + tests e NÃO roda `supabase/seeds/`, então o assert
-- de '/daily' abaixo só alarma em base semeada (`db:reset` local,
-- homologação). A correção na origem — trocar '/daily' por '/checkpoint' em
-- supabase/seeds/040_reports_game_workspace.sql:164 — está registrada como
-- pendência para o dono daquele arquivo; enquanto ela não sair, a 0054 é um
-- remendo de uma execução só, porque o seed roda DEPOIS das migrations.
--
-- (O assert de `menu.settings` saiu junto com o guard de `/settings`: a rota
-- deixou de exigir permissão em src/lib/routePermissions.ts justamente para o
-- fallback do pós-login não depender de concessão nenhuma. Quem cobra isso
-- agora é src/lib/routePermissions.test.ts.)
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

\echo '== lista branca de destino de notificacao =='

do $$
declare
  regra constant text := '^/(?![/\\])[A-Za-z0-9._~/?=&%-]*$';
  v text;
begin
  foreach v in array array['/checkpoint', '/pipeline', '/leads?lead=abc', '/'] loop
    perform pg_temp.assert_eq(v ~ regra, true, format('aceita caminho interno %L', v));
  end loop;

  -- Os formatos que enganam validação ingênua. Tab, CR e LF entram na lista
  -- porque são REMOVIDOS na análise de URL do navegador: '/<TAB>/host' vira
  -- '//host', que é justamente o que a regra existe para barrar.
  foreach v in array array[
    '//evil.example', '/\evil.example', 'https://evil.example',
    'javascript:alert(1)', 'pipeline', '/ evil',
    E'/\tevil.example', E'/\revil', E'/\nevil'
  ] loop
    perform pg_temp.assert_eq(v ~ regra, false, format('recusa destino externo %L', v));
  end loop;
end;
$$;

\echo '== destino das notificacoes gravadas =='

select pg_temp.assert_eq(
  (select count(*) from public.notifications
    where link is not null and link !~ '^/(?![/\\])[A-Za-z0-9._~/?=&%-]*$'),
  0::bigint,
  'todo link de notificacao e um caminho interno'
);

-- Só alarma em base semeada — ver o cabeçalho.
select pg_temp.assert_eq(
  (select count(*) from public.notifications where link = '/daily'),
  0::bigint,
  'nenhuma notificacao aponta para /daily (rota inexistente sem parametro)'
);

\echo '== teto do bucket de avatar =='

do $$
begin
  -- O stub de `storage.buckets` do harness não tem as colunas de limite; nesse
  -- ambiente não há o que conferir, e dizer isso é melhor que passar calado.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    raise notice '  -- storage.buckets reduzido (stub): limite de avatar nao verificavel aqui';
    return;
  end if;

  perform pg_temp.assert_eq(
    (select file_size_limit from storage.buckets where id = 'avatars'),
    (5 * 1024 * 1024)::bigint,
    'bucket avatars limita o arquivo a 5 MB'
  );
  perform pg_temp.assert_eq(
    (select allowed_mime_types from storage.buckets where id = 'avatars'),
    array['image/jpeg', 'image/png', 'image/webp'],
    'bucket avatars so aceita imagem'
  );
end;
$$;

\echo 'OK 54_entrada'
