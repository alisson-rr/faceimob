-- =============================================================================
-- Fase 6 — Cenário de demonstração para o cliente
--
-- As fases 1-4 montam um catálogo plausível e a fase 5 monta os casos que
-- PROVAM comportamento. Esta monta a HISTÓRIA que um diretor de imobiliária
-- precisa ver ao abrir o app sozinho: equipes cheias, leads em vários estágios,
-- negócios em todas as etapas do pipeline, pódio com top 3 claro, metas,
-- agenda do dia, notificações e aportes de marketing.
--
-- Diferença das outras fases: aqui os dados existem para CONVENCER, não para
-- provar regra nem para parecer completos. Cada bloco diz o que o cliente vê.
--
-- Tudo fictício. Nenhum nome, telefone, CPF ou e-mail é de pessoa real —
-- os domínios são `.invalid`, reservado pela RFC 2606 justamente para isto.
--
-- Idempotente: UUIDs fixos com `on conflict do nothing`. Pode repetir.
-- Faixa de UUID reservada para esta fase: 80000000 … 8f000000.
--
-- Para desfazer tudo: `supabase/seeds/069_demo_showcase_rollback.sql`
-- (ou `node scripts/demo.mjs showcase:limpar [--remote]`).
--
-- -----------------------------------------------------------------------------
-- Quem é o "usuário da demonstração"
--
-- É a conta que o cliente vai usar. Ela não existe até alguém rodar
-- `npm run user:create`, então o arquivo resolve na hora, nesta ordem:
--   1) o admin mais recente FORA da faixa de seed (o cliente)
--   2) dev.alisson.rosa@gmail.com (o testador)
--   3) o admin do seed
-- Logo: crie o usuário do cliente ANTES de aplicar este arquivo, senão as
-- notificações, tarefas e a presença caem no testador.
--
-- Por que a resolução é repetida por bloco em vez de uma tabela auxiliar como
-- a `seed_tester_ref` do 045: aquele truque só funciona sob `psql -f`, que
-- envia um comando por vez. Os transportes usados aqui (Management API,
-- `supabase db query`) mandam o arquivo inteiro num lote só, e num lote todas
-- as instruções são preparadas antes de a primeira rodar — usar um objeto
-- criado no mesmo arquivo falharia com "does not exist". Bloco `do $$` resolve
-- em tempo de execução e funciona em qualquer transporte.
-- =============================================================================

do $$
declare v_demo uuid; v_nome text; v_email text;
begin
  select p.id, p.full_name, p.email into v_demo, v_nome, v_email
  from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'admin')
  order by
    (p.id::text not like '10000000-%' and p.email <> 'dev.alisson.rosa@gmail.com') desc,
    (p.email = 'dev.alisson.rosa@gmail.com') desc,
    p.created_at desc
  limit 1;

  raise notice '[060] usuário da demonstração = % (%)', v_nome, v_email;
end $$;

-- =============================================================================
-- BLOCO 1 — Gente: 12 corretores, 3 gerentes, 2 diretorias, 3 equipes
--
-- Na tela (/equipes): três equipes com corretor de verdade em cada uma, foto e
-- gerente/diretor preenchidos. Sem isto o organograma abre com duas linhas.
--
-- `profiles` referencia `auth.users`, então a pessoa nasce no Auth. O trigger
-- `handle_new_auth_user` cria o perfil e concede `broker`; `banned_until` no
-- futuro impede que a conta figurante sirva para login.
-- =============================================================================

