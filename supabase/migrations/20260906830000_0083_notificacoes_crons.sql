-- =============================================================================
-- 0083 — Notificações e crons: a fila para de crescer, o motivo aparece em toda
--        linha, e o que falha em silêncio passa a avisar alguém.
--
-- A 0065 destravou o encanamento (job ativo, gatilho econômico, sino separado da
-- fila de saída). O que ela não fechou, e este arquivo fecha, são as seis
-- consequências que a auditoria de 03/09 mediu no ambiente de homologação:
--
--  1. A FILA DE SAÍDA CRESCE SEM TETO. 312 linhas `whatsapp` com `sent_at is
--     null` agora, 268 delas criadas hoje, +30 em 12 minutos de auditoria — a
--     roleta e o `release_expired_leads` reciclam os leads de demonstração e
--     cada volta produz um aviso. Não há corte por idade em lugar nenhum: no
--     primeiro minuto em que a credencial da Cloud API funcionar, CINCO
--     corretores recebem centenas de "você perdeu o lead X" de leads que
--     voltaram para a fila horas atrás. A cópia `in_app` do mesmo evento
--     continua no sino, que é o registro durável; o que expira aqui é a
--     entrega por WhatsApp, que só serve enquanto o fato é recente.
--     E o descarte AVISA o admin (uma vez a cada 12 h): trocar "a fila cresce e
--     ninguém vê" por "a fila some e ninguém vê" não seria conserto nenhum.
--
--  2. O DESTINATÁRIO PODE APAGAR O PRÓPRIO AVISO ANTES DE ELE SAIR.
--     `notifications_delete` é `profile_id = auth.uid()` sem recorte de canal:
--     o corretor tem permissão de RLS para deletar a linha `whatsapp` de "lead
--     perdido por prazo" que ainda está na fila. Não há tela para isso hoje —
--     mas a fronteira é a policy, não a ausência de botão. `notifications_update`
--     tem o mesmo buraco pelo outro lado: "Marcar todas como lidas" escreve
--     `read_at` nas linhas da fila de saída, que a tela nunca mostrou.
--
--  3. A SUPERFÍCIE DA FILA CONTA O NÚMERO ERRADO. A aba Saúde dos jobs mostra
--     `faceimob-notify-dispatch` verde — porque ele de fato roda, todo minuto, e
--     devolve 503 por falta de credencial. A leitura da fila (a
--     `notification_queue_health()` da 0082) existe, mas conta 312 pendentes que
--     em boa parte já não deveriam sair. Corrigir isso é o item 1: número
--     honesto é fila com teto, não consulta nova.
--
--  4. JOB QUE FALHA NÃO AVISA NINGUÉM. `failures_24h` só existe para quem abre
--     a aba. O sintoma de um cron parado aparece longe da causa (lead que não
--     é liberado, dossiê que não sai) e dias depois.
--
--  5. `task_due` NÃO TEM PRODUTOR. O kind existe em dado de seed desde a 050, a
--     tela de Atividades existe, e atividade vencida não gera aviso nenhum.
--     Também é o primeiro produtor que alcança `sdr` e `partner`: até aqui o
--     sino desses perfis nunca teria uma linha. O AVISO alcança os dois; o LINK
--     só quem tem `menu.atividades` — `sdr`, `marketing` e `cca` não têm, e
--     mandá-los para /atividades seria um clique em "Acesso não liberado".
--
--  6. MENSAGEM DE WHATSAPP QUE NÃO CASA COM LEAD NEM COM REMARKETING SOME.
--     `whatsapp-inbound-webhook` faz `continue` e devolve 200 à Meta: o cliente
--     que responde o WhatsApp da empresa não deixa registro, não tem caixa de
--     entrada e não é encaminhado a humano. O mesmo `continue` engole a
--     mensagem quando a OpenAI falha no turno do agente.
--
-- E um sétimo, do outro worker: dossiê que estoura 5 tentativas fica morto e
-- invisível — a única superfície é o diálogo dentro de /cca, e quem pediu o
-- envio não é avisado.
--
-- NÃO está aqui, de propósito: `cron_jobs_health()` continua devolvendo lista
-- vazia (em vez de erro) para quem não é admin. Trocar por `raise` reprovaria
-- `supabase/tests/04_cron_scheduling.sql`, que afirma o contrário e é de outra
-- frente; o diff dos dois arquivos está registrado como pendência.
--
-- Idempotente: `create or replace`, `create table if not exists`, `drop policy
-- if exists`, agendamento verificado antes de mexer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Caixa de entrada é `in_app` também no UPDATE e no DELETE
--
-- A 0065 separou os dois papéis de `notifications` só no SELECT. A leitura
-- passou a mostrar apenas a caixa do usuário, mas a escrita continuou alcançando
-- a fila de saída — e uma fila de entrega que o próprio destinatário pode
-- apagar ou carimbar não é uma fila.
--
-- Consequência de aplicar: `markAllNotificationsRead` deixa de afetar linhas
-- `whatsapp`/`email`. O retorno de `.select('id')` passa a contar exatamente o
-- que a tela mostrava — hoje ele conta a mais. Nada muda para o worker: ele lê e
-- escreve com service role, que não passa por RLS.
-- -----------------------------------------------------------------------------
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using      (profile_id = auth.uid() and channel = 'in_app')
  with check (profile_id = auth.uid() and channel = 'in_app');

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (profile_id = auth.uid() and channel = 'in_app');

