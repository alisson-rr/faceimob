-- =============================================================================
-- Regressão da 0113 — importar o relatório da Meta sem somar dinheiro duas vezes.
--
-- O que este arquivo prova:
--   1. a importação grava o gasto do relatório e carimba a campanha: o
--      `total_spend` passa a ser a soma do livro, com o período que ele cobre;
--   2. REIMPORTAR O MESMO ARQUIVO NÃO DUPLICA — a chave é campanha + período, e
--      o total continua igual (é a razão de a tabela existir, no lugar de somar
--      no `total_spend`);
--   3. o período SEGUINTE soma, e o período SOBREPOSTO substitui: importar
--      01-31/08 depois de 01-15/08 não pode deixar os quinze primeiros dias
--      contando duas vezes no número que divide o CPL e o ROAS;
--   4. corrigir o gasto à mão devolve a linha para "digitado" — senão a tela
--      afirmaria que o número veio da Meta quando alguém o digitou;
--   5. a permissão é a de `ad_campaigns_write`: corretor leva 42501 e não
--      enxerga o livro;
--   6. UMA LINHA RUIM DERRUBA O ARQUIVO INTEIRO — a importação é uma transação,
--      e meia importação deixaria `total_spend` menor do que a realidade;
--   7. e a 0114: período sobreposto gravado por fora da RPC (a policy é `for
--      all`) é recusado pelo banco, senão o recálculo soma o mesmo dia duas
--      vezes.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check113(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

create or replace function pg_temp.become113(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres, ignorando RLS)
--
--   Adão = admin · Caio = corretor (sem permissão de marketing)
--   Campanha A com R$ 1.234 DIGITADOS — é o valor que o relatório substitui
--   Campanha B zerada
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000011301';
  cor uuid := '00000000-0000-0000-0000-000000011302';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adao@meta113.test', '{"full_name":"Adão Admin 113"}'),
    (cor, 'caio@meta113.test', '{"full_name":"Caio Corretor 113"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;

  insert into public.ad_campaigns (id, external_id, platform, name, total_spend) values
    ('7e000000-0000-0000-0000-000000011301', 'camp-0113-a', 'meta', 'Campanha A 0113', 1234),
    ('7e000000-0000-0000-0000-000000011302', 'camp-0113-b', 'meta', 'Campanha B 0113', 0);
end
$$;

\echo '== 1. o relatório entra e carimba o período que ele cobre =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000011301';
  a   record;
  c   record;
begin
  set role authenticated;
  perform pg_temp.become113(adm);

  select * into a from public.marketing_import_ad_spend($json$[
    {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-08-01","period_end":"2026-08-31","spend":4250.90},
    {"campaign_id":"7e000000-0000-0000-0000-000000011302","period_start":"2026-08-01","period_end":"2026-08-31","spend":3100.00}
  ]$json$::jsonb, 'relatorio-agosto.csv');

  perform pg_temp.check113(a.linhas = 2, format('as duas linhas entram (entraram %s)', a.linhas));
  perform pg_temp.check113(a.campanhas = 2, format('as duas campanhas são carimbadas (foram %s)', a.campanhas));
  perform pg_temp.check113(a.substituidas = 0, 'a primeira importação não substitui nada');

  select * into c from public.ad_campaigns where id = '7e000000-0000-0000-0000-000000011301';
  -- O digitado (1234) SAI: o relatório é o número da plataforma.
  perform pg_temp.check113(c.total_spend = 4250.90,
    format('o gasto digitado dá lugar ao do relatório (ficou %s)', c.total_spend));
  perform pg_temp.check113(c.synced_at is not null, 'a campanha fica carimbada como importada');
  perform pg_temp.check113(c.spend_period_start = date '2026-08-01' and c.spend_period_end = date '2026-08-31',
    'o período do relatório fica visível na campanha');
  reset role;
end
$$;

\echo '== 2. reimportar o mesmo arquivo não soma de novo =='

do $$
declare
  adm   uuid := '00000000-0000-0000-0000-000000011301';
  a     record;
  linhas int;
  total numeric;
begin
  set role authenticated;
  perform pg_temp.become113(adm);

  select * into a from public.marketing_import_ad_spend($json$[
    {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-08-01","period_end":"2026-08-31","spend":4250.90},
    {"campaign_id":"7e000000-0000-0000-0000-000000011302","period_start":"2026-08-01","period_end":"2026-08-31","spend":3100.00}
  ]$json$::jsonb, 'relatorio-agosto.csv');

  perform pg_temp.check113(a.substituidas = 2,
    format('as duas linhas antigas saem no lugar das novas (saíram %s)', a.substituidas));

  select count(*) into linhas from public.ad_campaign_spend
   where campaign_id = '7e000000-0000-0000-0000-000000011301';
  select total_spend into total from public.ad_campaigns
   where id = '7e000000-0000-0000-0000-000000011301';

  -- O ponto da migration: dois envios do mesmo arquivo, um registro só.
  perform pg_temp.check113(linhas = 1, format('a campanha continua com uma linha de período (tem %s)', linhas));
  perform pg_temp.check113(total = 4250.90, format('o total não dobrou (ficou %s)', total));
  reset role;
end
$$;

\echo '== 3. período seguinte soma; período sobreposto substitui =='

do $$
declare
  adm   uuid := '00000000-0000-0000-0000-000000011301';
  a     record;
  c     record;
  linhas int;
begin
  set role authenticated;
  perform pg_temp.become113(adm);

  -- Setembro é outro recorte: entra ao lado de agosto.
  select * into a from public.marketing_import_ad_spend($json$[
    {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-09-01","period_end":"2026-09-30","spend":2000.00}
  ]$json$::jsonb, 'relatorio-setembro.csv');

  select * into c from public.ad_campaigns where id = '7e000000-0000-0000-0000-000000011301';
  perform pg_temp.check113(a.substituidas = 0, 'outro mês não substitui o anterior');
  perform pg_temp.check113(c.total_spend = 6250.90, format('agosto e setembro somam (ficou %s)', c.total_spend));
  perform pg_temp.check113(c.spend_period_start = date '2026-08-01' and c.spend_period_end = date '2026-09-30',
    'o período coberto passa a ir de agosto a setembro');

  -- Recorte DENTRO de agosto: se entrasse ao lado, os dias 10 a 20 contariam
  -- duas vezes no mesmo total.
  select * into a from public.marketing_import_ad_spend($json$[
    {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-08-10","period_end":"2026-08-20","spend":500.00}
  ]$json$::jsonb, 'recorte-parcial.csv');

  select count(*) into linhas from public.ad_campaign_spend
   where campaign_id = '7e000000-0000-0000-0000-000000011301';
  select * into c from public.ad_campaigns where id = '7e000000-0000-0000-0000-000000011301';

  perform pg_temp.check113(a.substituidas = 1, 'o recorte de agosto sai inteiro para o novo entrar');
  perform pg_temp.check113(linhas = 2, format('sobram dois períodos, e não três (tem %s)', linhas));
  perform pg_temp.check113(c.total_spend = 2500.00,
    format('o total não conta agosto duas vezes (ficou %s)', c.total_spend));

  -- Duas importações na MESMA transação, que é o que este bloco acabou de
  -- fazer. Com `imported_at default now()` as duas gravavam o mesmo carimbo, o
  -- gatilho do gasto digitado lia "mudou o total e ninguém re-carimbou" e
  -- apagava a procedência — a tela passava a dizer "digitado" sobre um número
  -- que veio de relatório. O assert fica aqui, e não só no item 4, para a falha
  -- apontar a causa em vez de culpar o rename.
  perform pg_temp.check113(c.synced_at is not null,
    'a segunda importação da mesma transação não apaga o carimbo de relatório');
  perform pg_temp.check113(c.spend_period_start is not null and c.spend_period_end is not null,
    'e o período coberto continua de pé junto com o carimbo');
  reset role;
end
$$;

\echo '== 4. gasto corrigido à mão volta a ser digitado =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000011301';
  c   record;
begin
  set role authenticated;
  perform pg_temp.become113(adm);

  update public.ad_campaigns set total_spend = 999 where id = '7e000000-0000-0000-0000-000000011302';
  select * into c from public.ad_campaigns where id = '7e000000-0000-0000-0000-000000011302';

  perform pg_temp.check113(c.synced_at is null, 'o carimbo de relatório sai quando alguém digita o gasto');
  perform pg_temp.check113(c.spend_period_start is null and c.spend_period_end is null,
    'o período importado sai junto — ele não descreve mais o número gravado');

  -- Corrigir OUTRO campo não pode apagar o carimbo: o formulário reenvia o
  -- mesmo `total_spend` ao salvar uma troca de nome.
  update public.ad_campaigns set name = 'Campanha A 0113 (renomeada)'
   where id = '7e000000-0000-0000-0000-000000011301';
  select * into c from public.ad_campaigns where id = '7e000000-0000-0000-0000-000000011301';
  perform pg_temp.check113(c.synced_at is not null, 'renomear a campanha não desfaz a importação');
  reset role;
end
$$;

\echo '== 5. a porta é a mesma de ad_campaigns_write =='

do $$
declare
  cor   uuid := '00000000-0000-0000-0000-000000011302';
  visiveis int;
begin
  set role authenticated;
  perform pg_temp.become113(cor);

  begin
    perform public.marketing_import_ad_spend($json$[
      {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-10-01","period_end":"2026-10-31","spend":10.00}
    ]$json$::jsonb, null);
    perform pg_temp.check113(false, 'corretor NÃO pode importar gasto de campanha');
  exception when insufficient_privilege then
    perform pg_temp.check113(true, 'corretor leva 42501 ao tentar importar');
  end;

  -- E o livro também não é leitura dele: gasto é dado financeiro.
  select count(*) into visiveis from public.ad_campaign_spend;
  perform pg_temp.check113(visiveis = 0, format('corretor não enxerga o livro do gasto (viu %s)', visiveis));
  reset role;
end
$$;

\echo '== 6. uma linha ruim no meio não deixa NADA gravado =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000011301';
  camp uuid := '7e000000-0000-0000-0000-000000011301';
  linhas_antes int;
  linhas_depois int;
  total_antes numeric;
  total_depois numeric;
begin
  set role authenticated;
  perform pg_temp.become113(adm);

  select count(*) into linhas_antes from public.ad_campaign_spend where campaign_id = camp;
  select total_spend into total_antes from public.ad_campaigns where id = camp;

  -- A PRIMEIRA linha é boa e a segunda está quebrada. A boa é processada antes
  -- de a ruim estourar: se a função não fosse uma transação, novembro ficaria
  -- gravado e o operador veria "não importou" com o dinheiro dentro.
  begin
    perform public.marketing_import_ad_spend($json$[
      {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-11-01","period_end":"2026-11-30","spend":777.00},
      {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":null,"period_end":"2026-12-31","spend":100.00}
    ]$json$::jsonb, 'novembro-com-linha-quebrada.csv');
    perform pg_temp.check113(false, 'a linha sem período tem de derrubar a importação');
  exception when invalid_parameter_value then
    perform pg_temp.check113(true, 'a linha sem período derruba a importação com 22023');
  end;

  select count(*) into linhas_depois from public.ad_campaign_spend where campaign_id = camp;
  select total_spend into total_depois from public.ad_campaigns where id = camp;

  perform pg_temp.check113(linhas_depois = linhas_antes,
    format('a linha boa do mesmo envio NÃO fica gravada (tinha %s, ficou %s)', linhas_antes, linhas_depois));
  perform pg_temp.check113(total_depois = total_antes,
    format('e o total da campanha não se mexe (era %s, ficou %s)', total_antes, total_depois));

  -- O mesmo vale para o gasto negativo, que a tela recusa antes de enviar mas
  -- que o CHECK da tabela é quem garante.
  begin
    perform public.marketing_import_ad_spend($json$[
      {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-11-01","period_end":"2026-11-30","spend":777.00},
      {"campaign_id":"7e000000-0000-0000-0000-000000011301","period_start":"2026-12-01","period_end":"2026-12-31","spend":-5.00}
    ]$json$::jsonb, 'dezembro-negativo.csv');
    perform pg_temp.check113(false, 'gasto negativo tem de derrubar a importação');
  exception when check_violation then
    perform pg_temp.check113(true, 'gasto negativo derruba a importação pelo CHECK da tabela');
  end;

  select count(*) into linhas_depois from public.ad_campaign_spend where campaign_id = camp;
  perform pg_temp.check113(linhas_depois = linhas_antes,
    format('nem a linha boa que veio junto com o valor negativo entra (ficou %s)', linhas_depois));
  reset role;
end
$$;

\echo '== 7. (0114) período sobreposto gravado por fora da RPC é recusado =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000011301';
  camp uuid := '7e000000-0000-0000-0000-000000011301';
  linhas int;
begin
  set role authenticated;
  perform pg_temp.become113(adm);

  -- A campanha já tem 01-31/08 e 10-20/08 substituído por ele (bloco 3). Este
  -- insert vai DIRETO na tabela, que é o que a policy `for all` permite —
  -- exatamente o caminho que não apaga o recorte antigo.
  begin
    insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend)
    values (camp, '2026-08-15', '2026-09-15', 123.00);
    perform pg_temp.check113(false, 'escrita direta NÃO pode criar período sobreposto');
  exception when exclusion_violation then
    perform pg_temp.check113(true, 'o banco recusa o período sobreposto com 23P01');
  end;

  -- Período que não cruza nenhum outro continua entrando: a trava é contra
  -- sobreposição, não contra gravar.
  insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend)
  values (camp, '2026-10-01', '2026-10-31', 50.00);

  select count(*) into linhas from public.ad_campaign_spend where campaign_id = camp;
  perform pg_temp.check113(linhas = 3, format('outubro entra ao lado dos outros dois (tem %s)', linhas));

  delete from public.ad_campaign_spend
   where campaign_id = camp and period_start = date '2026-10-01';
  reset role;
end
$$;

\echo 'OK 0113 + 0114'
