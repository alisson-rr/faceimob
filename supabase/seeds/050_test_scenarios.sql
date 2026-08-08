-- =============================================================================
-- Fase 5 — Cenários de teste
--
-- As fases 1-4 montam um sistema plausível. Esta monta os casos que o roteiro
-- de teste precisa observar: o bloqueio dos 20 atrasados, a fila reordenada por
-- timeout, a tarefa vencida, o mês fechado, a campanha sem lead.
--
-- Diferença das outras fases: aqui os dados existem para PROVAR comportamento,
-- não para parecer realistas. Cada bloco diz o que você deve ver na tela.
--
-- Idempotente: UUIDs fixos com `on conflict do nothing`. Pode repetir.
-- Faixa de UUID reservada para esta fase: 70000000 … 7f000000.
--
-- Para desfazer tudo: `supabase/seeds/059_test_scenarios_rollback.sql`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quem é o testador
--
-- Resolve dinamicamente porque o e-mail do admin real muda por ambiente. Ordem:
-- 1) dev.alisson.rosa@gmail.com  2) qualquer admin que não seja o do seed  3) o do seed.
-- `union all … limit 1` devolve o primeiro que existir.
-- -----------------------------------------------------------------------------
create or replace function pg_temp.tester()
returns uuid language sql stable as $$
  select id from public.profiles where email = 'dev.alisson.rosa@gmail.com'
  union all
  select p.id from public.profiles p
   where exists (select 1 from public.user_roles r
                  where r.profile_id = p.id and r.role = 'admin')
     and p.id <> '10000000-0000-0000-0000-000000000001'
  union all
  select '10000000-0000-0000-0000-000000000001'::uuid
  limit 1;
$$;

do $$
begin
  raise notice '[050] testador = % (%)',
    (select full_name from public.profiles where id = pg_temp.tester()),
    (select email     from public.profiles where id = pg_temp.tester());
end $$;

-- =============================================================================
-- BLOCO 1 — Preparar o testador
--
-- Na tela: Check-in deixa de dizer "você não está em nenhum grupo", a posição
-- na fila aparece e o sino para de abrir vazio.
-- =============================================================================

-- Sem isto o check-in trava por IP em qualquer máquina fora do escritório.
--
-- `profiles_guard_admin_columns` exige `is_admin()` para mexer em
-- `bypass_ip_check` — é a trava antifraude do check-in. Num seed via psql não há
-- JWT, então `auth.uid()` é NULL e o trigger barra. A saída correta é o seed
-- assumir a identidade do testador (que É admin), não desligar o trigger:
-- desligar removeria a proteção para todo mundo enquanto o seed roda.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.tester()::text, 'role', 'authenticated')::text,
    true);   -- true = escopo da transação; some ao fim deste bloco
  update public.profiles set bypass_ip_check = true where id = pg_temp.tester();
end $$;

insert into public.team_members (team_id, profile_id)
select t.id, pg_temp.tester() from public.teams t where t.name = 'Equipe Paulista'
on conflict do nothing;

insert into public.distribution_group_members (group_id, profile_id, active)
select g.id, pg_temp.tester(), true
from public.distribution_groups g where g.kind = 'general'
on conflict (group_id, profile_id) do update set active = true;

-- =============================================================================
-- BLOCO 2 — Leads do testador e contadores por período
--
-- Na tela (/checkin): os três contadores mostram números DIFERENTES —
-- hoje 2, semana 4, mês 7. Se os três forem iguais, o recorte por período
-- quebrou.
-- =============================================================================

-- Dois leads atuais, para o testador ter o que atender.
insert into public.leads (id, full_name, phone, email, status, funnel_stage,
                          assigned_to, assigned_at, source_id, campaign_id, campaign_name)
values
  ('70000000-0000-0000-0000-000000000001', 'Roberto Teste Silva',  '11988880001', 'roberto.teste@example.invalid',
   'assigned', 'new', pg_temp.tester(), now() - interval '10 minutes', (select id from public.lead_sources order by created_at limit 1), 'camp-teste-001', 'Campanha Teste A'),
  ('70000000-0000-0000-0000-000000000002', 'Juliana Teste Souza',  '11988880002', 'juliana.teste@example.invalid',
   'in_progress', 'warm', pg_temp.tester(), now() - interval '2 days', (select id from public.lead_sources order by created_at limit 1), 'camp-teste-001', 'Campanha Teste A')