-- -----------------------------------------------------------------------------
-- 2. Corte de idade da fila de saída
--
-- DUAS HORAS. O aviso que trafega por este canal é "você perdeu o lead por
-- prazo", e a trava de atendimento é de 5 minutos: passadas duas horas o
-- corretor já mudou de assunto, e receber o aviso então é ruído — pior ainda em
-- lote, que é o que aconteceria no minuto em que a credencial entrasse.
--
-- Expirar NÃO é perder o fato: a cópia `in_app` do mesmo evento continua no
-- sino, com título, corpo e link, e é ela o registro durável. O que expira é a
-- tentativa de entrega por um canal cuja utilidade tem prazo.
--
-- `sent_at` é o que tira da fila (o worker lê `sent_at is null`); `last_error`
-- conta por que não saiu, para o descarte não virar "sumiu". Mesmo par que a
-- 0065 usou no descarte histórico.
--
-- ponytail: prazo fixo no código. Vira coluna de `automation_settings` no dia em
-- que alguém pedir prazo diferente por canal — não antes.
-- -----------------------------------------------------------------------------
create or replace function public.expire_stale_outbound_notifications(
  p_max_age interval default interval '2 hours'
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  -- `p_max_age::text` renderiza o interval como "02:00:00" — e este texto vai
  -- para o `last_error` que a aba de Integrações mostra E para o corpo do aviso
  -- que o admin lê no sino, do celular. Valor de máquina em cópia pt-BR é a
  -- mesma classe de defeito que `src/lib/format.ts` existe para evitar do lado
  -- da tela; do lado do SQL o equivalente é escrever a duração por extenso,
  -- como o resto deste arquivo já faz com `to_char(... 'DD/MM HH24:MI')`.
  -- Hora inteira vira "2 h"; qualquer outro prazo cai em minutos ("90 min"),
  -- que é exato sem depender de separador decimal.
  v_prazo text := case
    when extract(epoch from p_max_age)::bigint % 3600 = 0
      then (extract(epoch from p_max_age)::bigint / 3600)::text || ' h'
    else (extract(epoch from p_max_age)::bigint / 60)::text || ' min'
  end;
begin
  update public.notifications
     set sent_at    = now(),
         last_error = format(
           'descartada por idade: aviso de %s não entregue em %s (canal %s)',
           to_char(created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
           v_prazo,
           channel
         )
   where channel <> 'in_app'
     and sent_at is null
     and created_at < now() - p_max_age;

  get diagnostics v_count = row_count;

  -- DESCARTE NÃO PODE SER SILENCIOSO.
  --
  -- O corte de idade acima resolve o represamento, mas troca uma silêncio por
  -- outro: antes a fila crescia e ninguém via; agora ela some e ninguém vê. E a
  -- aba Saúde dos jobs continua verde nos dois casos, porque o job de fato roda
  -- — foi exatamente assim que `faceimob-notify-dispatch` passou um mês pausado.
  --
  -- Descarte é o único sinal que prova "o canal não está entregando" sem
  -- depender de ninguém abrir tela nenhuma. Uma linha no sino do admin a cada
  -- 12 h: o job roda a cada minuto, e sem a trava o aviso viraria o problema.
  -- Só admin: o conserto é cadastrar credencial, e não é do diretor nem do
  -- corretor. `user_roles` tem PK (profile_id, role), então `role = 'admin'`
  -- casa no máximo uma vez por pessoa — não precisa de `distinct`.
  if v_count > 0 then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select ur.profile_id,
           'outbound_expired',
           'Avisos descartados sem entrega',
           format(
             '%s mensagem(ns) da fila de saída passaram de %s sem sair e foram descartadas. '
             'O canal não está entregando: confira a credencial em Admin · Integrações. '
             'A cópia de cada aviso continua no sino de quem deveria recebê-lo.',
             v_count, v_prazo
           ),
           '/admin/integrations',
           'in_app'
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id and p.status = 'active'
     where ur.role = 'admin'
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = ur.profile_id
            and n.kind = 'outbound_expired'
            and n.created_at > now() - interval '12 hours'
       );
  end if;

  return v_count;
end;
$$;

comment on function public.expire_stale_outbound_notifications(interval) is
  'Descarta, com o motivo escrito na linha, a mensagem da fila de saída que passou do prazo de utilidade, e avisa o admin no sino quando descarta (uma vez a cada 12 h). Sem isto a fila cresce sem teto e o dia em que a credencial da Cloud API entrar vira um lote de centenas de avisos vencidos. A cópia in_app do mesmo evento continua no sino.';

revoke all on function public.expire_stale_outbound_notifications(interval)
  from public, anon, authenticated;

-- Fila represada hoje: 312 linhas `whatsapp` pendentes na homologação, 268 delas
-- criadas nas últimas horas por reciclagem de lead de demonstração. Aplicar a
-- regra uma vez aqui evita que a primeira execução do cron precise varrer tudo.
select public.expire_stale_outbound_notifications();

-- -----------------------------------------------------------------------------
-- 2b. O gatilho expira antes de decidir se chama o worker
--
-- Aqui, e não dentro do worker, porque o corte de idade é regra de negócio e
-- precisa valer mesmo se o worker estiver fora do ar, sem credencial ou em
-- redeploy — os três estados em que a fila mais cresce. O worker continua
-- lendo `sent_at is null` e nada mais: uma fonte de verdade só.
--
-- Custo: um UPDATE por minuto sobre `notifications_pending_whatsapp_idx`, que
-- converge para zero linha assim que a fila fica dentro do prazo.
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_pending_notifications()
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  -- Antes de qualquer coisa: o que passou do prazo sai da fila com motivo.
  perform public.expire_stale_outbound_notifications();

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_notifications: cadastre functions_url e service_role_key em Integrações.';
    return;
  end if;

  -- Nada a enviar: não gasta requisição HTTP à toa (o job roda a cada minuto).
  -- Quem decide sobre a credencial da Cloud API continua sendo o worker:
  -- `getSecret` lê o cofre E o secret da edge function, e o banco só enxerga o
  -- primeiro — um portão aqui recusaria o token cadastrado pelo caminho normal
  -- de deploy e deixaria a fila parada avisando só por `raise warning`, que não
  -- faz o job falhar e por isso não aparece em `cron_jobs_health()`.
  if not exists (
    select 1 from public.notifications
     where channel = 'whatsapp' and sent_at is null
  ) then
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/notify-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.dispatch_pending_notifications() from public, anon, authenticated;

comment on function public.dispatch_pending_notifications() is
  'Gatilho da edge function notify-dispatch. Expira a fila vencida (0083), só dispara com fila não vazia e deixa a decisão sobre credencial para o worker, que grava o motivo em notifications.last_error.';

-- -----------------------------------------------------------------------------
-- 3. A superfície da fila já existe — e este arquivo a torna verdadeira
--
-- `notification_queue_health()` é da 0082 (frente de SDR/integrações) e a aba
-- de Integrações já a consome. Não se duplica aqui: o que faltava não era a
-- consulta, era a fila parar de crescer. Com o corte de idade acima, o número
-- que aquela tela mostra passa a ser "o que ainda vai sair", e não "tudo o que
-- nunca saiu desde julho".
--
-- Pendência registrada para a frente dona daquele arquivo: a consulta agrupa
-- por `sent_at is null` sem excluir `in_app`, e linha de sino nunca recebe
-- `sent_at` — a aba mostra hoje ~391 "pendentes" de `in_app` que são só o
-- histórico do sino. O recorte correto é `and n.channel <> 'in_app'`.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 4. Job que falha passa a avisar quem pode agir
--
-- `failures_24h` só existe para quem abre a aba de integrações. Um cron parado
-- não faz barulho: o sintoma é lead que não volta para a roleta, dossiê que não
-- sai, presença que não fecha — sempre longe da causa e sempre dias depois.
--
-- Uma linha por job com falha, para admin e diretoria, no máximo uma a cada 6 h
-- por job: o job roda a cada minuto e sem a trava de repetição o sino viraria
-- ele mesmo o problema.
--
-- Diretor entra na lista porque, até aqui, NENHUM dos produtores existentes
-- gravava para o papel `director` — o sino da diretoria lia "Nada por aqui" para
-- sempre, e quem cobra a operação de pé é justamente quem precisa saber que uma
-- automação parou.
--
-- MAS O LINK NÃO É O MESMO PARA OS DOIS, e a primeira versão deste arquivo
-- mandava a diretoria para uma tela que o app recusa duas vezes:
--   (a) `/admin/integrations` exige `menu.admin_integrations`
--       (src/lib/routePermissions.ts) e essa permissão não tem UMA linha em
--       `role_permissions` — só `is_admin()` passa. `RequirePermission`
--       (src/App.tsx) renderiza "Acesso não liberado" para o diretor.
--   (b) mesmo com a permissão concedida, `cron_jobs_health()` tem
--       `where public.is_admin()` no corpo: a aba abriria vazia.
-- Aviso que promete uma tela e entrega "Acesso não liberado" é pior do que
-- aviso nenhum — quem recebe conclui que o sistema está quebrado em dois
-- lugares. Enquanto as duas portas não abrirem, a diretoria recebe o FATO (uma
-- automação parou) sem link e com a próxima ação escrita: falar com o
-- administrador. O admin continua com o link, que para ele funciona.
--
-- Pendência para a frente de permissões, quando a diretoria precisar da aba:
-- conceder `menu.admin_integrations` a `director` E trocar o `where is_admin()`
-- de `cron_jobs_health()` por `has_permission('settings.integrations')`. As duas
-- juntas, nunca uma só — sozinha, cada metade continua entregando tela vazia ou
-- tela recusada.
-- -----------------------------------------------------------------------------
create or replace function public.notify_cron_failures()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('cron.job_run_details') is null then
    return 0;  -- harness sem pg_cron
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dest.profile_id,
         'cron_failure',
         format('Automação com falha: %s', falhas.jobname),
         format('%s execução(ões) do agendador falharam nas últimas 6 h. %s',
                falhas.total,
                case when dest.eh_admin
                     then 'Abra Admin · Integrações · Saúde dos jobs.'
                     else 'Peça ao administrador para abrir Admin · Integrações · Saúde dos jobs.'
                end),
         -- Só quem passa em `is_admin()` abre a tela: ver o bloco de comentário
         -- acima. Para os demais o aviso vai sem destino, e o corpo diz o que
         -- fazer — clique que cai em "Acesso não liberado" não é destino.
         case when dest.eh_admin then '/admin/integrations' end,
         'in_app'
    from (
      select j.jobname, count(*) as total
        from cron.job j
        join cron.job_run_details d on d.jobid = j.jobid
       where j.jobname like 'faceimob-%'
         and d.status <> 'succeeded'
         and d.start_time > now() - interval '6 hours'
       group by j.jobname
    ) falhas
    cross join lateral (
      -- O `group by` NÃO é decoração: papel é acumulável neste projeto
      -- (CONTEXT.md — "a mesma pessoa pode ser diretor, gerente e corretor, e
      -- isso é o caso normal"). Hoje, na homologação, existe um perfil com
      -- {admin,director,manager,broker}: sem agrupar por pessoa ele recebe DUAS
      -- linhas idênticas por job com falha, e o `not exists` abaixo não enxerga
      -- a irmã inserida no mesmo comando. Sino que duplica é sino que ninguém lê.
      --
      -- `bool_or` no mesmo passo responde a segunda pergunta — esta pessoa abre
      -- a tela? — sem uma segunda varredura de `user_roles`. `is_admin()` é
      -- `has_role('admin')`, então o papel aqui é exatamente o que a tela exige.
      select ur.profile_id,
             bool_or(ur.role = 'admin') as eh_admin
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role in ('admin', 'director')
       group by ur.profile_id
    ) dest
   where not exists (
     select 1 from public.notifications n
      where n.profile_id = dest.profile_id
        and n.kind = 'cron_failure'
        and n.title = format('Automação com falha: %s', falhas.jobname)
        and n.created_at > now() - interval '6 hours'
   );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notify_cron_failures is
  'Avisa admin e diretoria quando um job faceimob-* falha. Produtor do kind cron_failure e o primeiro que alcança o papel director — até a 0083 o sino da diretoria não tinha nenhum produtor. O link para Admin · Integrações só acompanha o aviso do admin: a aba exige is_admin() na rota e dentro de cron_jobs_health(), e a diretoria receberia "Acesso não liberado".';

revoke all on function public.notify_cron_failures() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Atividade vencida avisa o dono: produtor de `task_due`
--
-- O kind existe em `seeds/050` e `seeds/060` desde sempre e nunca teve produtor:
-- a tela de Atividades mostra a tarefa vencida, e quem não abre a tela não
-- descobre. Um aviso por tarefa (a trava é a própria existência da linha
-- anterior), com link para a tela.
--
-- É também o primeiro produtor que alcança `sdr` e `partner`: o destinatário é
-- quem tem a tarefa, seja qual for o papel.
--
-- O LINK, PORÉM, NÃO ALCANÇA TODO MUNDO. `/atividades` exige `menu.atividades`
-- (src/lib/routePermissions.ts) e, medido no remoto, essa permissão existe para
-- director, manager, broker e partner — `sdr`, `marketing` e `cca` não têm
-- linha nenhuma em `role_permissions`, então `can()` é falso e o clique cai em
-- "Acesso não liberado". Hoje é latente (só há tarefa atribuída a admin e
-- corretor), mas o defeito está no produtor, não no dado: basta alguém atribuir
-- uma atividade a um SDR.
--
-- Por isso o link é condicionado à permissão do DESTINATÁRIO, do mesmo jeito e
-- pelo mesmo motivo que o aviso de cron acima. Quem não abre a tela recebe o
-- fato e o que fazer, sem um clique que morre.
--
-- Pendência para a frente de permissões: conceder `menu.atividades` a `sdr`,
-- `marketing` e `cca` — é menu, não poder de escrita, e quem recebe atividade
-- atribuída precisa da tela de qualquer jeito. Feito isso, este `case` passa a
-- devolver o link para eles sozinho, sem migration nova.
-- -----------------------------------------------------------------------------
create or replace function public.notify_due_tasks()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select t.assigned_to,
         'task_due',
         format('Atividade vencida: %s', t.title),
         format('Vencia em %s e continua em aberto.%s',
                to_char(t.due_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
                case when acesso.abre then ''
                     else ' Seu perfil ainda não abre a tela de Atividades: peça acesso ao administrador.'
                end),
         case when acesso.abre then '/atividades' end,
         'in_app'
    from public.tasks t
    join public.profiles p on p.id = t.assigned_to and p.status = 'active'
    -- Mesma regra que `has_permission()` aplica ao usuário logado, só que sobre
    -- o destinatário: admin passa por cima, os demais precisam da linha em
    -- `role_permissions` com `allowed`. Ler daqui (e não fixar a lista de
    -- papéis) é o que faz o link voltar sozinho no dia em que a permissão for
    -- concedida — sem migration nova.
    cross join lateral (
      select exists (
        select 1
          from public.user_roles ur
         where ur.profile_id = t.assigned_to
           and (
             ur.role = 'admin'
             or exists (
               select 1 from public.role_permissions rp
                where rp.role = ur.role
                  and rp.permission = 'menu.atividades'
                  and rp.allowed
             )
           )
      ) as abre
    ) acesso
   where t.status = 'open'
     and t.assigned_to is not null
     and t.due_at is not null
     and t.due_at < now()
     -- Tarefa vencida há mais de uma semana não é novidade para ninguém; avisar
     -- sobre ela na primeira execução encheria o sino de histórico.
     and t.due_at > now() - interval '7 days'
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = t.assigned_to
          and n.kind = 'task_due'
          and n.title = format('Atividade vencida: %s', t.title)
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notify_due_tasks is
  'Avisa o dono de uma atividade em aberto que passou do prazo. Produtor do kind task_due, que existia só em dado de seed, e o primeiro que alcança sdr e partner. O link para /atividades só acompanha o aviso de quem tem menu.atividades — sdr, marketing e cca ainda não têm, e receberiam "Acesso não liberado".';

revoke all on function public.notify_due_tasks() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Mensagem de WhatsApp que não vira conversa deixa de sumir
--
-- O `whatsapp-inbound-webhook` tem três saídas e a terceira é `continue`:
-- mensagem que não é de lead com conversa SDR ativa nem de contato de
-- remarketing recebe ACK 200 e desaparece. O mesmo `continue` engole a mensagem
-- quando o turno do agente falha (OpenAI fora do ar), porque `sdrAgent.ts` só
-- grava as duas linhas DEPOIS de a resposta existir — decisão correta lá, que
-- deixa este buraco aqui.
--
-- Registrar em TODO caminho de saída do webhook — inclusive nos dois que antes
-- terminavam em `continue` — resolve os dois de uma vez: a mensagem do cliente
-- não se perde, e o que ninguém soube rotear fica visível.
--
-- Em todo caminho de SAÍDA, e não antes de rotear, porque o desfecho é o que
-- decide se alguém precisa ser avisado: gravar tudo como "sem destino" na
-- entrada mandaria um aviso ao SDR por mensagem que o robô atendeu sozinho. O
-- caso que sobra — a function morrer no meio do turno — se resolve sozinho: sem
-- o 200, a Meta reenvia a mensagem e ela passa de novo por aqui.
--
-- `provider_message_id` único é a idempotência do log: replay da Meta não
-- duplica linha, e o `on conflict do nothing` do webhook depende disso.
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_inbound_messages (
  id                  uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  from_phone          text not null,
  body                text,
  lead_id             uuid references public.leads(id) on delete set null,
  conversation_id     uuid references public.sdr_conversations(id) on delete set null,
  outcome             text not null default 'unmatched',
  detail              text,
  handled_at          timestamptz,
  handled_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint whatsapp_inbound_outcome_check check (
    outcome in ('sdr_turn', 'remarketing_lead', 'unmatched', 'agent_error')
  )
);

comment on table public.whatsapp_inbound_messages is
  'Registro bruto de toda mensagem recebida pelo webhook da Cloud API, gravado ANTES do roteamento. Existe porque mensagem fora do escopo do robô — e mensagem cujo turno do agente falhou — sumia com ACK 200 para a Meta.';

comment on column public.whatsapp_inbound_messages.outcome is
  'sdr_turn = virou turno de conversa; remarketing_lead = virou lead; unmatched = ninguém soube rotear; agent_error = casou com conversa mas o turno falhou.';

create index if not exists whatsapp_inbound_pendentes_idx
  on public.whatsapp_inbound_messages (created_at desc)
  where handled_at is null and outcome in ('unmatched', 'agent_error');

alter table public.whatsapp_inbound_messages enable row level security;

-- O corpo é a mensagem do cliente: dado pessoal. Quem lê é quem trata — SDR,
-- gestão e admin. Ninguém escreve pelo cliente: quem insere é o webhook, com
-- service role, que não passa por RLS. A única escrita pela tela é marcar
-- tratada, e por isso o UPDATE existe sem INSERT correspondente.
drop policy if exists whatsapp_inbound_select on public.whatsapp_inbound_messages;
create policy whatsapp_inbound_select on public.whatsapp_inbound_messages
  for select to authenticated
  using (public.has_any_role('admin', 'director', 'manager', 'sdr'));

drop policy if exists whatsapp_inbound_update on public.whatsapp_inbound_messages;
create policy whatsapp_inbound_update on public.whatsapp_inbound_messages
  for update to authenticated
  using      (public.has_any_role('admin', 'director', 'manager', 'sdr'))
  with check (public.has_any_role('admin', 'director', 'manager', 'sdr'));

-- O Supabase concede `arwdDxtm` a `anon` E a `authenticated` por default
-- privileges (medido em `pg_default_acl` deste projeto) em toda tabela nova de
-- `public`. A RLS acima já barraria o anônimo e já barra INSERT/DELETE (não há
-- policy para eles), mas mensagem de cliente não depende de UMA camada: o grant
-- é recortado explicitamente, e as duas precisam concordar para a escrita
-- passar.
--
-- O UPDATE vai por COLUNA. A decisão registrada acima é "a única escrita pela
-- tela é marcar tratada"; um `grant update` de linha inteira permitiria a um
-- sdr/gerente/diretor reescrever `body`, `from_phone`, `outcome` e
-- `provider_message_id` — isto é, editar a mensagem do cliente — e apontar
-- `handled_by` para qualquer perfil. A policy não separa coluna; o grant separa.
revoke all on public.whatsapp_inbound_messages from anon, authenticated;
grant select on public.whatsapp_inbound_messages to authenticated;
grant update (handled_at, handled_by) on public.whatsapp_inbound_messages to authenticated;

-- Aviso ao SDR, no sino, quando ninguém soube rotear. Um por telefone a cada
-- 6 h: um cliente insistente não pode virar 20 linhas no sino de cada analista.
--
-- Sem link: não existe tela de caixa de entrada de WhatsApp, e apontar para uma
-- rota inexistente seria mentir no clique. Mas link nulo, sozinho, deixa o SDR
-- num beco: no sino a linha continua sendo um `<button>` com hover
-- (src/components/NotificationBell.tsx) que só marca como lida. Por isso o
-- CORPO carrega a saída — responder pelo aparelho — e diz, sem rodeio, que a
-- caixa de entrada ainda não existe no sistema. Aviso que parece uma tela que
-- sumiu é pior do que aviso que assume o que não tem.
--
-- Pendência aberta, e é a maior desta frente: `whatsapp_inbound_messages` tem
-- corpo, `handled_at`, `handled_by`, índice de pendentes e policy de UPDATE —
-- o contrato inteiro de uma caixa de entrada — e NENHUMA tela lê a tabela. A
-- lista mínima é uma aba em `/sdr` com
-- `handled_at is null and outcome in ('unmatched','agent_error')`, colunas
-- telefone/mensagem/quando e um botão "Tratada" que escreve `handled_at` e
-- `handled_by` (o grant por coluna acima é exatamente esse recorte). Enquanto
-- ela não existir, o telefone dentro do corpo é a única saída para o humano.
create or replace function public.notify_whatsapp_unmatched()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.outcome not in ('unmatched', 'agent_error') then
    return null;
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  -- `distinct on (p.id)` pelo mesmo motivo do `notify_cron_failures`: quem é sdr
  -- E admin casaria duas vezes no `in ('sdr','admin')` e receberia o aviso em
  -- dobro. `distinct on` e não `distinct`: as outras colunas são literais sem
  -- tipo declarado (`null`, `'in_app'`), e desduplicar por uuid não depende de
  -- como o planejador resolveria o tipo delas.
  select distinct on (p.id)
         p.id,
         'whatsapp_unmatched',
         'Mensagem de WhatsApp sem destino',
         format('%s escreveu para o número da empresa e a mensagem não casou com nenhum lead nem lista de remarketing%s. '
                'Responda pelo aparelho: ainda não há caixa de entrada de WhatsApp no sistema.',
                new.from_phone,
                case when new.outcome = 'agent_error' then ' (o agente de IA falhou ao responder)' else '' end),
         null,
         'in_app'
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where ur.role in ('sdr', 'admin')
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = p.id
          and n.kind = 'whatsapp_unmatched'
          and n.body like new.from_phone || '%'
          and n.created_at > now() - interval '6 hours'
     );

  return null;
end;
$$;

revoke all on function public.notify_whatsapp_unmatched() from public, anon, authenticated;

drop trigger if exists notify_whatsapp_unmatched on public.whatsapp_inbound_messages;
create trigger notify_whatsapp_unmatched
  after insert on public.whatsapp_inbound_messages
  for each row execute function public.notify_whatsapp_unmatched();

comment on function public.notify_whatsapp_unmatched is
  'Avisa SDR e admin quando o webhook recebe mensagem que não soube rotear. Produtor do kind whatsapp_unmatched; até a 0083 o papel sdr não tinha nenhum produtor de notificação.';

-- -----------------------------------------------------------------------------
-- 7. Dossiê que desistiu avisa quem pediu o envio
--
-- `submission-dispatch` para de tentar em 5 falhas e escreve `last_error` na
-- linha. A única superfície dessa linha é o diálogo dentro de /cca: o dossiê
-- morre calado, e quem apertou "Enviar à construtora" continua achando que
-- saiu. O aviso vai para quem pediu e para o admin, que é quem pode consertar
-- a credencial.
-- -----------------------------------------------------------------------------
create or replace function public.notify_submission_gave_up()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if new.status <> 'failed' or new.attempts < 5 or coalesce(old.attempts, 0) >= 5 then
    return null;
  end if;

  select d.code into v_code from public.deals d where d.id = new.deal_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dest.profile_id,
         'submission_failed',
         format('Dossiê não saiu: %s', coalesce(v_code, 'negócio sem código')),
         format('Cinco tentativas de envio à construtora falharam. Último motivo: %s',
                coalesce(left(new.last_error, 200), 'não registrado')),
         '/cca',
         'in_app'
    from (
      -- O cast é necessário: em `UNION`, o ramo sem FROM entra como parâmetro
      -- de tipo desconhecido e o planejador não tem de onde deduzi-lo.
      select (new.requested_by)::uuid as profile_id where new.requested_by is not null
      union
      select ur.profile_id from public.user_roles ur where ur.role = 'admin'
    ) dest
   where exists (select 1 from public.profiles p where p.id = dest.profile_id and p.status = 'active');

  return null;
end;
$$;

revoke all on function public.notify_submission_gave_up() from public, anon, authenticated;

drop trigger if exists notify_submission_gave_up on public.developer_submissions;
create trigger notify_submission_gave_up
  after update of status, attempts on public.developer_submissions
  for each row execute function public.notify_submission_gave_up();

comment on function public.notify_submission_gave_up is
  'Avisa quem pediu o envio, e o admin, quando um dossiê estoura o teto de 5 tentativas. Sem isto o dossiê morria calado dentro de /cca.';

-- -----------------------------------------------------------------------------
-- 8. Agendamento dos dois produtores novos
--
-- Mesmo padrão defensivo da 0013/0062: estado conhecido antes de criar, e falha
-- de agendamento vira `raise warning` em vez de derrubar a migration (o harness
-- local é postgres puro).
--
--  - falha de cron: de hora em hora. A trava de 6 h por job é quem evita
--    repetição; a cadência só precisa ser menor que ela.
--  - atividade vencida: 07:40 e 13:40. Prazo de tarefa é assunto de expediente,
--    e um aviso de madrugada chega quando ninguém pode agir.
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0083] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-cron-failure-alert') then
      perform cron.unschedule('faceimob-cron-failure-alert');
    end if;
    perform cron.schedule(
      'faceimob-cron-failure-alert',
      '15 * * * *',
      $cmd$select public.notify_cron_failures();$cmd$
    );
    raise notice '[0083] aviso de job com falha agendado de hora em hora.';
  exception when others then
    raise warning '[0083] não foi possível agendar o aviso de falha de cron: %', sqlerrm;
  end;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-task-due') then
      perform cron.unschedule('faceimob-task-due');
    end if;
    perform cron.schedule(
      'faceimob-task-due',
      '40 7,13 * * *',
      $cmd$select public.notify_due_tasks();$cmd$
    );
    raise notice '[0083] aviso de atividade vencida agendado para 07:40 e 13:40.';
  exception when others then
    raise warning '[0083] não foi possível agendar o aviso de atividade vencida: %', sqlerrm;
  end;
end
$do$;