with novos(id, email, full_name, phone) as (
  values
    ('80000000-0000-0000-0000-000000000001'::uuid, 'demo.rafael@example.invalid',  'Rafael Nogueira',  '5511977000001'),
    ('80000000-0000-0000-0000-000000000002'::uuid, 'demo.tatiane@example.invalid', 'Tatiane Prado',    '5511977000002'),
    ('80000000-0000-0000-0000-000000000003'::uuid, 'demo.gustavo@example.invalid', 'Gustavo Peixoto',  '5511977000003'),
    ('80000000-0000-0000-0000-000000000004'::uuid, 'demo.helena@example.invalid',  'Helena Vasques',   '5511977000004'),
    ('80000000-0000-0000-0000-000000000005'::uuid, 'demo.igor@example.invalid',    'Igor Bandeira',    '5511977000005'),
    ('80000000-0000-0000-0000-000000000006'::uuid, 'demo.juliana@example.invalid', 'Juliana Terra',    '5511977000006'),
    ('80000000-0000-0000-0000-000000000010'::uuid, 'demo.diretor@example.invalid', 'Ricardo Sampaio',  '5511977000010'),
    ('80000000-0000-0000-0000-000000000011'::uuid, 'demo.gerente@example.invalid', 'Paula Marchesi',   '5511977000011')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(),
  jsonb_build_object('provider', 'email', 'providers', array['email'], 'seed_demo', true),
  jsonb_build_object('full_name', u.full_name, 'phone', u.phone, 'seed_demo', true),
  now(), now(), '2126-01-01 00:00:00+00'::timestamptz, '', '', '', ''
from novos u
where not exists (select 1 from auth.users au where au.id = u.id or au.email = u.email);

with novos(id, email) as (
  values
    ('80000000-0000-0000-0000-000000000001'::uuid, 'demo.rafael@example.invalid'),
    ('80000000-0000-0000-0000-000000000002'::uuid, 'demo.tatiane@example.invalid'),
    ('80000000-0000-0000-0000-000000000003'::uuid, 'demo.gustavo@example.invalid'),
    ('80000000-0000-0000-0000-000000000004'::uuid, 'demo.helena@example.invalid'),
    ('80000000-0000-0000-0000-000000000005'::uuid, 'demo.igor@example.invalid'),
    ('80000000-0000-0000-0000-000000000006'::uuid, 'demo.juliana@example.invalid'),
    ('80000000-0000-0000-0000-000000000010'::uuid, 'demo.diretor@example.invalid'),
    ('80000000-0000-0000-0000-000000000011'::uuid, 'demo.gerente@example.invalid')
)
insert into auth.identities (id, provider_id, user_id, identity_data, provider,
                             last_sign_in_at, created_at, updated_at)
select u.id, u.email, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from novos u
where exists (select 1 from auth.users au where au.id = u.id)
on conflict do nothing;

-- Diretor e gerente não são corretores: o trigger concede `broker` a todo mundo
-- e sem esta correção os totais de equipe e o pódio contariam gestor como
-- vendedor.
insert into public.user_roles (profile_id, role, granted_by)
values
  ('80000000-0000-0000-0000-000000000010', 'director', '10000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000011', 'manager',  '10000000-0000-0000-0000-000000000001')
on conflict do nothing;

delete from public.user_roles
where role = 'broker'
  and profile_id in ('80000000-0000-0000-0000-000000000010',
                     '80000000-0000-0000-0000-000000000011');

-- Terceira equipe, sob a segunda diretoria. As duas existentes continuam com a
-- Daniela — mover equipe de diretor apagaria estado que não é desta fase.
insert into public.teams (id, name, slug, director_id, manager_id)
values
  ('82000000-0000-0000-0000-000000000001', 'Equipe Centro', 'equipe-centro',
   '80000000-0000-0000-0000-000000000010', '80000000-0000-0000-0000-000000000011')
on conflict do nothing;

insert into public.team_members (id, team_id, profile_id, joined_at)
values
  -- reforço nas equipes existentes
  ('81000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', current_date - 70),
  ('81000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', current_date - 55),
  ('81000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000003', current_date - 60),
  -- equipe nova
  ('81000000-0000-0000-0000-000000000004', '82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000011', current_date - 90),
  ('81000000-0000-0000-0000-000000000005', '82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000004', current_date - 80),
  ('81000000-0000-0000-0000-000000000006', '82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000005', current_date - 45),
  ('81000000-0000-0000-0000-000000000007', '82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000006', current_date - 30)
on conflict do nothing;

-- Foto de perfil. O bucket `avatars` existe mas está vazio e subir arquivo
-- exigiria binário no seed; o DiceBear devolve um SVG determinístico a partir
-- do nome, o que basta para o pódio e o organograma não abrirem com iniciais
-- cinzas. O rollback zera exatamente estas URLs.
update public.profiles
   set avatar_url = 'https://api.dicebear.com/9.x/initials/svg?seed=' || replace(full_name, ' ', '%20')
 where avatar_url is null
   and (id::text like '80000000-%' or email like 'seed.%');

-- =============================================================================
-- BLOCO 2 — 60 leads por origem e estágio
--
-- Na tela (/leads): a lista abre cheia, o filtro por origem tem o que filtrar e
-- há leads em atraso destacados.
--
-- ⚠️ O cron `faceimob-assign-queued` roda a cada minuto e distribui lead em
-- `queued` para quem estiver em check-in — por isso a fila tem só 4 leads: em
-- horário comercial eles somem em até um minuto, e isso é a roleta funcionando.
-- Os demais estão em estados estáveis (`attending`/`in_progress`), que nenhum
-- cron mexe.
--
-- Os 4 `assigned` têm prazo de 45 minutos em vez dos 5 do produto: com 5, o
-- `release_expired_leads` devolveria todos à fila antes de o cliente abrir a
-- tela. Para ver a trava real de 5 minutos correndo, use `npm run demo:lead`.
-- =============================================================================

with nomes(i, nome) as (values
  (1,'Adriano Camargo'),(2,'Bianca Ferrão'),(3,'Caio Rezende'),(4,'Débora Sanches'),
  (5,'Eduardo Vilela'),(6,'Fabiana Moraes'),(7,'Gilberto Prado'),(8,'Heloísa Antunes'),
  (9,'Ivan Bezerra'),(10,'Joana Vilarinho'),(11,'Kleber Marinho'),(12,'Lívia Camargo'),
  (13,'Marcelo Duarte'),(14,'Natália Bragança'),(15,'Otávio Lacerda'),(16,'Priscila Nunes'),
  (17,'Rogério Tavares'),(18,'Sabrina Coutinho'),(19,'Tiago Assunção'),(20,'Úrsula Bittencourt'),
  (21,'Vinícius Marques'),(22,'Wanessa Rios'),(23,'Xavier Fontoura'),(24,'Yara Menezes'),
  (25,'Zeca Bonfim'),(26,'Alice Perdigão'),(27,'Bruno Valente'),(28,'Camila Estrela'),
  (29,'Danilo Quirino'),(30,'Elaine Barroso'),(31,'Fábio Trindade'),(32,'Gisele Amancio'),
  (33,'Hugo Salgado'),(34,'Isabela Pontes'),(35,'Jonas Vidigal'),(36,'Karina Belmonte'),
  (37,'Leandro Furtado'),(38,'Mariana Corvo'),(39,'Nelson Aguiar'),(40,'Olívia Rangel'),
  (41,'Paulo Bragantini'),(42,'Queila Mesquita'),(43,'Renan Portela'),(44,'Simone Delfino'),
  (45,'Thiago Ourique'),(46,'Vanessa Lobato'),(47,'Wagner Cerqueira'),(48,'Yasmin Prata'),
  (49,'Alexandre Nobre'),(50,'Beatriz Falcão'),(51,'Cristiano Veloso'),(52,'Daniela Arruda'),
  (53,'Emerson Tavolaro'),(54,'Flávia Ribas'),(55,'Guilherme Sarmento'),(56,'Helena Cardim'),
  (57,'Ícaro Bevilacqua'),(58,'Juliano Peçanha'),(59,'Larissa Meireles'),(60,'Murilo Xavier')
),
corretores as (
  select array[
    '10000000-0000-0000-0000-000000000005'::uuid,  -- 1  Ana      (Paulista)
    '10000000-0000-0000-0000-000000000006'::uuid,  -- 2  Bruno    (Paulista)
    '10000000-0000-0000-0000-000000000007'::uuid,  -- 3  Carla    (Paulista)
    '80000000-0000-0000-0000-000000000001'::uuid,  -- 4  Rafael   (Paulista)
    '80000000-0000-0000-0000-000000000002'::uuid,  -- 5  Tatiane  (Paulista)
    '10000000-0000-0000-0000-000000000008'::uuid,  -- 6  Diego    (Sul)
    '10000000-0000-0000-0000-000000000009'::uuid,  -- 7  Elisa    (Sul)
    '10000000-0000-0000-0000-000000000010'::uuid,  -- 8  Felipe   (Sul)
    '80000000-0000-0000-0000-000000000003'::uuid,  -- 9  Gustavo  (Sul)
    '80000000-0000-0000-0000-000000000004'::uuid,  -- 10 Helena   (Centro)
    '80000000-0000-0000-0000-000000000005'::uuid,  -- 11 Igor     (Centro)
    '80000000-0000-0000-0000-000000000006'::uuid   -- 12 Juliana  (Centro)
  ] as lista
),
origens as (
  select array[
    (select id from public.lead_sources where code = 'meta_ads'),
    (select id from public.lead_sources where code = 'portal'),
    (select id from public.lead_sources where code = 'indicacao'),
    (select id from public.lead_sources where code = 'organico'),
    (select id from public.lead_sources where code = 'whatsapp')
  ] as lista
)
insert into public.leads (
  id, full_name, phone, email, source_id, status, funnel_stage,
  assigned_to, assigned_at, attend_deadline, first_contact_at, next_action_at,
  lost_at, lost_reason, campaign_id, campaign_name, utm_source, notes,
  created_at, last_activity_at
)
select
  ('83000000-0000-0000-0000-' || lpad(n.i::text, 12, '0'))::uuid,
  n.nome,
  '11' || lpad((950000000 + n.i)::text, 9, '0'),
  ('lead' || n.i || '@example.invalid')::extensions.citext,
  o.lista[1 + (n.i % 5)],
  case
    when n.i <=  4 then 'queued'
    when n.i <=  8 then 'assigned'
    when n.i <= 26 then 'attending'
    when n.i <= 44 then 'in_progress'
    when n.i <= 52 then 'converted'
    when n.i <= 57 then 'lost'
    else 'discarded'
  end::lead_status,
  case
    when n.i <=  4 then 'new'
    when n.i <=  8 then 'new'
    when n.i <= 16 then 'first_contact'
    when n.i <= 26 then 'warm'
    when n.i <= 34 then 'hot'
    when n.i <= 40 then 'gathering_docs'
    when n.i <= 44 then 'scheduled_visit'
    when n.i <= 52 then 'qualified'
    else 'no_response'
  end::lead_funnel_stage,
  case when n.i <= 4 then null else c.lista[1 + (n.i % 12)] end,
  case when n.i <= 4 then null else now() - ((n.i % 21) || ' days')::interval end,
  case when n.i between 5 and 8 then now() + interval '45 minutes' end,
  case when n.i >= 9 and n.i <= 52 then now() - ((n.i % 20) || ' days')::interval end,
  -- 8 leads atrasados (37 a 44), no máximo um por corretor: o bloqueio de
  -- check-in dispara em 20 atrasados e a demo não pode travar o cliente.
  case
    when n.i between 37 and 44 then now() - ((n.i - 36) || ' days')::interval
    when n.i between 9 and 36  then now() + ((n.i % 6) + 1 || ' days')::interval
  end,
  case when n.i between 53 and 57 then now() - ((n.i - 50) || ' days')::interval end,
  case when n.i between 53 and 57 then 'Comprou com concorrente' end,
  case when n.i % 5 = 1 then 'demo-camp-lancamento' when n.i % 5 = 2 then 'demo-camp-remarketing' end,
  case when n.i % 5 = 1 then 'Lançamento Parque das Flores' when n.i % 5 = 2 then 'Remarketing Agosto' end,
  case when n.i % 5 = 1 then 'facebook' when n.i % 5 = 2 then 'instagram' end,
  'Cenário de demonstração.',
  now() - ((n.i % 25) || ' days')::interval,
  now() - ((n.i % 9) || ' hours')::interval
from nomes n
cross join corretores c
cross join origens o
on conflict do nothing;

-- =============================================================================
-- BLOCO 3 — Histórico de atribuições
--
-- Na tela (/checkin): os contadores "hoje / semana / mês" do corretor param de
-- ser zero, e a fila passa a ter ordem, porque `distribution_queue` ordena por
-- quando cada um terminou a última vez.
--
-- `deadline` é obrigatório; `released_at` e `release_reason` andam juntos.
-- Cada INSERT dispara `notify_lead_assigned`, que cria as notificações de lead
-- novo — é de onde vem o sino cheio do corretor.
-- =============================================================================

insert into public.lead_assignments (id, lead_id, profile_id, sequence, assigned_at,
                                     deadline, released_at, release_reason)
select
  ('84000000-0000-0000-0000-' || lpad(l.i::text, 12, '0'))::uuid,
  ('83000000-0000-0000-0000-' || lpad(l.i::text, 12, '0'))::uuid,
  l.dono,
  1,
  l.quando,
  l.quando + interval '5 minutes',
  case when l.i % 7 = 0 then l.quando + interval '6 minutes' end,
  case when l.i % 7 = 0 then 'timeout'::lead_release_reason end
from (
  select
    d.i,
    ld.assigned_to as dono,
    least(
      greatest(date_trunc('month', now()) + interval '9 hours',
               now() - ((d.i % 21) || ' days')::interval),
      now() - interval '5 minutes'
    ) as quando
  from generate_series(9, 52) as d(i)
  join public.leads ld on ld.id = ('83000000-0000-0000-0000-' || lpad(d.i::text, 12, '0'))::uuid
  where ld.assigned_to is not null
) l
on conflict do nothing;

-- =============================================================================
-- BLOCO 4 — 25 negócios cobrindo as 9 etapas do pipeline
--
-- Na tela (/pipeline): nenhuma coluna vazia, VGV plausível no topo de cada uma
-- e cartões com corretor, gerente e construtora preenchidos.
--
-- Os negócios nascem JÁ na etapa final: `deals_guard_stage` é `before update`,
-- então INSERT direto não passa pela matriz de permissão nem pela exigência de
-- documento. Quem vai exercitar essa regra é o cliente, arrastando o cartão.
--
-- `month_base` é o mês corrente para o Dashboard abrir no mês certo —
-- `pickOpenMonth` escolhe o mês mais recente que não está em `closed_months`.
-- =============================================================================

insert into public.deals (
  id, lead_id, developer_id, project_id, unit, stage_id, outcome, month_base,
  vgv_gross, discount_pct, lead_origin, notes, stage_entered_at, closed_at,
  lost_reason, document_review_status, document_reviewed_at, created_by, created_at
)
select
  ('85000000-0000-0000-0000-' || lpad(v.i::text, 12, '0'))::uuid,
  case when v.i between 18 and 25
       then ('83000000-0000-0000-0000-' || lpad((v.i + 27)::text, 12, '0'))::uuid end,
  v.dev, v.proj, v.unidade,
  (select id from public.pipeline_stages where code = v.etapa),
  (select outcome from public.pipeline_stages where code = v.etapa),
  public.month_start(current_date),
  v.vgv, v.desconto,
  'Meta Ads',
  'Negócio do cenário de demonstração.',
  now() - ((v.i % 11) || ' days')::interval,
  case when v.etapa in ('closed','lost')
       then greatest(date_trunc('month', now()) + interval '10 hours',
                     now() - (v.dias_fechado || ' days')::interval) end,
  case when v.etapa = 'lost' then 'Cliente desistiu da compra' end,
  case when v.etapa in ('incomplete','lead') then 'draft' else 'approved' end,
  case when v.etapa in ('incomplete','lead') then null else now() - interval '6 days' end,
  v.corretor,
  now() - ((v.i % 18) || ' days')::interval
from (values
  ( 1,'incomplete',      '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 104', 320000, 0.0, 0,'80000000-0000-0000-0000-000000000005'::uuid),  -- Igor
  ( 2,'incomplete',      '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000003'::uuid,'Bloco 2 - 51',  285000, 0.0, 0,'80000000-0000-0000-0000-000000000006'::uuid),  -- Juliana
  ( 3,'lead',            '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000002'::uuid,'Torre B - 902', 415000, 0.0, 0,'80000000-0000-0000-0000-000000000004'::uuid),  -- Helena
  ( 4,'lead',            '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000004'::uuid,'Bloco 1 - 33',  368000, 0.0, 0,'80000000-0000-0000-0000-000000000002'::uuid),  -- Tatiane
  ( 5,'proposal',        '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 208', 392000, 2.0, 0,'10000000-0000-0000-0000-000000000007'::uuid),  -- Carla
  ( 6,'proposal',        '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000003'::uuid,'Bloco 3 - 12',  447000, 0.0, 0,'80000000-0000-0000-0000-000000000003'::uuid),  -- Gustavo
  ( 7,'proposal',        '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000002'::uuid,'Torre C - 601', 528000, 3.0, 0,'10000000-0000-0000-0000-000000000006'::uuid),  -- Bruno
  ( 8,'visit_scheduled', '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 305', 356000, 0.0, 0,'80000000-0000-0000-0000-000000000001'::uuid),  -- Rafael
  ( 9,'visit_scheduled', '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000004'::uuid,'Bloco 4 - 27',  289000, 0.0, 0,'10000000-0000-0000-0000-000000000010'::uuid),  -- Felipe
  (10,'visit_scheduled', '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000002'::uuid,'Torre B - 1104',610000, 5.0, 0,'10000000-0000-0000-0000-000000000007'::uuid),  -- Carla
  (11,'under_analysis',  '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 401', 470000, 0.0, 0,'10000000-0000-0000-0000-000000000005'::uuid),  -- Ana
  (12,'under_analysis',  '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000003'::uuid,'Bloco 2 - 84',  398000, 0.0, 0,'10000000-0000-0000-0000-000000000008'::uuid),  -- Diego
  (13,'under_analysis',  '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000002'::uuid,'Torre C - 208', 435000, 2.0, 0,'80000000-0000-0000-0000-000000000004'::uuid),  -- Helena
  (14,'approved',        '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 702', 512000, 0.0, 0,'10000000-0000-0000-0000-000000000006'::uuid),  -- Bruno
  (15,'approved',        '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000004'::uuid,'Bloco 1 - 15',  344000, 0.0, 0,'80000000-0000-0000-0000-000000000001'::uuid),  -- Rafael
  (16,'contract',        '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000002'::uuid,'Torre B - 305', 486000, 3.0, 0,'10000000-0000-0000-0000-000000000008'::uuid),  -- Diego
  (17,'contract',        '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000003'::uuid,'Bloco 3 - 66',  372000, 0.0, 0,'80000000-0000-0000-0000-000000000004'::uuid),  -- Helena
  (18,'closed',          '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 902', 545000, 2.0,12,'10000000-0000-0000-0000-000000000005'::uuid),  -- Ana
  (19,'closed',          '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000002'::uuid,'Torre C - 405', 418000, 0.0, 8,'10000000-0000-0000-0000-000000000005'::uuid),  -- Ana
  (20,'closed',          '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000003'::uuid,'Bloco 2 - 21',  361000, 0.0, 4,'10000000-0000-0000-0000-000000000005'::uuid),  -- Ana
  (21,'closed',          '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 1201',638000, 5.0,10,'10000000-0000-0000-0000-000000000008'::uuid),  -- Diego
  (22,'closed',          '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000004'::uuid,'Bloco 4 - 08',  327000, 0.0, 3,'10000000-0000-0000-0000-000000000008'::uuid),  -- Diego
  (23,'closed',          '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000002'::uuid,'Torre B - 706', 459000, 0.0, 6,'80000000-0000-0000-0000-000000000001'::uuid),  -- Rafael
  (24,'closed',          '30000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000003'::uuid,'Bloco 1 - 44',  384000, 2.0,14,'10000000-0000-0000-0000-000000000009'::uuid),  -- Elisa
  (25,'lost',            '30000000-0000-0000-0000-000000000001'::uuid,'31000000-0000-0000-0000-000000000001'::uuid,'Torre A - 110', 298000, 0.0, 9,'80000000-0000-0000-0000-000000000002'::uuid)  -- Tatiane
) as v(i, etapa, dev, proj, unidade, vgv, desconto, dias_fechado, corretor)
on conflict do nothing;

-- Fecha o ciclo lead -> negócio nos 8 leads marcados como convertidos.
update public.leads l
   set converted_deal_id = d.id,
       converted_at = coalesce(l.converted_at, d.created_at)
  from public.deals d
 where d.lead_id = l.id
   and d.id::text like '85000000-%'
   and l.converted_deal_id is null;

-- -----------------------------------------------------------------------------
-- Clientes do negócio. Titular sempre; compra conjunta em um a cada três, que
-- é o que faz a aba "Cliente 2" do modal ter o que mostrar.
-- -----------------------------------------------------------------------------
insert into public.deal_clients (id, deal_id, ordinal, full_name, cpf, phone, email,
                                 marital_status, birthplace, is_shareholder, monthly_income)
select
  ('86000000-0000-0000-0000-' || lpad(v.i::text, 12, '0'))::uuid,
  ('85000000-0000-0000-0000-' || lpad(v.i::text, 12, '0'))::uuid,
  1, v.cliente,
  lpad(((v.i * 37 * 1000003) % 100000000000)::text, 11, '0'),
  '11' || lpad((940000000 + v.i)::text, 9, '0'),
  ('cliente' || v.i || '@example.invalid')::extensions.citext,
  case when v.i % 3 = 0 then 'Casado(a)' else 'Solteiro(a)' end,
  'São Paulo/SP',
  v.i % 4 = 0,
  4200 + (v.i * 310)
from (values
  ( 1,'Adriano Camargo'),( 2,'Bianca Ferrão'),( 3,'Caio Rezende'),( 4,'Débora Sanches'),
  ( 5,'Eduardo Vilela'),( 6,'Fabiana Moraes'),( 7,'Gilberto Prado'),( 8,'Heloísa Antunes'),
  ( 9,'Ivan Bezerra'),(10,'Joana Vilarinho'),(11,'Kleber Marinho'),(12,'Lívia Camargo'),
  (13,'Marcelo Duarte'),(14,'Natália Bragança'),(15,'Otávio Lacerda'),(16,'Priscila Nunes'),
  (17,'Rogério Tavares'),(18,'Sabrina Coutinho'),(19,'Tiago Assunção'),(20,'Úrsula Bittencourt'),
  (21,'Vinícius Marques'),(22,'Wanessa Rios'),(23,'Xavier Fontoura'),(24,'Yara Menezes'),
  (25,'Zeca Bonfim')
) as v(i, cliente)
on conflict do nothing;

insert into public.deal_clients (id, deal_id, ordinal, full_name, cpf, phone, email, marital_status)
select
  ('86000000-0000-0000-0000-' || lpad((100 + v.i)::text, 12, '0'))::uuid,
  ('85000000-0000-0000-0000-' || lpad(v.i::text, 12, '0'))::uuid,
  2, v.conjunta,
  lpad(((v.i * 41 * 1000003) % 100000000000)::text, 11, '0'),
  '11' || lpad((930000000 + v.i)::text, 9, '0'),
  ('conjunta' || v.i || '@example.invalid')::extensions.citext,
  'Casado(a)'
from (values
  ( 3,'Renata Rezende'),( 6,'Otávio Moraes'),( 9,'Silvana Bezerra'),(12,'Bernardo Camargo'),
  (15,'Aline Lacerda'),(18,'Márcio Coutinho'),(21,'Letícia Marques'),(24,'Rodrigo Menezes')
) as v(i, conjunta)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Participantes. O corretor sai de `deals.created_by` — fonte única, definida na
-- lista acima — e o resto o banco resolve: `deal_participants_autofill` puxa o
-- gerente e o diretor da equipe ativa dele, e `deal_participants_resplit`
-- recalcula o rateio de VGV para fechar em 100%. `ordinal` guarda o slot
-- (Corretor 1/2), sem o qual os nomes trocam de lugar no reload — migration 0025.
--
-- ⚠️ `created_by` não é enfeite: o trigger `deals_add_creator_participant`
-- (migration 0012) inscreve quem criou o negócio como Corretor 1. Deixar o
-- admin do seed ali colocaria ELE como corretor de todos os negócios sem
-- lead — e o rateio de VGV passaria metade da comissão para o admin.
-- -----------------------------------------------------------------------------
insert into public.deal_participants (id, deal_id, profile_id, role, ordinal)
select
  ('87000000-0000-0000-0000-' || right(d.id::text, 12))::uuid,
  d.id, d.created_by, 'broker', 1
from public.deals d
where d.id::text like '85000000-%'
  and d.created_by is not null
on conflict do nothing;

-- Dois negócios em dupla: prova que o rateio divide o VGV entre corretores.
insert into public.deal_participants (id, deal_id, profile_id, role, ordinal)
values
  ('87000000-0000-0000-0000-000000000101', '85000000-0000-0000-0000-000000000010',
   '80000000-0000-0000-0000-000000000002', 'broker', 2),
  ('87000000-0000-0000-0000-000000000102', '85000000-0000-0000-0000-000000000021',
   '80000000-0000-0000-0000-000000000003', 'broker', 2)
on conflict do nothing;

-- =============================================================================
-- BLOCO 5 — Documentos do dossiê
--
-- Na tela (aba Anexos do modal de negócio): a lista de documentos aparece e o
-- botão de avançar etapa para de recusar.
--
-- Sem isto o cliente não consegue arrastar cartão para "Em Análise", "Aprovado",
-- "Contrato" ou "Fechado" — todos exigem documento vigente (`requires_document`)
-- e conferência aprovada (`deals_guard_stage`, migration 0028). É o que permite
-- o passo "fechar uma venda" do roteiro.
--
-- ⚠️ São registros sem arquivo no Storage: o download não funciona. Os negócios
-- em "Incompleto" e "Lead" ficam de fora de propósito, para o cliente ver a
-- recusa acontecer quando tentar pular a conferência.
-- =============================================================================

insert into public.deal_documents (id, deal_id, document_type_id, storage_path,
                                   original_name, stored_name, mime_type, size_bytes,
                                   uploaded_by, created_at)
select
  ('88000000-0000-0000-0000-' || lpad((d.i * 10 + t.ord)::text, 12, '0'))::uuid,
  ('85000000-0000-0000-0000-' || lpad(d.i::text, 12, '0'))::uuid,
  t.id,
  'demo-showcase/' || lpad(d.i::text, 2, '0') || '/' || t.code || '.pdf',
  t.label || '.pdf',
  t.code || '-demo-' || lpad(d.i::text, 2, '0') || '.pdf',
  'application/pdf',
  180000 + d.i * 1000,
  '10000000-0000-0000-0000-000000000001',
  now() - interval '7 days'
from generate_series(5, 25) as d(i)
cross join (
  select id, code, label, sort_order as ord
  from public.document_types
  where code in ('rg_cpf', 'comprovante_renda', 'comprovante_resid')
) t
on conflict do nothing;

-- =============================================================================
-- BLOCO 6 — Esteira de crédito (CCA)
--
-- Na tela (/cca): a esteira abre com casos em análise e aprovados em vez da
-- lista vazia. `cca_award_points` é `after update`, então INSERT direto não
-- pontua — os pontos entram no BLOCO 7, controlados.
-- =============================================================================

insert into public.cca_cases (id, deal_id, status, analyst_id, submitted_at, decided_at, decision_notes)
select
  ('8f000000-0000-0000-0000-' || lpad((100 + v.i)::text, 12, '0'))::uuid,
  ('85000000-0000-0000-0000-' || lpad(v.i::text, 12, '0'))::uuid,
  v.situacao::cca_status,
  '10000000-0000-0000-0000-000000000011',
  now() - ((v.i % 9) + 2 || ' days')::interval,
  case when v.situacao = 'approved' then now() - ((v.i % 5) + 1 || ' days')::interval end,
  case when v.situacao = 'approved' then 'Renda comprovada e cadastro sem restrição.' end
from (values
  (11,'under_review'),(12,'under_review'),(13,'under_review'),
  (14,'approved'),(16,'approved'),(18,'approved'),
  (19,'approved'),(21,'approved'),(23,'approved')
) as v(i, situacao)
on conflict do nothing;

-- =============================================================================
-- BLOCO 7 — Temporada e pódio
--
-- Na tela (/gamification): pódio com três colocações DISTINTAS e um histórico
-- de temporada fechada com o placar congelado.
--
-- Duas coisas acontecem aqui, nesta ordem obrigatória:
--   1. a temporada aberta de um mês anterior é ENCERRADA (congela o ranking em
--      `game_season_results`) — é o que o admin deveria ter feito na virada;
--   2. a temporada do mês corrente é aberta.
-- O índice `game_seasons_one_open` só admite uma aberta por vez, então inverter
-- a ordem falha. `close_game_season()` faria os dois, mas exige `is_admin()` e
-- num seed não há JWT — daí o passo a passo explícito.
-- =============================================================================

do $$
declare v_anterior public.game_seasons;
begin
  select * into v_anterior from public.game_seasons
   where closed_at is null
     and period_start < public.month_start(current_date)
   order by period_start desc limit 1;

  if not found then
    raise notice '[060] nenhuma temporada antiga aberta — nada a encerrar.';
    return;
  end if;

  insert into public.game_season_results (season_id, profile_id, rank, points, sales, vgv, breakdown)
  select
    r.season_id, r.profile_id,
    row_number() over (order by r.points desc, r.full_name)::int,
    r.points, r.sales,
    coalesce((
      select sum(d.vgv_net * dp.share_pct / 100)
      from public.deal_participants dp
      join public.deals d on d.id = dp.deal_id
      where dp.profile_id = r.profile_id and dp.role = 'broker'
        and d.outcome = 'won' and d.closed_at >= v_anterior.period_start
    ), 0),
    r.breakdown
  from public.game_ranking r
  where r.season_id = v_anterior.id
  on conflict (season_id, profile_id) do nothing;

  update public.game_seasons
     set closed_at  = public.month_start(current_date)::timestamptz,
         period_end = public.month_start(current_date) - 1
   where id = v_anterior.id;

  raise notice '[060] temporada "%" encerrada e congelada.', v_anterior.label;
end $$;

-- A temporada do mês corrente só é criada se NENHUMA estiver aberta. Quando o
-- banco já tem uma temporada corrente (o seed da fase 4 cria uma), ela é
-- reaproveitada — inserir mais uma seria barrado pelo índice
-- `game_seasons_one_open`, e com `on conflict do nothing` o erro passaria
-- despercebido, deixando tudo o que vem abaixo apontando para uma temporada
-- inexistente.
insert into public.game_seasons (id, label, period_start)
select
  '89000000-0000-0000-0000-000000000001',
  (array['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
         'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'])
    [extract(month from current_date)::int]
    || ' ' || extract(year from current_date)::text,
  public.month_start(current_date)
where not exists (select 1 from public.game_seasons where closed_at is null)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Pontos que nascem do funil: venda e aprovação de crédito.
--
-- `award_game_points` lê o peso de `game_scoring_rules` e é idempotente quando
-- há `ref_id` — o índice `game_events_dedupe_idx` impede pontuar duas vezes o
-- mesmo negócio pelo mesmo motivo. Por isso o seed chama a função em vez de
-- inserir na tabela: reaplicar não infla o placar.
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select v.i, v.code, dp.profile_id, d.id as deal_id
    from (values
      -- venda: os 7 negócios fechados
      (18,'venda'),(19,'venda'),(20,'venda'),(21,'venda'),(22,'venda'),(23,'venda'),(24,'venda'),
      -- aprovado: crédito aprovado na esteira
      (14,'aprovado'),(16,'aprovado'),(18,'aprovado'),(21,'aprovado'),(22,'aprovado'),(23,'aprovado')
    ) as v(i, code)
    join public.deals d on d.id = ('85000000-0000-0000-0000-' || lpad(v.i::text, 12, '0'))::uuid
    join public.deal_participants dp on dp.deal_id = d.id and dp.role = 'broker' and dp.ordinal = 1
  loop
    perform public.award_game_points(
      r.profile_id, r.code, 'deal', r.deal_id,
      greatest(public.month_start(current_date)::timestamptz + interval '10 hours',
               now() - ((r.i % 13) || ' days')::interval)
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Pontos de esforço (esteira, incompleto com documento) e a penalidade.
--
-- Não têm negócio próprio no cenário, então entram direto — com o peso lido de
-- `game_scoring_rules`, para o placar continuar coerente com a tela de regras.
-- O distrato é de uma venda da temporada anterior: aparece em vermelho e é o
-- único jeito de mostrar penalidade sem cancelar um negócio da demonstração.
-- -----------------------------------------------------------------------------
insert into public.game_events (id, season_id, profile_id, event_code, points, occurred_at)
select
  ('8a000000-0000-0000-0000-' || lpad(row_number() over (order by p.ord, g.n)::text, 12, '0'))::uuid,
  public.current_game_season(),
  p.profile_id, p.code,
  (select points from public.game_scoring_rules r where r.event_code = p.code and r.season_id is null),
  greatest(public.month_start(current_date)::timestamptz + interval '9 hours',
           now() - ((g.n * 5) || ' hours')::interval)
from (values
  ( 1,'10000000-0000-0000-0000-000000000005'::uuid,'esteira',            2),  -- Ana
  ( 2,'10000000-0000-0000-0000-000000000005'::uuid,'incompleto_com_doc', 3),
  ( 3,'10000000-0000-0000-0000-000000000008'::uuid,'esteira',            2),  -- Diego
  ( 4,'10000000-0000-0000-0000-000000000008'::uuid,'incompleto_com_doc', 2),
  ( 5,'80000000-0000-0000-0000-000000000001'::uuid,'esteira',            3),  -- Rafael
  ( 6,'80000000-0000-0000-0000-000000000001'::uuid,'incompleto_com_doc', 5),
  ( 7,'80000000-0000-0000-0000-000000000004'::uuid,'esteira',            2),  -- Helena
  ( 8,'80000000-0000-0000-0000-000000000004'::uuid,'incompleto_com_doc', 4),
  ( 9,'10000000-0000-0000-0000-000000000006'::uuid,'esteira',            1),  -- Bruno
  (10,'10000000-0000-0000-0000-000000000006'::uuid,'incompleto_com_doc', 3),
  (11,'10000000-0000-0000-0000-000000000009'::uuid,'esteira',            1),  -- Elisa
  (12,'10000000-0000-0000-0000-000000000009'::uuid,'incompleto_com_doc', 2),
  (13,'10000000-0000-0000-0000-000000000009'::uuid,'distrato',           1),
  (14,'10000000-0000-0000-0000-000000000007'::uuid,'esteira',            2),  -- Carla
  (15,'10000000-0000-0000-0000-000000000007'::uuid,'incompleto_com_doc', 3),
  (16,'80000000-0000-0000-0000-000000000002'::uuid,'esteira',            1),  -- Tatiane
  (17,'80000000-0000-0000-0000-000000000002'::uuid,'incompleto_com_doc', 6),
  (18,'10000000-0000-0000-0000-000000000010'::uuid,'esteira',            1),  -- Felipe
  (19,'10000000-0000-0000-0000-000000000010'::uuid,'incompleto_com_doc', 2),
  (20,'80000000-0000-0000-0000-000000000003'::uuid,'esteira',            1),  -- Gustavo
  (21,'80000000-0000-0000-0000-000000000003'::uuid,'incompleto_com_doc', 1),
  (22,'80000000-0000-0000-0000-000000000005'::uuid,'incompleto_com_doc', 8),  -- Igor
  (23,'80000000-0000-0000-0000-000000000006'::uuid,'incompleto_com_doc', 5)   -- Juliana
) as p(ord, profile_id, code, qtd)
cross join lateral generate_series(1, p.qtd) as g(n)
on conflict do nothing;

-- O próprio usuário da demonstração aparece no placar, e não em último com
-- zero: ele também é corretor de uma equipe (BLOCO 12).
do $$
declare v_demo uuid;
begin
  select p.id into v_demo from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'admin')
  order by
    (p.id::text not like '10000000-%' and p.email <> 'dev.alisson.rosa@gmail.com') desc,
    (p.email = 'dev.alisson.rosa@gmail.com') desc,
    p.created_at desc
  limit 1;

  insert into public.game_events (id, season_id, profile_id, event_code, points, occurred_at)
  select
    ('8a000000-0000-0000-0000-' || lpad((900 + g.n)::text, 12, '0'))::uuid,
    public.current_game_season(),
    v_demo, g.code,
    (select points from public.game_scoring_rules r where r.event_code = g.code and r.season_id is null),
    greatest(public.month_start(current_date)::timestamptz + interval '9 hours',
             now() - ((g.n * 3) || ' hours')::interval)
  from (values (1,'esteira'),(2,'incompleto_com_doc'),(3,'incompleto_com_doc')) as g(n, code)
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOCO 8 — Metas
--
-- Na tela (/dashboard, aba Metas): o cartão de meta global deixa de mostrar "—".
-- Era a pendência operacional nº 1 de `docs/sprints/decisoes.md`: o Dashboard lê
-- `goals` com scope 'global' e metric 'sales', e não existe UI para cadastrar.
-- =============================================================================

insert into public.goals (id, scope, team_id, profile_id, period_type, period, metric, target, created_by)
values
  ('8b000000-0000-0000-0000-000000000001', 'global', null, null, 'month', public.month_start(current_date), 'sales',  14,      '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000002', 'global', null, null, 'month', public.month_start(current_date), 'vgv',    6500000, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000003', 'global', null, null, 'year',  date_trunc('year', current_date)::date, 'sales', 150, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000004', 'team', '20000000-0000-0000-0000-000000000001', null, 'month', public.month_start(current_date), 'sales', 6, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000005', 'team', '20000000-0000-0000-0000-000000000002', null, 'month', public.month_start(current_date), 'sales', 5, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000006', 'team', '82000000-0000-0000-0000-000000000001', null, 'month', public.month_start(current_date), 'sales', 3, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000007', 'profile', null, '10000000-0000-0000-0000-000000000005', 'month', public.month_start(current_date), 'sales', 3, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000008', 'profile', null, '10000000-0000-0000-0000-000000000008', 'month', public.month_start(current_date), 'sales', 3, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000009', 'profile', null, '80000000-0000-0000-0000-000000000001', 'month', public.month_start(current_date), 'sales', 2, '10000000-0000-0000-0000-000000000001'),
  ('8b000000-0000-0000-0000-000000000010', 'profile', null, '80000000-0000-0000-0000-000000000004', 'month', public.month_start(current_date), 'visits', 14, '10000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- =============================================================================
-- BLOCO 9 — Agenda do dia: tarefas e visitas
--
-- Na tela (painel de atividades e aba Agenda do lead): há o que fazer hoje, uma
-- pendência vencida em vermelho e uma concluída riscada.
--
-- `tasks_done_consistency` exige status='done' junto de completed_at.
-- ⚠️ `tasks_sync_lead_deadline` reescreve `leads.next_action_at` com o menor
-- vencimento aberto da tarefa — por isso as tarefas de lead usam os leads que
-- já estão marcados como atrasados no BLOCO 2, e não outros.
-- =============================================================================

do $$
declare v_demo uuid;
begin
  select p.id into v_demo from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'admin')
  order by
    (p.id::text not like '10000000-%' and p.email <> 'dev.alisson.rosa@gmail.com') desc,
    (p.email = 'dev.alisson.rosa@gmail.com') desc,
    p.created_at desc
  limit 1;

  insert into public.tasks (id, title, description, assigned_to, created_by, due_at,
                            completed_at, status, priority, ref_type, ref_id)
  values
    ('8c000000-0000-0000-0000-000000000001', 'Retornar ligação — Simone Delfino',
     'Cliente pediu retorno sobre a simulação.', v_demo, v_demo,
     date_trunc('day', now()) + interval '9 hours', null, 'open', 'high',
     'lead', '83000000-0000-0000-0000-000000000044'),
    ('8c000000-0000-0000-0000-000000000002', 'Enviar proposta — Torre B 1104',
     'Proposta com 5% de desconto aprovada pelo gerente.', v_demo, v_demo,
     date_trunc('day', now()) + interval '15 hours', null, 'open', 'normal',
     'deal', '85000000-0000-0000-0000-000000000010'),
    ('8c000000-0000-0000-0000-000000000003', 'Cobrar documentos — Renan Portela',
     'Faltam comprovante de renda e residência.', v_demo, v_demo,
     now() - interval '1 day', null, 'open', 'high',
     'lead', '83000000-0000-0000-0000-000000000043'),
    ('8c000000-0000-0000-0000-000000000004', 'Conferir dossiê — Torre A 702',
     null, v_demo, v_demo,
     now() - interval '2 days', now() - interval '2 days', 'done', 'normal',
     'deal', '85000000-0000-0000-0000-000000000014'),
    ('8c000000-0000-0000-0000-000000000005', 'Reunião de resultados com a diretoria',
     'Fechamento parcial do mês.', v_demo, v_demo,
     date_trunc('day', now()) + interval '17 hours', null, 'open', 'normal',
     null, null)
  on conflict do nothing;

  insert into public.visits (id, lead_id, deal_id, broker_id, scheduled_at, performed_at, result, notes)
  values
    ('8d000000-0000-0000-0000-000000000001', null, '85000000-0000-0000-0000-000000000008',
     '80000000-0000-0000-0000-000000000001', date_trunc('day', now()) + interval '10 hours',
     null, 'scheduled', 'Visita ao decorado da Torre A.'),
    ('8d000000-0000-0000-0000-000000000002', null, '85000000-0000-0000-0000-000000000009',
     '10000000-0000-0000-0000-000000000010', date_trunc('day', now()) + interval '14 hours',
     null, 'scheduled', 'Cliente confirmou por WhatsApp.'),
    ('8d000000-0000-0000-0000-000000000003', null, '85000000-0000-0000-0000-000000000010',
     '10000000-0000-0000-0000-000000000007', date_trunc('day', now()) + interval '16 hours 30 minutes',
     null, 'scheduled', 'Levar planta da cobertura.'),
    ('8d000000-0000-0000-0000-000000000004', null, '85000000-0000-0000-0000-000000000018',
     '10000000-0000-0000-0000-000000000005', now() - interval '9 days', now() - interval '9 days',
     'completed', 'Gostou da vista; fechou na semana seguinte.'),
    ('8d000000-0000-0000-0000-000000000005', '83000000-0000-0000-0000-000000000041', null,
     '80000000-0000-0000-0000-000000000005', now() - interval '3 days', null,
     'no_show', 'Cliente não compareceu; remarcar.')
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOCO 10 — Notificações do usuário da demonstração
--
-- Na tela (sino do cabeçalho): badge com 5 não lidas, cada uma levando a uma
-- tela diferente. As já lidas ficam esmaecidas e provam que o estado persiste.
-- =============================================================================

do $$
declare v_demo uuid;
begin
  select p.id into v_demo from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'admin')
  order by
    (p.id::text not like '10000000-%' and p.email <> 'dev.alisson.rosa@gmail.com') desc,
    (p.email = 'dev.alisson.rosa@gmail.com') desc,
    p.created_at desc
  limit 1;

  insert into public.notifications (id, profile_id, kind, title, body, link, channel, read_at, sent_at, created_at)
  values
    ('8e000000-0000-0000-0000-000000000001', v_demo, 'deal_stage',
     'Venda registrada: Torre A 1201', 'Diego Costa fechou R$ 606.100 no Parque das Flores.',
     '/pipeline', 'in_app', null, now(), now() - interval '25 minutes'),
    ('8e000000-0000-0000-0000-000000000002', v_demo, 'lead_assigned',
     'Novo lead: Simone Delfino', 'Origem Meta Ads, aguardando primeiro contato.',
     '/leads', 'in_app', null, now(), now() - interval '1 hour'),
    ('8e000000-0000-0000-0000-000000000003', v_demo, 'task_due',
     'Você tem atividade vencida', 'Cobrar documentos — Renan Portela venceu ontem.',
     '/leads', 'in_app', null, now(), now() - interval '3 hours'),
    ('8e000000-0000-0000-0000-000000000004', v_demo, 'deal_stage',
     'Crédito aprovado: Torre B 305', 'O CCA aprovou a análise; siga para contrato.',
     '/cca', 'in_app', null, now(), now() - interval '5 hours'),
    ('8e000000-0000-0000-0000-000000000005', v_demo, 'system',
     'Meta do mês em 50%', '7 de 14 vendas registradas até agora.',
     '/dashboard', 'in_app', null, now(), now() - interval '8 hours'),
    ('8e000000-0000-0000-0000-000000000006', v_demo, 'system',
     'Bem-vindo ao FACEIMOB', 'Esta você já leu — aparece esmaecida.',
     null, 'in_app', now() - interval '1 day', now(), now() - interval '2 days'),
    ('8e000000-0000-0000-0000-000000000007', v_demo, 'deal_stage',
     'Dossiê enviado à construtora', 'Viva Lar recebeu a documentação do Bloco 1 - 15.',
     '/pipeline', 'in_app', now() - interval '2 days', now(), now() - interval '3 days')
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOCO 11 — Marketing e consolidado anual
--
-- Na tela (/marketing): aportes do mês por construtora e campanhas com custo
-- por lead calculado — o `external_id` casa com `leads.campaign_id` do BLOCO 2.
-- Na tela (/resultados): a linha do mês corrente aparece no consolidado.
-- =============================================================================

insert into public.marketing_investments (id, developer_id, period, amount, notes, created_by)
values
  ('8f000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   public.month_start(current_date), 21500, 'Aporte do mês — Horizonte Urbanismo.',
   '10000000-0000-0000-0000-000000000001'),
  ('8f000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
   public.month_start(current_date), 16400, 'Aporte do mês — Viva Lar Incorporadora.',
   '10000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.ad_campaigns (id, external_id, platform, name, developer_id, status,
                                 daily_budget, total_spend, synced_at)
values
  ('8f000000-0000-0000-0000-000000000011', 'demo-camp-lancamento', 'meta',
   'Lançamento Parque das Flores', '30000000-0000-0000-0000-000000000001', 'active',
   450, 12800, now() - interval '2 hours'),
  ('8f000000-0000-0000-0000-000000000012', 'demo-camp-remarketing', 'meta',
   'Remarketing Agosto', '30000000-0000-0000-0000-000000000002', 'active',
   280, 7300, now() - interval '2 hours'),
  ('8f000000-0000-0000-0000-000000000013', 'demo-camp-institucional', 'google',
   'Institucional — Marca', '30000000-0000-0000-0000-000000000001', 'paused',
   120, 2100, now() - interval '1 day')
on conflict do nothing;

insert into public.annual_results (id, year, month, sales_count, vgv, notes, updated_by)
select
  '8f000000-0000-0000-0000-000000000021',
  extract(year from current_date)::int,
  extract(month from current_date)::int,
  (select count(*)::int from public.deals where outcome = 'won' and id::text like '85000000-%'),
  (select coalesce(sum(vgv_net), 0) from public.deals where outcome = 'won' and id::text like '85000000-%'),
  'Parcial do mês corrente (cenário de demonstração).',
  '10000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- =============================================================================
-- BLOCO 12 — Diário de equipe
--
-- Na tela (/checkpoint): a semana corrente tem números por equipe em vez de
-- zeros, e o Checkpoint público do diretor mostra os totais.
-- =============================================================================

-- `unique (team_id, report_date)`: se a equipe já tem diário do dia (o seed da
-- fase 4 cria alguns), o INSERT é ignorado e as linhas entram no relatório que
-- já existe — por isso as entradas resolvem o relatório por equipe+data, e não
-- pelo UUID fixo. O rollback apaga as entradas pelo id próprio delas, o que
-- limpa também as que caíram num relatório de outra fase.
insert into public.daily_reports (id, team_id, report_date, submitted_by, notes)
values
  ('8f000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000001',
   current_date, '10000000-0000-0000-0000-000000000003', 'Fechamento do dia — Paulista.'),
  ('8f000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000002',
   current_date, '10000000-0000-0000-0000-000000000004', 'Fechamento do dia — Sul.'),
  ('8f000000-0000-0000-0000-000000000033', '82000000-0000-0000-0000-000000000001',
   current_date - 1, '80000000-0000-0000-0000-000000000011', 'Fechamento de ontem — Centro.')
on conflict (team_id, report_date) do nothing;

insert into public.daily_entries (id, report_id, profile_id, leads, calls, doc_collections,
                                  visits_scheduled, visits_done, analyses_sent,
                                  analyses_approved, sales)
select
  ('8f000000-0000-0000-0000-' || lpad((400 + v.n)::text, 12, '0'))::uuid,
  r.id, v.profile_id,
  v.leads, v.calls, v.docs, v.vis_ag, v.vis_fe, v.env, v.apr, v.vendas
from (values
  (1,'20000000-0000-0000-0000-000000000001'::uuid, 0,'10000000-0000-0000-0000-000000000005'::uuid, 6, 14, 3, 2, 1, 2, 1, 1),
  (2,'20000000-0000-0000-0000-000000000001'::uuid, 0,'10000000-0000-0000-0000-000000000006'::uuid, 4,  9, 2, 1, 1, 1, 1, 0),
  (3,'20000000-0000-0000-0000-000000000001'::uuid, 0,'10000000-0000-0000-0000-000000000007'::uuid, 5, 11, 1, 2, 0, 1, 0, 0),
  (4,'20000000-0000-0000-0000-000000000001'::uuid, 0,'80000000-0000-0000-0000-000000000001'::uuid, 3,  8, 2, 1, 1, 1, 1, 0),
  (5,'20000000-0000-0000-0000-000000000002'::uuid, 0,'10000000-0000-0000-0000-000000000008'::uuid, 7, 16, 4, 3, 2, 2, 2, 1),
  (6,'20000000-0000-0000-0000-000000000002'::uuid, 0,'10000000-0000-0000-0000-000000000009'::uuid, 4, 10, 1, 1, 1, 1, 0, 0),
  (7,'20000000-0000-0000-0000-000000000002'::uuid, 0,'10000000-0000-0000-0000-000000000010'::uuid, 3,  7, 2, 1, 0, 1, 0, 0),
  (8,'82000000-0000-0000-0000-000000000001'::uuid, 1,'80000000-0000-0000-0000-000000000004'::uuid, 5, 12, 3, 2, 2, 2, 1, 0),
  (9,'82000000-0000-0000-0000-000000000001'::uuid, 1,'80000000-0000-0000-0000-000000000005'::uuid, 2,  6, 1, 1, 0, 0, 0, 0),
  (10,'82000000-0000-0000-0000-000000000001'::uuid,1,'80000000-0000-0000-0000-000000000006'::uuid, 3, 8, 2, 1, 1, 1, 0, 0)
) as v(n, team_id, dias_atras, profile_id, leads, calls, docs, vis_ag, vis_fe, env, apr, vendas)
join public.daily_reports r
  on r.team_id = v.team_id and r.report_date = current_date - v.dias_atras
on conflict do nothing;

-- =============================================================================
-- BLOCO 13 — O usuário da demonstração entra na operação
--
-- Na tela (/checkin): o botão de check-in fica habilitado, a fila mostra os
-- colegas e os contadores por período têm número.
--
-- `bypass_ip_check` é a trava antifraude do check-in: sem ela o cliente, que
-- está no escritório dele, seria barrado por IP. `profiles_guard_admin_columns`
-- exige `is_admin()` para mexer nessa coluna e num seed não há JWT, então o
-- bloco ASSUME a identidade do próprio usuário (que é admin) em vez de
-- desligar o trigger — desligar removeria a proteção de todo mundo.
-- =============================================================================

do $$
declare v_demo uuid; v_grupo uuid;
begin
  select p.id into v_demo from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'admin')
  order by
    (p.id::text not like '10000000-%' and p.email <> 'dev.alisson.rosa@gmail.com') desc,
    (p.email = 'dev.alisson.rosa@gmail.com') desc,
    p.created_at desc
  limit 1;

  select id into v_grupo from public.distribution_groups where kind = 'general' and active limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_demo::text, 'role', 'authenticated')::text, true);
  update public.profiles set bypass_ip_check = true where id = v_demo;

  -- Papel é N:N: o mesmo usuário é admin e corretor, que é o que dá sentido à
  -- pré-visualização "Ver como Corretor" do cabeçalho.
  --
  -- `granted_by` é o diretor do cenário de propósito: é a MARCA que diz ao
  -- rollback que foi esta fase quem concedeu. Todo usuário criado pelo Auth já
  -- nasce corretor (trigger `handle_new_auth_user`), então sem a marca o
  -- rollback tiraria um papel que o usuário já tinha — e um `on conflict do
  -- nothing` preserva a linha antiga, com a marca dela, exatamente como deve.
  insert into public.user_roles (profile_id, role, granted_by)
  values (v_demo, 'broker', '80000000-0000-0000-0000-000000000010')
  on conflict do nothing;

  insert into public.team_members (id, team_id, profile_id, joined_at)
  values ('81000000-0000-0000-0000-000000000099',
          '20000000-0000-0000-0000-000000000001', v_demo, current_date - 20)
  on conflict do nothing;

  -- `do nothing`, e não `do update`: se o usuário já estava na fila, o estado
  -- dele é dele — mexer aqui seria alteração que o rollback não sabe desfazer.
  insert into public.distribution_group_members (group_id, profile_id, active)
  select v_grupo, v_demo, true where v_grupo is not null
  on conflict (group_id, profile_id) do nothing;

  -- Corretores do cenário na fila geral, senão a fila abre vazia.
  insert into public.distribution_group_members (group_id, profile_id, active)
  select v_grupo, p.id, true
  from public.profiles p
  where v_grupo is not null
    and p.id::text like '80000000-%'
    and exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'broker')
  on conflict (group_id, profile_id) do update set active = true;