on conflict do nothing;

-- Histórico de atribuições espalhado no tempo: é o que os contadores somam.
--
-- As datas são ancoradas em `date_trunc` e não em "N dias atrás": rodando no
-- dia 2 do mês, "20 dias atrás" cai no mês anterior e o contador do mês zera.
-- `least(..., now() - 1 min)` garante que nada fique no futuro.
--
-- Observação honesta: nos primeiros dias do mês a SEMANA pode somar mais que o
-- MÊS, porque a semana atravessa a virada. Isso é comportamento correto — se
-- os três números forem idênticos, aí sim o recorte quebrou.
--
-- `deadline` é obrigatório; `released_at` e `release_reason` andam sempre juntos.
insert into public.lead_assignments (id, lead_id, profile_id, sequence, assigned_at, deadline, released_at, release_reason)
select
  ('71000000-0000-0000-0000-00000000000' || d.i)::uuid,
  '70000000-0000-0000-0000-000000000002'::uuid,
  pg_temp.tester(),
  d.i,
  d.at,
  d.at + interval '5 minutes',
  d.at + interval '6 minutes',
  'manual'::lead_release_reason
from (
  select i, least(at, now() - interval '1 minute') as at from (values
    (1, date_trunc('day',   now()) + interval '8 hours'),   -- hoje
    (2, date_trunc('day',   now()) + interval '9 hours'),   -- hoje
    (3, date_trunc('week',  now()) + interval '10 hours'),  -- esta semana
    (4, date_trunc('week',  now()) + interval '30 hours'),  -- esta semana
    (5, date_trunc('month', now()) + interval '11 hours'),  -- este mês
    (6, date_trunc('month', now()) + interval '12 hours'),  -- este mês
    (7, date_trunc('month', now()) + interval '13 hours')   -- este mês
  ) as v(i, at)
) as d
on conflict do nothing;

-- =============================================================================
-- BLOCO 3 — Bloqueio de check-in por leads atrasados
--
-- Regra: `checkin_eligibility()` bloqueia em >= `overdue_block_threshold` (20).
--
-- Na tela: entre como Felipe Martins e o botão de check-in fica travado, com o
-- motivo em texto e a contagem. Como o testador, o check-in funciona normal.
-- =============================================================================

insert into public.leads (id, full_name, phone, status, funnel_stage,
                          assigned_to, assigned_at, next_action_at, source_id)
