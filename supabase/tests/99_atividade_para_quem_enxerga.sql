-- =============================================================================
-- 99 · Atividade só para quem o autor enxerga (migration 0146)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`.
--
-- Antes da 0146 `tasks_write` aceitava qualquer `created_by = auth.uid()`, e o
-- aviso de atividade (0143) sai por push com o título livre: qualquer usuário
-- mandava texto para o celular de qualquer um. O que cada bloco defende:
--   1. corretor cria para si e não cria para fora do alcance, nem trocando o
--      responsável de uma atividade que já existe;
--   2. gerente cria para quem está na equipe, não para fora dela;
--   3. CCA cria para si (aba Agenda do negócio) e não para o corretor;
--      SDR cria para o dono do lead da conversa dele (aba Agenda do lead), e só
--      para o dono, e só de lead que ele lê; o marketing lê o mesmo lead e NÃO
--      usa o ramo (não tem tela que crie atividade); depois que a roleta passa
--      o lead para outro corretor, o SDR não fecha mais a atividade que criou e
--      o responsável fecha (consequência aceita na 0146);
--   4. admin e sócio criam para qualquer um;
--   5. o USING não mudou: responsável conclui, autor apaga, quem está de fora
--      não mexe; sem sessão ninguém grava.
--
-- UUIDs na faixa `…-000001460001+`, exclusiva deste arquivo. Não depende de seed.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.assert_eq(got anyelement, want anyelement, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % (obtido %, esperado %)', label, got, want;
  end if;
  raise notice '  ok  %', label;
end;
$$;

/** Assume a identidade de alguém logado, como o PostgREST faria; null = sem sessão. */
create or replace function pg_temp.become(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    case when user_id is null then ''
         else json_build_object('sub', user_id::text, 'role', 'authenticated')::text
    end,
    true);
end;
$$;

/** Cria atividade como a tela faz (`createTask`): autor = quem está logado. */
create or replace function pg_temp.cria(p_titulo text, p_para uuid, p_lead uuid default null)
returns text
language plpgsql
as $$
begin
  insert into public.tasks (title, assigned_to, created_by, ref_type, ref_id)
  values (p_titulo, p_para, auth.uid(),
          case when p_lead is not null then 'lead' end, p_lead);
  return 'gravou';
exception when insufficient_privilege then
  return 'recusou';
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário
--   Equipe 0146 (gerente: Gil) ── Caio
--   Beto = corretor de fora · Cris = CCA · Sara = SDR · Mia = marketing
--   Ari = admin · Sol = sócio
--   Leads do Beto: um com conversa do SDR, outro sem.
-- -----------------------------------------------------------------------------
do $$
declare
  caio uuid := '00000000-0000-0000-0000-000001460001';
  beto uuid := '00000000-0000-0000-0000-000001460002';
  gil  uuid := '00000000-0000-0000-0000-000001460003';
  cris uuid := '00000000-0000-0000-0000-000001460004';
  sara uuid := '00000000-0000-0000-0000-000001460005';
  ari  uuid := '00000000-0000-0000-0000-000001460006';
  sol  uuid := '00000000-0000-0000-0000-000001460007';
  mia  uuid := '00000000-0000-0000-0000-000001460008';
  v_team uuid;
  v_lead uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (caio, 'caio@t0146.test', '{"full_name":"Caio Corretor 0146"}'),
    (beto, 'beto@t0146.test', '{"full_name":"Beto Corretor 0146"}'),
    (gil,  'gil@t0146.test',  '{"full_name":"Gil Gerente 0146"}'),
    (cris, 'cris@t0146.test', '{"full_name":"Cris CCA 0146"}'),
    (sara, 'sara@t0146.test', '{"full_name":"Sara SDR 0146"}'),
    (ari,  'ari@t0146.test',  '{"full_name":"Ari Admin 0146"}'),
    (sol,  'sol@t0146.test',  '{"full_name":"Sol Socio 0146"}'),
    (mia,  'mia@t0146.test',  '{"full_name":"Mia Marketing 0146"}')
  on conflict do nothing;

  -- `handle_new_auth_user` dá `broker` a todo mundo; os outros papéis precisam
  -- ser exatos, senão o teste passaria pelo motivo errado.
  delete from public.user_roles where profile_id in (gil, cris, sara, ari, sol, mia);
  insert into public.user_roles (profile_id, role) values
    (gil, 'manager'), (cris, 'cca'), (sara, 'sdr'), (ari, 'admin'), (sol, 'partner'),
    (mia, 'marketing')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe 0146', gil)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, caio);

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Conversa 0146', '11900146001', 'assigned', beto)
  returning id into v_lead;
  insert into public.sdr_conversations (lead_id) values (v_lead);

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Sem Conversa 0146', '11900146002', 'assigned', beto);
end
$$;

\echo '== 1. corretor: para si sim, para fora do alcance não =='

do $$
declare
  caio uuid := '00000000-0000-0000-0000-000001460001';
  beto uuid := '00000000-0000-0000-0000-000001460002';
  gil  uuid := '00000000-0000-0000-0000-000001460003';
  v_lead_beto uuid := (select id from public.leads where full_name = 'Lead Sem Conversa 0146');
  v_troca text := 'gravou';
begin
  perform pg_temp.become(caio);
  set local role authenticated;

  perform pg_temp.assert_eq(pg_temp.cria('Retornar ligação 0146', caio), 'gravou',
    'corretor cria atividade para si');
  perform pg_temp.assert_eq(pg_temp.cria('Texto no celular do Beto 0146', beto), 'recusou',
    'corretor não cria atividade para corretor de outra equipe');
  perform pg_temp.assert_eq(pg_temp.cria('Texto no celular do gerente 0146', gil), 'recusou',
    'corretor não cria atividade para o próprio gerente, que ele não enxerga');
  perform pg_temp.assert_eq(pg_temp.cria('Lead alheio 0146', beto, v_lead_beto), 'recusou',
    'apontar para um lead que o corretor não lê não abre o ramo do dono do lead');

  -- Criar para si e depois trocar o responsável furava a regra pelo UPDATE.
  begin
    update public.tasks set assigned_to = beto where title = 'Retornar ligação 0146';
  exception when insufficient_privilege then
    v_troca := 'recusou';
  end;
  perform pg_temp.assert_eq(v_troca, 'recusou',
    'corretor não troca o responsável da própria atividade para fora do alcance');
end
$$;

\echo '== 2. gerente: para a equipe sim, para fora não =='

do $$
declare
  caio uuid := '00000000-0000-0000-0000-000001460001';
  beto uuid := '00000000-0000-0000-0000-000001460002';
  gil  uuid := '00000000-0000-0000-0000-000001460003';
begin
  perform pg_temp.become(gil);
  set local role authenticated;

  perform pg_temp.assert_eq(pg_temp.cria('Cobrar retorno do Caio 0146', caio), 'gravou',
    'gerente cria atividade para integrante da equipe');
  perform pg_temp.assert_eq(pg_temp.cria('Para fora da equipe 0146', beto), 'recusou',
    'gerente não cria atividade para corretor de outra equipe');
end
$$;

\echo '== 3. CCA e SDR: só os fluxos das telas =='

do $$
declare
  caio uuid := '00000000-0000-0000-0000-000001460001';
  beto uuid := '00000000-0000-0000-0000-000001460002';
  cris uuid := '00000000-0000-0000-0000-000001460004';
  sara uuid := '00000000-0000-0000-0000-000001460005';
  mia  uuid := '00000000-0000-0000-0000-000001460008';
  v_conversa uuid := (select id from public.leads where full_name = 'Lead Conversa 0146');
  v_sem      uuid := (select id from public.leads where full_name = 'Lead Sem Conversa 0146');
  v_fecha text := 'gravou';
  n bigint;
begin
  -- A aba Agenda do negócio não passa responsável: a atividade é de quem cria.
  perform pg_temp.become(cris);
  set local role authenticated;
  perform pg_temp.assert_eq(pg_temp.cria('Conferir documentos 0146', cris), 'gravou',
    'CCA cria atividade para si');
  perform pg_temp.assert_eq(pg_temp.cria('Texto no celular do corretor 0146', caio), 'recusou',
    'CCA não cria atividade para corretor');
  reset role;

  -- A aba Agenda do lead passa o dono do lead como responsável.
  perform pg_temp.become(sara);
  set local role authenticated;
  perform pg_temp.assert_eq(pg_temp.cria('Ligar depois do SDR 0146', beto, v_conversa), 'gravou',
    'SDR cria atividade para o dono do lead da conversa dele');
  perform pg_temp.assert_eq(pg_temp.cria('Lead da conversa, outro corretor 0146', caio, v_conversa), 'recusou',
    'o ramo do lead vale só para o dono do lead, não para qualquer um');
  perform pg_temp.assert_eq(pg_temp.cria('Lead que o SDR não lê 0146', beto, v_sem), 'recusou',
    'SDR não usa lead que não lê para chegar ao dono');
  perform pg_temp.assert_eq(pg_temp.cria('Sem lead 0146', beto), 'recusou',
    'SDR não cria atividade solta para corretor');
  reset role;

  -- O marketing lê o mesmo lead pela `leads_select_sdr`, mas não tem tela que
  -- crie atividade: o ramo do dono do lead é só do SDR.
  perform pg_temp.become(mia);
  set local role authenticated;
  perform pg_temp.assert_eq(exists (select 1 from public.leads where id = v_conversa), true,
    'marketing lê o lead da conversa (a recusa abaixo é pelo papel, não pela leitura)');
  perform pg_temp.assert_eq(pg_temp.cria('Push pelo marketing 0146', beto, v_conversa), 'recusou',
    'marketing não usa o ramo do dono do lead');
  reset role;

  -- A roleta passa o lead para outro corretor. Nenhuma função move
  -- `tasks.assigned_to`: a atividade continua do Beto, que saiu do alcance do SDR.
  perform pg_temp.become(null);
  update public.leads set assigned_to = caio where id = v_conversa;

  perform pg_temp.become(sara);
  set local role authenticated;
  begin
    update public.tasks set status = 'cancelled' where title = 'Ligar depois do SDR 0146';
  exception when insufficient_privilege then
    v_fecha := 'recusou';
  end;
  perform pg_temp.assert_eq(v_fecha, 'recusou',
    'consequência aceita: o SDR não cancela a atividade depois que o lead mudou de dono');
  reset role;

  perform pg_temp.become(beto);
  set local role authenticated;
  update public.tasks set status = 'done', completed_at = now()
   where title = 'Ligar depois do SDR 0146';
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 1::bigint, 'o responsável conclui depois que o lead mudou de dono');
end
$$;

\echo '== 4. admin e sócio seguem livres =='

do $$
declare
  beto uuid := '00000000-0000-0000-0000-000001460002';
  ari  uuid := '00000000-0000-0000-0000-000001460006';
  sol  uuid := '00000000-0000-0000-0000-000001460007';
begin
  perform pg_temp.become(ari);
  set local role authenticated;
  perform pg_temp.assert_eq(pg_temp.cria('Do admin 0146', beto), 'gravou',
    'admin cria atividade para qualquer um');
  reset role;

  perform pg_temp.become(sol);
  set local role authenticated;
  perform pg_temp.assert_eq(pg_temp.cria('Do sócio 0146', beto), 'gravou',
    'sócio cria atividade para qualquer um');
end
$$;

\echo '== 5. USING intacto; sem sessão ninguém grava =='

do $$
declare
  caio uuid := '00000000-0000-0000-0000-000001460001';
  beto uuid := '00000000-0000-0000-0000-000001460002';
  gil  uuid := '00000000-0000-0000-0000-000001460003';
  n bigint;
begin
  -- Quem está de fora não conclui nem apaga a atividade que o gerente deu ao Caio.
  perform pg_temp.become(beto);
  set local role authenticated;
  update public.tasks set status = 'done', completed_at = now()
   where title = 'Cobrar retorno do Caio 0146';
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 0::bigint, 'quem está de fora não conclui atividade alheia');
  delete from public.tasks where title = 'Cobrar retorno do Caio 0146';
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 0::bigint, 'quem está de fora não apaga atividade alheia');
  reset role;

  perform pg_temp.become(caio);
  set local role authenticated;
  update public.tasks set status = 'done', completed_at = now()
   where title = 'Cobrar retorno do Caio 0146';
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 1::bigint, 'o responsável conclui a atividade que o gerente criou');
  reset role;

  perform pg_temp.become(gil);
  set local role authenticated;
  delete from public.tasks where title = 'Cobrar retorno do Caio 0146';
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 1::bigint, 'o autor apaga a atividade que criou');
  reset role;

  perform pg_temp.become(null);
  set local role authenticated;
  perform pg_temp.assert_eq(pg_temp.cria('Sem sessão 0146', caio), 'recusou',
    'sem sessão ninguém cria atividade');
end
$$;

delete from public.notifications
 where profile_id in (select id from public.profiles where email::text like '%@t0146.test');
delete from public.tasks where title like '%0146';

\echo '0146 ok'