end $$;

-- Presença de hoje. `distribution_queue` só lista quem fez check-in hoje E está
-- dentro da janela de distribuição do turno; `auto_checkout_expired` fecha em
-- até um minuto qualquer presença fora dela. Por isso o check-in só é criado
-- quando há turno ABERTO agora — criar fora produziria uma fila que some
-- sozinha, o que parece defeito e é o sistema funcionando.
insert into public.checkins (id, profile_id, shift_id, work_date, checked_in_at, ip_address, leads_received)
select
  ('8f000000-0000-0000-0000-' || lpad((500 + row_number() over (order by p.id))::text, 12, '0'))::uuid,
  p.id, s.id, current_date,
  greatest(now() - interval '90 minutes', current_date + s.distribution_start),
  '127.0.0.1'::inet,
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
  '10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000008', '80000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000004'
)
on conflict do nothing;

do $$
declare v_turno text;
begin
  select code into v_turno from public.work_shifts
   where active
     and (now() at time zone 'America/Sao_Paulo')::time >= distribution_start
     and (now() at time zone 'America/Sao_Paulo')::time <  checkout_time
   limit 1;

  if v_turno is null then
    raise notice '[060] AGORA (% em SP) nenhum turno está aberto — a fila do check-in fica vazia até o próximo abrir.',
      to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI');
    raise notice '[060] Turnos: %',
      (select string_agg(code || ' ' || distribution_start || '-' || checkout_time, ' | ' order by position)
         from public.work_shifts where active);
  else
    raise notice '[060] Turno aberto: % — presenças criadas.', v_turno;
  end if;