select
  ('72000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'Lead Atrasado ' || i,
  '1197777' || lpad(i::text, 4, '0'),
  'in_progress'::lead_status,
  'warm'::lead_funnel_stage,
  '10000000-0000-0000-0000-000000000010'::uuid,       -- Felipe Martins
  now() - interval '3 days',
  now() - interval '1 day',                            -- vencido = atrasado
  (select id from public.lead_sources order by created_at limit 1)
from generate_series(1, 22) as i
on conflict do nothing;

-- =============================================================================
-- BLOCO 4 — Ordem da fila: timeout tira a vez, handoff não
--
-- Regra da 0014: `distribution_queue` ordena por `last_turn_at` (fim da última
-- vez), não pelo começo.
--
-- Na tela (/checkin, posição na fila): **Diego aparece ANTES de Ana**, mesmo a
-- Ana tendo recebido lead ANTES dele — porque a Ana perdeu o dela por timeout e
-- isso encerrou a vez agora; a liberação do Diego foi `sdr_handoff`, que não
-- penaliza o corretor.
--
-- Por que não uso o Felipe aqui: ele tem 22 atrasados (BLOCO 3) e a própria
-- `distribution_queue` exclui quem está bloqueado. Ele não apareceria na fila —
-- o que é o comportamento certo, e por isso os dois cenários usam gente
-- diferente.
-- =============================================================================

insert into public.leads (id, full_name, phone, status, funnel_stage, source_id)
values
  ('73000000-0000-0000-0000-000000000001', 'Lead do Timeout', '11966660001', 'queued', 'new',
   (select id from public.lead_sources order by created_at limit 1)),
  ('73000000-0000-0000-0000-000000000002', 'Lead do Handoff', '11966660002', 'queued', 'new',
   (select id from public.lead_sources order by created_at limit 1))
on conflict do nothing;

insert into public.lead_assignments (id, lead_id, profile_id, sequence, assigned_at, deadline, released_at, release_reason)
values
  -- Ana recebeu há 40 min e PERDEU no prazo há 2 min -> vai para o fim da fila.
  ('74000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000005', 1,
   now() - interval '40 minutes', now() - interval '35 minutes',
   now() - interval '2 minutes', 'timeout'),
  -- Diego recebeu há 20 min e o SDR assumiu -> a vez dele continua valendo pelo
  -- assigned_at (20 min atrás), que é mais antigo que o released_at da Ana.
  ('74000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000008', 1,
   now() - interval '20 minutes', now() - interval '15 minutes',
   now() - interval '10 minutes', 'sdr_handoff')
on conflict do nothing;

-- =============================================================================
-- BLOCO 5 — Lead vencendo agora, para ver o cron trabalhar
--
-- `faceimob-release-expired-leads` roda a cada 30 segundos.
--
-- Na tela: abra /leads, deixe aberto e observe — em até 1 minuto este lead sai
-- do Diego e volta para a fila sozinho, sem ninguém clicar em nada.
-- Confira depois: select release_reason, released_at from public.lead_assignments
--                  where lead_id = '75000000-0000-0000-0000-000000000001';
--
-- Rodou o seed e já passou de 1 minuto? O lead já foi devolvido — é isso mesmo.
-- Rode o seed de novo só deste bloco para repetir o teste.
-- =============================================================================

insert into public.leads (id, full_name, phone, status, funnel_stage,
                          assigned_to, assigned_at, attend_deadline, source_id)
values
  ('75000000-0000-0000-0000-000000000001', 'Lead Vencendo Agora', '11955550001',
   'assigned', 'new', '10000000-0000-0000-0000-000000000008',
   now() - interval '6 minutes', now() - interval '1 minute',
   (select id from public.lead_sources order by created_at limit 1))
on conflict do nothing;

insert into public.lead_assignments (id, lead_id, profile_id, sequence, assigned_at, deadline)
values
  ('76000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000008', 1,
   now() - interval '6 minutes', now() - interval '1 minute')
on conflict do nothing;

-- =============================================================================
-- BLOCO 6 — Grupo e check-ins de hoje (pré-requisito da fila)
--
-- `distribution_queue` só lista quem: fez check-in hoje, está no grupo, tem o
-- perfil ativo, NÃO está bloqueado por atrasos e — a condição que mais confunde
-- — está com `now() >= distribution_start` do turno.
--
-- ⚠️ Fora da janela de distribuição a fila fica VAZIA e não é bug. O bloco
-- escolhe o turno cuja distribuição já começou; se você rodar de madrugada,
-- nenhum turno se aplica e a fila só aparece quando o primeiro abrir.
-- =============================================================================

-- Garante que os corretores dos cenários estão no grupo geral. Não depende da
-- fase 2 ter rodado: o bloco tem que se sustentar sozinho.
insert into public.distribution_group_members (group_id, profile_id, active)
select g.id, p.id, true
from public.distribution_groups g
cross join (values
  ('10000000-0000-0000-0000-000000000005'::uuid),  -- Ana
  ('10000000-0000-0000-0000-000000000006'::uuid),  -- Bruno
  ('10000000-0000-0000-0000-000000000008'::uuid)   -- Diego
) as p(id)
where g.kind = 'general'
on conflict (group_id, profile_id) do update set active = true;

-- O turno precisa estar ABERTO agora, não só ter começado: o cron
-- `auto_checkout_expired` roda a cada minuto e fecha check-in que passou do
-- `checkout_time`. Criar check-in num turno já encerrado produz uma fila que
-- some sozinha em ~60s — parece bug e é o sistema funcionando.
insert into public.checkins (id, profile_id, shift_id, work_date, checked_in_at, leads_received)
select
  ('77000000-0000-0000-0000-00000000000' || row_number() over (order by p.id))::uuid,
  p.id,
  s.id,
  current_date,
  greatest(now() - interval '1 hour',
           current_date + s.distribution_start),   -- nunca antes da abertura
  0
from public.profiles p
cross join lateral (
  select s.id, s.distribution_start
  from public.work_shifts s
  where s.active
    and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
    and (now() at time zone 'America/Sao_Paulo')::time <  s.checkout_time
  order by s.distribution_start desc
  limit 1
) s
where p.id in (
  '10000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000008'
)
on conflict do nothing;

-- Fora de janela o insert acima não produz linha nenhuma. Avisa em vez de
-- deixar você procurando uma fila que não pode existir agora.
do $$
declare v_turno text;
begin
  select code into v_turno from public.work_shifts
   where active
     and (now() at time zone 'America/Sao_Paulo')::time >= distribution_start
     and (now() at time zone 'America/Sao_Paulo')::time <  checkout_time
   limit 1;

  if v_turno is null then
    raise notice '[050] AGORA (% em SP) nenhum turno está aberto — a fila fica vazia.',
      to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI');
    raise notice '[050] Turnos: %',
      (select string_agg(code || ' ' || distribution_start || '-' || checkout_time, ' | ' order by position)
         from public.work_shifts where active);
    raise notice '[050] Rode o seed de novo dentro de um turno para testar a fila.';
  else
    raise notice '[050] Turno aberto: % — check-ins criados.', v_turno;
  end if;
end $$;

-- =============================================================================
-- BLOCO 7 — Agenda: tarefas e visitas
--
-- Na tela (/leads -> abrir lead -> aba Agenda): uma tarefa vencida em vermelho
-- com o selo "1 vencida", uma em dia e uma concluída riscada.
--
-- `tasks_done_consistency` exige que status='done' e completed_at andem juntos.
-- =============================================================================

insert into public.tasks (id, title, description, assigned_to, created_by,
                          due_at, completed_at, status, priority, ref_type, ref_id)
values
  ('78000000-0000-0000-0000-000000000001', 'Retornar ligação — VENCIDA',
   'Cliente pediu retorno ontem.', pg_temp.tester(), pg_temp.tester(),
   now() - interval '1 day', null, 'open', 'high',
   'lead', '70000000-0000-0000-0000-000000000002'),
  ('78000000-0000-0000-0000-000000000002', 'Enviar simulação — em dia',
   null, pg_temp.tester(), pg_temp.tester(),
   now() + interval '2 days', null, 'open', 'normal',
   'lead', '70000000-0000-0000-0000-000000000002'),
  ('78000000-0000-0000-0000-000000000003', 'Primeiro contato — concluída',
   null, pg_temp.tester(), pg_temp.tester(),
   now() - interval '2 days', now() - interval '2 days', 'done', 'normal',
   'lead', '70000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- Visitas nos três estados que a tela sabe mostrar.
insert into public.visits (id, lead_id, broker_id, scheduled_at, performed_at, result, notes)
values
  ('79000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
   pg_temp.tester(), now() + interval '3 days', null, 'scheduled', 'Visita ao decorado.'),
  ('79000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002',
   pg_temp.tester(), now() - interval '5 days', now() - interval '5 days', 'completed', 'Gostou da planta.'),
  ('79000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002',
   pg_temp.tester(), now() - interval '8 days', null, 'no_show', 'Cliente não apareceu.')
on conflict do nothing;

-- =============================================================================
-- BLOCO 8 — Notificações
--
-- Na tela (sino no cabeçalho): badge com 3 não lidas. Clicar navega pelo link
-- e marca como lida. As `whatsapp` pendentes alimentam o worker `notify-dispatch`.
-- =============================================================================

insert into public.notifications (id, profile_id, kind, title, body, link, channel, read_at, sent_at)
values
  ('7a000000-0000-0000-0000-000000000001', pg_temp.tester(), 'lead_assigned',
   'Novo lead na sua fila', 'Roberto Teste Silva aguarda atendimento.', '/leads',
   'in_app', null, now()),
  ('7a000000-0000-0000-0000-000000000002', pg_temp.tester(), 'deal_stage',
   'Negócio avançou para Aprovado', 'Confira a esteira do CCA.', '/cca',
   'in_app', null, now()),
  ('7a000000-0000-0000-0000-000000000003', pg_temp.tester(), 'task_due',
   'Você tem atividade vencida', 'Retornar ligação venceu ontem.', '/leads',
   'in_app', null, now()),
  ('7a000000-0000-0000-0000-000000000004', pg_temp.tester(), 'lead_assigned',
   'Lead atribuído (já lida)', 'Esta aparece esmaecida.', '/leads',
   'in_app', now() - interval '1 hour', now()),
  ('7a000000-0000-0000-0000-000000000005', pg_temp.tester(), 'system',
   'Bem-vindo ao FACEIMOB', 'Notificação antiga, já lida.', null,
   'in_app', now() - interval '2 days', now())
on conflict do nothing;

-- =============================================================================
-- BLOCO 9 — Gamificação
--
-- Na tela (/gamification): pódio com três colocações DISTINTAS, entrada
-- animada 3º -> 2º -> 1º e o primeiro elevado.
--
-- Ana lidera. Os pontos saem de `game_events`; conferir com:
--   select profile_id, sum(points) from public.game_events group by 1 order by 2 desc;
-- =============================================================================

insert into public.game_events (id, season_id, profile_id, event_code, points, occurred_at)
select
  ('7b000000-0000-0000-0000-0000000000' || lpad(row_number() over ()::text, 2, '0'))::uuid,
  (select id from public.game_seasons where closed_at is null order by period_start desc limit 1),
  e.profile_id, e.event_code, e.points, now() - (e.dias || ' days')::interval
from (values
  ('10000000-0000-0000-0000-000000000005'::uuid, 'venda',              600, 3),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'venda',              600, 8),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'aprovado',           250, 5),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'esteira',            140, 9),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'venda',              600, 4),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'aprovado',           250, 6),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'esteira',            140, 7),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'aprovado',           250, 2),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'esteira',            140, 5),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'incompleto_com_doc',  10, 6),
  ('10000000-0000-0000-0000-000000000007'::uuid, 'esteira',            140, 3),
  ('10000000-0000-0000-0000-000000000007'::uuid, 'incompleto_com_doc',  10, 4),
  -- Distrato é negativo: prova que a tela mostra penalidade em vermelho.
  ('10000000-0000-0000-0000-000000000009'::uuid, 'venda',              600, 10),
  ('10000000-0000-0000-0000-000000000009'::uuid, 'distrato',          -600, 1)
) as e(profile_id, event_code, points, dias)
where exists (select 1 from public.game_seasons where closed_at is null)
on conflict do nothing;

