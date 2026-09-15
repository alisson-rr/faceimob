-- =============================================================================
-- 0149 · Status 1 como catálogo próprio, acompanhando o Status 2
--
-- O que este arquivo cobra:
--   1. o catálogo semeado na ordem e nos grupos da tabela do cliente;
--   2. trocar o Status 2 muda o Status 1, pela tela e pelo próprio banco
--      (`cca_cases_sync_esteira_label`);
--   3. trocar o Status 1 à mão: corretor recusado, admin aceito, e a troca fica
--      enquanto o Status 2 não muda;
--   4. escrita no catálogo: corretor não escreve, admin escreve; locked não
--      desativa; value e code imutáveis; nome reservado recusado; texto
--      duplicado (com prefixo, caixa ou NBSP diferentes) recusado;
--   5. anon sem acesso;
--   6. a dedução sem Status 2 e o estado depois do backfill.
--
-- Prefixo 99 e não 149: `validate-schema.sh` roda `supabase/tests/[0-9][0-9]_*`,
-- então nome de três dígitos não é executado por ninguém (mesma nota do 98).
-- UUIDs na faixa `…-000001490001+`, exclusiva deste arquivo.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check149(cond boolean, label text)
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

create or replace function pg_temp.become149(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- Código do Status 1 do negócio, lido como postgres.
create or replace function pg_temp.grupo149(p_deal uuid)
returns text
language sql
as $$
  select g.code
    from public.deals d
    left join public.deal_status_groups g on g.id = d.status_group_id
   where d.id = p_deal;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001490001';
  cor uuid := '00000000-0000-0000-0000-000001490002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@status149.test', '{"full_name":"Admin 149"}'),
    (cor, 'cor@status149.test', '{"full_name":"Corretor 149"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;

  -- Outro teste pode ter fechado o mês corrente; `deals_guard_closed_month`
  -- responderia antes e a mensagem seria outra.
  delete from public.closed_months where period = public.month_start(current_date);
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 1. catálogo semeado na ordem do cliente =='
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check149(
    (select string_agg(code, ',' order by position) from public.deal_status_groups)
      = 'VENDA,PROPOSTA,LEGADO,DISTRATO,OFF',
    'Status 1: VENDA, PROPOSTA, LEGADO, DISTRATO, OFF, nessa ordem e todos ativos');
  perform pg_temp.check149(
    not exists (select 1 from public.deal_status_groups where not active),
    'nenhum Status 1 nasce desativado (LEGADO é desativado pelo cliente depois)');

  -- Os 6 Status 2 que só as colunas da CCA usam entram pela 0150 (ativos, sem
  -- trava); ficam fora da conta para esta checagem seguir medindo a semente.
  perform pg_temp.check149(
    (select count(*) from public.deal_statuses
      where value not in ('EM ANÁLISE', 'VIROU NEGÓCIO COM PENDÊNCIAS', 'ANÁLISE CEOPF',
                          'INCONFORME CEOPF', 'APROVADO/AGUARDANDO AGENDA', 'ENTREVISTA AGENDADA')) = 34
    and (select count(*) from public.deal_statuses
          where active
            and value not in ('EM ANÁLISE', 'VIROU NEGÓCIO COM PENDÊNCIAS', 'ANÁLISE CEOPF',
                              'INCONFORME CEOPF', 'APROVADO/AGUARDANDO AGENDA', 'ENTREVISTA AGENDADA')) = 33
    and (select count(*) from public.deal_statuses where locked) = 10,
    '34 Status 2 (32 do cliente + OFF + PROPOSTA), 33 ativos, 10 travados');

  perform pg_temp.check149(
    (select string_agg(s.value, ',' order by s.position)
       from public.deal_statuses s join public.deal_status_groups g on g.id = s.group_id
      where g.code = 'VENDA')
      = '01. RC EMITIDA,02. ASS. BANCO,03. ASSINADO,04. EM CONTRATO',
    'VENDA tem os 4 da tabela, na ordem');

  perform pg_temp.check149(
    (select g.code from public.deal_statuses s join public.deal_status_groups g on g.id = s.group_id
      where s.value = '18. QUEDA') = 'OFF'
    and (select g.code from public.deal_statuses s join public.deal_status_groups g on g.id = s.group_id
          where s.value = '17. DISTRATO') = 'DISTRATO',
    '"18. QUEDA" é OFF e "17. DISTRATO" é DISTRATO');

  perform pg_temp.check149(
    exists (select 1 from public.deal_statuses where value = 'PROPOSTA' and not active and locked)
    and exists (select 1 from public.deal_statuses where value = 'OFF' and active and locked),
    'PROPOSTA inativo e travado; OFF ativo e travado');

  perform pg_temp.check149(
    (select label from public.deal_statuses where value = '02. ASS. BANCO') = 'ASS. BANCO'
    and (select tone from public.deal_statuses where value = '08. VIROU NEGÓCIO') = 'highlight',
    'nome exibido sem prefixo numerado e tom do front');

  perform pg_temp.check149(
    exists (select 1 from public.role_permissions
             where role = 'admin' and permission = 'deals.manage_statuses' and allowed)
    and exists (select 1 from public.role_permissions
                 where role = 'partner' and permission = 'deals.edit_status_group' and allowed),
    'as duas permissões novas nascem com admin e sócio');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. trocar o Status 2 muda o Status 1 =='
-- -----------------------------------------------------------------------------
do $$
declare
  cor    uuid := '00000000-0000-0000-0000-000001490002';
  v_prop uuid;
  v_deal uuid;
  v_cca  uuid;
begin
  select id into v_prop from public.pipeline_stages where code = 'proposal';

  insert into public.deals (stage_id, created_by) values (v_prop, cor)
  returning id into v_deal;

  perform pg_temp.check149(pg_temp.grupo149(v_deal) = 'PROPOSTA',
    'negócio novo sem Status 2 nasce PROPOSTA');

  perform pg_temp.become149(cor);
  set local role authenticated;
  update public.deals set status_detail = '02. ASS. BANCO' where id = v_deal;
  reset role;

  perform pg_temp.check149(
    (select status_detail from public.deals where id = v_deal) = '02. ASS. BANCO'
    and pg_temp.grupo149(v_deal) = 'VENDA',
    'corretor troca o Status 2 para "02. ASS. BANCO" e o Status 1 vira VENDA');

  perform pg_temp.become149(cor);
  set local role authenticated;
  update public.deals set status_detail = '18. QUEDA' where id = v_deal;
  reset role;

  perform pg_temp.check149(pg_temp.grupo149(v_deal) = 'OFF',
    '"18. QUEDA" leva o Status 1 para OFF');

  perform pg_temp.become149(cor);
  set local role authenticated;
  update public.deals set status_detail = 'RÓTULO QUE NÃO EXISTE 149' where id = v_deal;
  reset role;

  perform pg_temp.check149(pg_temp.grupo149(v_deal) is null,
    'Status 2 fora do catálogo deixa o Status 1 nulo, sem inventar grupo');

  -- O banco escrevendo o Status 2: o caso entra na esteira e
  -- `cca_cases_sync_esteira_label` grava "13. ESTEIRA AGIL" no negócio.
  insert into public.deals (stage_id, created_by, status_detail) values (v_prop, cor, '20. BACEN')
  returning id into v_cca;

  perform pg_temp.check149(pg_temp.grupo149(v_cca) = 'LEGADO',
    'negócio que nasce com "20. BACEN" nasce LEGADO');

  insert into public.cca_cases (deal_id, status) values (v_cca, 'under_review');

  perform pg_temp.check149(
    (select status_detail from public.deals where id = v_cca) = '13. ESTEIRA AGIL'
    and pg_temp.grupo149(v_cca) = 'PROPOSTA',
    'a esteira grava "13. ESTEIRA AGIL" pelo gatilho do CCA e o Status 1 acompanha (PROPOSTA)');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. troca manual do Status 1 =='
-- -----------------------------------------------------------------------------
do $$
declare
  adm      uuid := '00000000-0000-0000-0000-000001490001';
  cor      uuid := '00000000-0000-0000-0000-000001490002';
  v_prop   uuid;
  v_ini    uuid;
  v_legado uuid;
  v_deal   uuid;
  v_msg    text;
begin
  select id into v_prop   from public.pipeline_stages where code = 'proposal';
  select id into v_ini    from public.pipeline_stages where is_initial order by position limit 1;
  select id into v_legado from public.deal_status_groups where code = 'LEGADO';

  insert into public.deals (stage_id, created_by, status_detail)
  values (v_prop, cor, '02. ASS. BANCO')
  returning id into v_deal;

  -- Corretor: recusado, e o Status 1 fica.
  v_msg := null;
  perform pg_temp.become149(cor);
  set local role authenticated;
  begin
    update public.deals set status_group_id = v_legado where id = v_deal;
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.check149(v_msg like '%Status 1%' and pg_temp.grupo149(v_deal) = 'VENDA',
    format('corretor não troca o Status 1 à mão (%s)', coalesce(v_msg, 'passou')));

  -- Corretor criando negócio já com um Status 1 escolhido: mesma regra.
  v_msg := null;
  perform pg_temp.become149(cor);
  set local role authenticated;
  begin
    insert into public.deals (stage_id, created_by, status_group_id) values (v_ini, cor, v_legado);
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.check149(v_msg like '%Status 1%',
    format('corretor não cria negócio com Status 1 diferente da derivação (%s)', coalesce(v_msg, 'passou')));

  -- Admin: aceito.
  perform pg_temp.become149(adm);
  set local role authenticated;
  update public.deals set status_group_id = v_legado where id = v_deal;
  reset role;

  perform pg_temp.check149(pg_temp.grupo149(v_deal) = 'LEGADO',
    'admin troca o Status 1 à mão (VENDA → LEGADO)');

  -- Reenviar o mesmo Status 2 (o que todo salvamento do editor faz) não desfaz.
  perform pg_temp.become149(cor);
  set local role authenticated;
  update public.deals set status_detail = '02. ASS. BANCO' where id = v_deal;
  reset role;

  perform pg_temp.check149(pg_temp.grupo149(v_deal) = 'LEGADO',
    'reenviar o mesmo Status 2 mantém a troca manual');

  -- Status 2 novo: o Status 1 volta a acompanhar.
  perform pg_temp.become149(cor);
  set local role authenticated;
  update public.deals set status_detail = '03. ASSINADO' where id = v_deal;
  reset role;

  perform pg_temp.check149(pg_temp.grupo149(v_deal) = 'VENDA',
    'Status 2 diferente volta a derivar o Status 1 (VENDA)');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. escrita no catálogo =='
-- -----------------------------------------------------------------------------
do $$
declare
  adm      uuid := '00000000-0000-0000-0000-000001490001';
  cor      uuid := '00000000-0000-0000-0000-000001490002';
  v_legado uuid;
  v_msg    text;
  v_state  text;
  n        int;
begin
  select id into v_legado from public.deal_status_groups where code = 'LEGADO';

  -- Corretor
  v_msg := null;
  perform pg_temp.become149(cor);
  set local role authenticated;
  begin
    insert into public.deal_statuses (value, group_id, position) values ('STATUS DO CORRETOR 149', v_legado, 99);
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.check149(v_msg like '%row-level security%',
    format('corretor não cadastra Status 2 (%s)', coalesce(v_msg, 'passou')));

  v_msg := null;
  perform pg_temp.become149(cor);
  set local role authenticated;
  begin
    insert into public.deal_status_groups (code, label, position) values ('CORRETOR149', 'Corretor 149', 99);
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.check149(v_msg like '%row-level security%',
    format('corretor não cadastra Status 1 (%s)', coalesce(v_msg, 'passou')));

  perform pg_temp.become149(cor);
  set local role authenticated;
  update public.deal_statuses set label = 'INVADIDO' where value = '05. RP APROVADO';
  get diagnostics n = row_count;
  reset role;
  perform pg_temp.check149(n = 0 and (select label from public.deal_statuses where value = '05. RP APROVADO') = 'RP APROVADO',
    'corretor não renomeia Status 2');

  -- Admin cadastra, renomeia, desativa e reativa.
  perform pg_temp.become149(adm);
  set local role authenticated;
  insert into public.deal_statuses (value, group_id, position) values ('22. NOVO STATUS 149', v_legado, 99);
  update public.deal_statuses set label = 'Novo status (149)' where value = '22. NOVO STATUS 149';
  update public.deal_statuses set active = false where value = '05. RP APROVADO';
  insert into public.deal_status_groups (code, label, position) values ('TESTE149', 'Teste 149', 99);
  reset role;

  perform pg_temp.check149(
    exists (select 1 from public.deal_statuses
             where value = '22. NOVO STATUS 149' and label = 'Novo status (149)'
               and tone = 'neutral' and active and not locked)
    and exists (select 1 from public.deal_statuses where value = '05. RP APROVADO' and not active)
    and exists (select 1 from public.deal_status_groups where code = 'TESTE149'),
    'admin cadastra Status 1 e Status 2, renomeia e desativa status sem trava');

  perform pg_temp.become149(adm);
  set local role authenticated;
  update public.deal_statuses set active = true where value = '05. RP APROVADO';
  reset role;

  -- Locked não desativa.
  v_msg := null;
  perform pg_temp.become149(adm);
  set local role authenticated;
  begin
    update public.deal_statuses set active = false where value = '17. DISTRATO';
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.check149(v_msg like '%não pode ser desativado%'
    and (select active from public.deal_statuses where value = '17. DISTRATO'),
    format('status travado não é desativado nem por admin (%s)', coalesce(v_msg, 'passou')));

  -- Nem destravando no mesmo comando.
  v_msg := null;
  perform pg_temp.become149(adm);
  set local role authenticated;
  begin
    update public.deal_statuses set locked = false, active = false where value = '13. ESTEIRA AGIL';
  exception when insufficient_privilege or raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.check149(v_msg is not null
    and (select active and locked from public.deal_statuses where value = '13. ESTEIRA AGIL'),
    format('a trava não sai pela tela (%s)', coalesce(v_msg, 'passou')));

  -- value e code imutáveis.
  v_msg := null;
  perform pg_temp.become149(adm);
  set local role authenticated;
  begin
    update public.deal_statuses set value = '22. OUTRO TEXTO 149' where value = '22. NOVO STATUS 149';
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.check149(v_msg like '%não muda%',
    format('value do Status 2 é imutável (%s)', coalesce(v_msg, 'passou')));

  v_msg := null;
  perform pg_temp.become149(adm);
  set local role authenticated;
  begin
    update public.deal_status_groups set code = 'OUTRO149' where code = 'TESTE149';
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.check149(v_msg like '%não muda%',
    format('code do Status 1 é imutável (%s)', coalesce(v_msg, 'passou')));

  -- Nomes reservados.
  v_state := '';
  perform pg_temp.become149(adm);
  set local role authenticated;
  begin
    insert into public.deal_statuses (value, group_id, position) values ('QUEDA', v_legado, 99);
    v_state := v_state || 'QUEDA passou;';
  exception when raise_exception then null;
  end;
  begin
    insert into public.deal_statuses (value, group_id, position) values ('23. OFF PARCIAL', v_legado, 99);
    v_state := v_state || 'OFF PARCIAL passou;';
  exception when raise_exception then null;
  end;
  begin
    insert into public.deal_statuses (value, group_id, position) values ('DISTRATO AMIGÁVEL', v_legado, 99);
    v_state := v_state || 'DISTRATO AMIGÁVEL passou;';
  exception when raise_exception then null;
  end;
  begin
    insert into public.deal_statuses (value, group_id, position) values ('VENDA', v_legado, 99);
    v_state := v_state || 'VENDA passou;';
  exception when raise_exception then null;
  end;
  -- `\M` é fim de palavra: OFERTA não é OFF.
  insert into public.deal_statuses (value, group_id, position) values ('OFERTA ESPECIAL 149', v_legado, 99);
  reset role;
  perform pg_temp.check149(v_state = '' and exists (select 1 from public.deal_statuses where value = 'OFERTA ESPECIAL 149'),
    format('VENDA, QUEDA, "OFF…" e "DISTRATO…" são recusados; OFERTA passa (%s)', nullif(v_state, '')));

  -- Mesmo texto com outro prefixo, outra caixa ou NBSP.
  v_state := '';
  perform pg_temp.become149(adm);
  set local role authenticated;
  begin
    insert into public.deal_statuses (value, group_id, position) values ('RC EMITIDA', v_legado, 99);
    v_state := v_state || 'RC EMITIDA passou;';
  exception when unique_violation then null;
  end;
  begin
    insert into public.deal_statuses (value, group_id, position) values ('99. ass. banco', v_legado, 99);
    v_state := v_state || 'ass. banco passou;';
  exception when unique_violation then null;
  end;
  begin
    insert into public.deal_statuses (value, group_id, position)
    values ('20.' || chr(160) || 'BACEN' || chr(160), v_legado, 99);
    v_state := v_state || 'BACEN com NBSP passou;';
  exception when unique_violation then null;
  end;
  reset role;
  perform pg_temp.check149(v_state = '',
    format('texto repetido sem prefixo, em outra caixa ou com NBSP é recusado (%s)', nullif(v_state, '')));

  -- Sem exclusão.
  v_msg := null;
  perform pg_temp.become149(adm);
  set local role authenticated;
  begin
    delete from public.deal_statuses where value = '22. NOVO STATUS 149';
  exception when insufficient_privilege then
    v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.check149(v_msg is not null
    and exists (select 1 from public.deal_statuses where value = '22. NOVO STATUS 149'),
    format('nem admin exclui status (%s)', coalesce(v_msg, 'passou')));
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 5. anon sem acesso =='
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check149(
    not has_table_privilege('anon', 'public.deal_status_groups', 'SELECT')
    and not has_table_privilege('anon', 'public.deal_status_groups', 'INSERT')
    and not has_table_privilege('anon', 'public.deal_status_groups', 'UPDATE')
    and not has_table_privilege('anon', 'public.deal_statuses', 'SELECT')
    and not has_table_privilege('anon', 'public.deal_statuses', 'INSERT')
    and not has_table_privilege('anon', 'public.deal_statuses', 'UPDATE'),
    'anon não lê nem escreve o catálogo');
  perform pg_temp.check149(
    not has_function_privilege('anon', 'public.deal_status_group_for(text,public.deal_outcome,text)', 'execute'),
    'anon não executa deal_status_group_for');
  perform pg_temp.check149(
    not has_table_privilege('authenticated', 'public.deal_statuses', 'DELETE')
    and not has_table_privilege('authenticated', 'public.deal_status_groups', 'DELETE'),
    'authenticated sem DELETE no catálogo');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 6. dedução sem Status 2 e backfill =='
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check149(
    (select code from public.deal_status_groups
      where id = public.deal_status_group_for(null, 'won', null)) = 'VENDA'
    and (select code from public.deal_status_groups
          where id = public.deal_status_group_for(null, 'lost', '17. DISTRATO — cliente desistiu')) = 'DISTRATO'
    and (select code from public.deal_status_groups
          where id = public.deal_status_group_for(null, 'lost', 'Queda de crédito')) = 'OFF'
    and (select code from public.deal_status_groups
          where id = public.deal_status_group_for('  ', 'open', null)) = 'PROPOSTA'
    and (select code from public.deal_status_groups
          where id = public.deal_status_group_for(null, 'cancelled', null)) = 'PROPOSTA',
    'sem Status 2: won→VENDA, lost com distrato→DISTRATO, lost sem→OFF, resto→PROPOSTA');

  perform pg_temp.check149(
    (select code from public.deal_status_groups
      where id = public.deal_status_group_for('OFF', 'lost', null)) = 'OFF'
    and (select code from public.deal_status_groups
          where id = public.deal_status_group_for('RC EMITIDA', 'won', null)) = 'VENDA'
    and (select code from public.deal_status_groups
          where id = public.deal_status_group_for('02.' || chr(160) || 'ASS. BANCO', 'won', null)) = 'VENDA',
    'com Status 2: OFF→OFF, rótulo sem número e com NBSP acham o grupo');

  perform pg_temp.check149(
    not exists (
      select 1
        from public.deals d
        join public.deal_statuses s
          on public.deal_status_bare(replace(s.value, chr(160), ' '))
           = public.deal_status_bare(replace(d.status_detail, chr(160), ' '))
       where d.status_group_id is null),
    format('nenhum negócio com Status 2 do catálogo fica sem Status 1 (%s negócios no banco)',
           (select count(*) from public.deals)));

  perform pg_temp.check149(
    not exists (select 1 from public.deals
                 where nullif(btrim(status_detail), '') is null and status_group_id is null),
    'nenhum negócio sem Status 2 fica sem Status 1');

  perform pg_temp.check149(
    (select count(*) from pg_trigger
      where tgrelid = 'public.deals'::regclass
        and tgname in ('deals_set_updated_at', 'deals_guard_closed_month')
        and tgenabled = 'O') = 2,
    'os gatilhos desligados no backfill voltaram ligados');
end
$$;

\echo 'status catálogo ok'