end $$;

-- =============================================================================
-- Resumo
-- =============================================================================
do $$
declare
  v_demo uuid;
  v_temporada uuid := public.current_game_season();
begin
  select p.id into v_demo from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'admin')
  order by
    (p.id::text not like '10000000-%' and p.email <> 'dev.alisson.rosa@gmail.com') desc,
    (p.email = 'dev.alisson.rosa@gmail.com') desc,
    p.created_at desc
  limit 1;

  raise notice '';
  raise notice '[060] ============ CENÁRIO DE DEMONSTRAÇÃO PRONTO ============';
  raise notice '[060] Usuário da demo ............. %', (select full_name || ' <' || email || '>' from public.profiles where id = v_demo);
  raise notice '[060] Corretores ................. %', (select count(*) from public.user_roles where role = 'broker');
  raise notice '[060] Equipes ativas ............. %', (select count(*) from public.teams where active);
  raise notice '[060] Leads do cenário ........... %', (select count(*) from public.leads where id::text like '83000000-%');
  raise notice '[060] Negócios do cenário ........ % (VGV líquido R$ %)',
    (select count(*) from public.deals where id::text like '85000000-%'),
    (select to_char(coalesce(sum(vgv_net),0), 'FM999G999G999D00') from public.deals where id::text like '85000000-%');
  raise notice '[060] Vendas fechadas ............ %', (select count(*) from public.deals where id::text like '85000000-%' and outcome = 'won');
  raise notice '[060] Documentos anexados ........ %', (select count(*) from public.deal_documents where id::text like '88000000-%');
  raise notice '[060] Casos no CCA ............... %', (select count(*) from public.cca_cases where id::text like '8f000000-%');
  raise notice '[060] Eventos de jogo (temporada)  %', (select count(*) from public.game_events where season_id = v_temporada);
  raise notice '[060] Pódio ...................... %',
    (select string_agg(x.full_name || ' (' || x.points || ')', ' · ' order by x.points desc)
       from (select full_name, points from public.game_ranking
              where season_id = v_temporada order by points desc limit 3) x);
  raise notice '[060] Metas ...................... %', (select count(*) from public.goals where id::text like '8b000000-%');
  raise notice '[060] Tarefas do usuário ......... %', (select count(*) from public.tasks where assigned_to = v_demo);
  raise notice '[060] Visitas .................... %', (select count(*) from public.visits where id::text like '8d000000-%');
  raise notice '[060] Notificações não lidas ..... %', (select count(*) from public.notifications where profile_id = v_demo and read_at is null);
  raise notice '[060] Presenças hoje ............. %', (select count(*) from public.checkins where work_date = current_date and checked_out_at is null);
  raise notice '[060] ========================================================';
end $$;