-- =============================================================================
-- BLOCO 10 — Resultados anuais e mês fechado
--
-- Na tela (/resultados): ano corrente e anterior preenchidos.
--
-- O mês fechado é a prova da trava: `deals_guard_closed_month` impede editar
-- negócio daquele mês. Fechamos um mês ANTIGO de propósito, para não travar os
-- negócios que você vai mexer no pipeline.
-- =============================================================================

insert into public.annual_results (id, year, month, sales_count, vgv, notes)
values
  ('7c000000-0000-0000-0000-000000000001', extract(year from current_date)::int, 1, 4,  1850000, 'Janeiro'),
  ('7c000000-0000-0000-0000-000000000002', extract(year from current_date)::int, 2, 6,  2740000, 'Fevereiro'),
  ('7c000000-0000-0000-0000-000000000003', extract(year from current_date)::int, 3, 3,  1120000, 'Março'),
  ('7c000000-0000-0000-0000-000000000004', extract(year from current_date)::int - 1, 11, 5, 2100000, 'Novembro do ano anterior'),
  ('7c000000-0000-0000-0000-000000000005', extract(year from current_date)::int - 1, 12, 8, 3960000, 'Dezembro do ano anterior')
on conflict do nothing;

insert into public.closed_months (period, closed_by, notes)
select public.month_start((date_trunc('month', current_date) - interval '6 months')::date),
       pg_temp.tester(),
       'Fechado pelo seed de teste — editar negócio deste mês deve falhar.'
on conflict do nothing;

-- =============================================================================
-- BLOCO 11 — Campanhas de mídia
--
-- Na tela (/marketing): "Campanha Teste A" mostra custo por lead calculado,
-- porque o `external_id` casa com `leads.campaign_id` do BLOCO 2.
-- "Campanha Sem Lead" mostra "—" em vez de R$ 0,00 — é o tratamento de
-- divisão por zero.
-- =============================================================================

insert into public.ad_campaigns (id, external_id, platform, name, daily_budget, total_spend, synced_at)
values
  ('7d000000-0000-0000-0000-000000000001', 'camp-teste-001', 'meta', 'Campanha Teste A',  200,  4500, now()),
  ('7d000000-0000-0000-0000-000000000002', 'camp-teste-002', 'meta', 'Campanha Sem Lead', 150,  1200, now())
on conflict do nothing;

-- =============================================================================
-- BLOCO 12 — Fila de envio à construtora
--
-- Na tela (/cca -> "Enviar à construtora"): histórico com os três estados.
-- O `failed` tem `last_error` preenchido e mostra o botão "Reenviar".
--
-- Enquanto `submission-dispatch` não estiver publicada, nada sai de fato — o
-- enfileiramento é que está sendo testado aqui.
-- =============================================================================

insert into public.developer_submissions (id, deal_id, developer_id, to_email, subject, body,
                                          document_ids, status, attempts, last_error, sent_at, requested_by)
select
  v.id, d.id, dev.id, v.to_email, v.subject, v.body,
  '{}'::uuid[], v.status, v.attempts, v.last_error, v.sent_at, pg_temp.tester()
from (values
  ('7e000000-0000-0000-0000-000000000001'::uuid, 'analise@construtora.test', 'Dossiê — envio na fila',
   'Segue documentação para análise.', 'queued', 0, null::text, null::timestamptz),
  ('7e000000-0000-0000-0000-000000000002'::uuid, 'analise@construtora.test', 'Dossiê — enviado',
   'Segue documentação para análise.', 'sent', 1, null, now() - interval '2 hours'),
  ('7e000000-0000-0000-0000-000000000003'::uuid, 'invalido@construtora.test', 'Dossiê — falhou',
   'Segue documentação para análise.', 'failed', 3, 'Brevo respondeu 400', null)
) as v(id, to_email, subject, body, status, attempts, last_error, sent_at)
cross join lateral (select id from public.deals order by created_at limit 1) d
cross join lateral (select id from public.developers order by name limit 1) dev
on conflict do nothing;

-- =============================================================================
-- Resumo
-- =============================================================================
do $$
declare
  v_tester uuid := pg_temp.tester();
begin
  raise notice '';
  raise notice '[050] ================= CENÁRIOS PRONTOS =================';
  raise notice '[050] Testador ....................... %', (select full_name from public.profiles where id = v_tester);
  raise notice '[050] Leads do testador .............. %', (select count(*) from public.leads where assigned_to = v_tester);
  raise notice '[050] Atribuições (contadores) ....... %', (select count(*) from public.lead_assignments where profile_id = v_tester);
  raise notice '[050] Leads atrasados do Felipe ...... % (bloqueio em 20)', (select public.overdue_lead_count('10000000-0000-0000-0000-000000000010'));
  raise notice '[050] Check-ins hoje ................. %', (select count(*) from public.checkins where work_date = current_date);
  raise notice '[050] Tarefas do testador ............ %', (select count(*) from public.tasks where assigned_to = v_tester);
  raise notice '[050] Visitas ........................ %', (select count(*) from public.visits where broker_id = v_tester);
  raise notice '[050] Notificações não lidas ......... %', (select count(*) from public.notifications where profile_id = v_tester and read_at is null);
  raise notice '[050] Eventos de jogo ................ %', (select count(*) from public.game_events);
  raise notice '[050] Campanhas ...................... %', (select count(*) from public.ad_campaigns);
  raise notice '[050] Envios à construtora ........... %', (select count(*) from public.developer_submissions);
  raise notice '[050] Mês fechado .................... %', (select max(period)::text from public.closed_months);
  raise notice '[050] =====================================================';
end $$;
