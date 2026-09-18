-- =============================================================================
-- 0155 · Coluna da CCA avisa ou não o comercial; e-mail do movimento pela Brevo
--
-- Pedido do cliente de 18/09/2026:
--   "Ter uma opção de: notificar comercial sim ou não; alterar status sim ou
--   não; se sim, qual status pertence esse estágio." Uma etapa intermediária só
--   de controle da CCA não avisa o comercial (movimento interno).
--   "Queremos manter os e-mails de movimento como temos no Bubble, através da
--   Brevo." Aprovado na CCA = aviso e e-mail.
--
-- O que muda:
--   1. `cca_stages.notify_sales` (padrão true: toda coluna existente continua
--      avisando, como hoje). Coluna com false é movimento interno:
--      `move_cca_case` não cria aviso nem e-mail. A mensagem continua
--      obrigatória e continua indo para o histórico do negócio, sempre.
--   2. "Alterar status" é `deal_status_id` preenchido (0150). Até aqui, coluna
--      sem Status 2 caía no de-para antigo por desfecho quando o desfecho
--      mudava: mover para uma coluna "Enviado à agência" sem ligação gravava
--      "ANÁLISE EXTERNA". Pela ação "Mover" (`faceimob.cca_move`), coluna sem
--      Status 2 agora não toca o Status 2 — é o "não" que o cliente pediu. Os
--      fluxos do sistema (entrada na esteira, reentrada externa, update do
--      sistema sem a RPC) seguem o de-para como antes. A devolução ao corretor
--      por coluna de pendência (0077) também segue: ela não é Status 2, é o
--      dossiê voltando para ele.
--      Alcance em dados reais (homologação, 18/09/2026): das 19 colunas ativas,
--      18 estão ligadas a um Status 2 e seguem iguais. A única sem ligação é a
--      "RETORNO ESTEIRA  ÁGIL" que o cliente criou (repetida, 0 casos): passa a
--      "não muda o status", que é o que a tela de estágios mostra para ela.
--   3. E-mail do movimento. Sempre que `move_cca_case` cria o aviso, enfileira
--      um e-mail para os MESMOS destinatários (corretor e gerente do negócio)
--      em `cca_move_emails`, entregue pela edge `cca-email-dispatch` pela
--      Brevo. DESLIGADO por padrão: `automation_settings.cca_move_email`, que
--      o admin liga em Admin → Integrações. Desligado, nada é enfileirado, e o
--      cron descarta (`expired`) o que ainda estava na fila — não há fila velha
--      para disparar quando ligar de novo ou quando a credencial da Brevo
--      chegar. E-mail vazio, inválido ou o marcador `@sem-email.local` (0002) é
--      pulado sem quebrar o movimento.
--
-- O interruptor mora em `automation_settings`, o singleton dos avisos globais
-- (`notify_on_assign`, `notify_on_timeout`): leitura para todo logado, escrita
-- só `is_admin()` (0004). Não é segredo, então não vai para o cofre.
--
-- Compatível com o front de antes: coluna nova com padrão, `move_cca_case` com
-- a mesma assinatura. O front novo LÊ `cca_stages.notify_sales`: aplicar esta
-- migration antes de publicar o front (sem ela o quadro da CCA recebe 42703).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A coluna avisa ou não o comercial
-- -----------------------------------------------------------------------------
alter table public.cca_stages
  add column if not exists notify_sales boolean not null default true;

comment on column public.cca_stages.notify_sales is
  'Mover para esta coluna avisa o corretor e o gerente do negócio (sino, push e, com o interruptor ligado, e-mail). false = movimento interno da CCA: só o histórico do negócio registra (0155).';

-- -----------------------------------------------------------------------------
-- 2. Interruptor global do e-mail, desligado
-- -----------------------------------------------------------------------------
alter table public.automation_settings
  add column if not exists cca_move_email boolean not null default false;

comment on column public.automation_settings.cca_move_email is
  'Enfileira e-mail (Brevo) para corretor e gerente a cada movimento da CCA que avisa o comercial. Desligado: nada é enfileirado (0155).';

-- -----------------------------------------------------------------------------
-- 3. A fila
--
-- Mesmo desenho de `developer_submissions`: status, tentativas e último erro na
-- linha. O conteúdo vai em campos, não em HTML pronto: o formato do Bubble
-- ainda não chegou, e o assunto e o corpo são montados num lugar só
-- (`supabase/functions/cca-email-dispatch/email.ts`) — trocar o texto é
-- redeploy da edge, sem migration, e vale também para o que já está na fila.
-- -----------------------------------------------------------------------------
create table if not exists public.cca_move_emails (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  to_email    text not null
              constraint cca_move_emails_to_email_format check (to_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  deal_code   text,
  client_name text,
  stage_name  text not null,
  actor_name  text,
  message     text not null,
  status      text not null default 'queued'
              constraint cca_move_emails_status_check
              check (status in ('queued', 'sending', 'sent', 'failed', 'expired')),
  attempts    integer not null default 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.cca_move_emails is
  'Fila do e-mail de movimento da CCA (0155). Entra só por move_cca_case com o interruptor ligado; sai pela edge cca-email-dispatch. Só service_role escreve; só admin lê.';

-- O cron pergunta "há pendência?" a cada minuto sobre uma tabela que só cresce.
create index if not exists cca_move_emails_pending_idx
  on public.cca_move_emails (created_at)
  where status in ('queued', 'sending', 'failed');

drop trigger if exists cca_move_emails_set_updated_at on public.cca_move_emails;
create trigger cca_move_emails_set_updated_at
  before update on public.cca_move_emails
  for each row execute function public.set_updated_at();

-- Endereço e mensagem de corretor: só admin lê pela API; ninguém escreve por ela.
alter table public.cca_move_emails enable row level security;

drop policy if exists cca_move_emails_admin_select on public.cca_move_emails;
create policy cca_move_emails_admin_select on public.cca_move_emails
  for select to authenticated
  using ((select public.is_admin()));

revoke all on public.cca_move_emails from public, anon, authenticated;
grant select on public.cca_move_emails to authenticated;
grant select, insert, update, delete on public.cca_move_emails to service_role;

-- -----------------------------------------------------------------------------
-- 4. Pela ação "Mover", coluna sem Status 2 não muda o Status 2
--
-- Corpo da 0150 (§6) com uma regra a mais, `v_mover_sem_status`: mudou de
-- coluna dentro de `move_cca_case` e a coluna não tem Status 2 → nenhum
-- rótulo, nem o do de-para por desfecho. O resto é idêntico.
-- -----------------------------------------------------------------------------
create or replace function public.cca_cases_sync_esteira_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entrada boolean := tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at;
  v_label   text;
  v_deal    public.deals;
  v_reason  text;
  v_mover_sem_status boolean := false;
begin
  if not v_entrada
     and new.status is not distinct from old.status
     and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  if v_entrada and new.status = 'under_review' then
    select case d.review_esteira
             when 'virar' then '15. ANÁLISE P/ VIRAR NEGÓCIO'
             else '13. ESTEIRA AGIL'
           end
      into v_label
      from public.deals d
     where d.id = new.deal_id;
  elsif not v_entrada and new.stage_id is distinct from old.stage_id then
    -- `not v_entrada`: a reentrada externa cai em EM ANÁLISE quando não há
    -- coluna da construtora, e o rótulo tem de ser o do fluxo (regra c), não
    -- o Status 2 da coluna.
    select ds.value into v_label
      from public.cca_stages s
      join public.deal_statuses ds on ds.id = s.deal_status_id
     where s.id = new.stage_id;
    -- 0155: "Muda o status do negócio: não" na tela = coluna sem Status 2.
    -- `coalesce`: sem `move_cca_case` na sessão a configuração não existe e
    -- `current_setting` devolve NULL — e um NULL aqui calaria o de-para dos
    -- fluxos do sistema (envio à construtora externa).
    v_mover_sem_status := v_label is null
                          and coalesce(current_setting('faceimob.cca_move', true), '') = 'on';
  end if;

  if v_label is null and not v_mover_sem_status
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    v_label := case new.status
      when 'under_review'      then '13. ESTEIRA AGIL'
      when 'pending_documents' then 'RET. ESTEIRA AGIL'
      when 'approved'          then '09. APROV. TOTAL'
      when 'sent_to_developer' then 'ANÁLISE EXTERNA'
      when 'sent_to_agency'    then 'ANÁLISE EXTERNA'
      else null
    end;
  end if;

  if v_label is not null then
    update public.deals
       set status_detail = v_label
     where id = new.deal_id
       and status_detail is distinct from v_label
       and public.deal_status_bare(status_detail) not in ('DISTRATO', 'QUEDA', 'OFF')
       and outcome not in ('lost', 'cancelled')
       and (public.is_admin()
            or not exists (select 1 from public.closed_months cm where cm.period = deals.month_base));
  end if;

  -- Entrar numa coluna de pendência também devolve, não só mudar o status:
  -- PENDENTE → RETORNO À ESTEIRA ÁGIL segue `pending_documents`, e os casos
  -- importados estão em pendência com a conferência aprovada (1.273 de 1.443 na
  -- homologação, 15/09) — sem reabrir, o corretor não reenvia por esteira nenhuma.
  if new.status = 'pending_documents'
     and (tg_op = 'INSERT'
          or old.status is distinct from new.status
          or old.stage_id is distinct from new.stage_id) then
    select * into v_deal from public.deals where id = new.deal_id for update;

    if found and v_deal.document_review_status = 'approved' then
      v_reason := 'Devolvido pela análise de crédito: '
                  || coalesce(nullif(btrim(new.decision_notes), ''), 'documentação pendente.');

      update public.deals
         set document_review_status   = 'returned',
             document_reviewed_at     = now(),
             document_reviewed_by     = auth.uid(),
             document_review_reason   = left(v_reason, 2000)
       where id = new.deal_id;

      insert into public.deal_history
        (deal_id, actor_id, kind, from_value, to_value, detail)
      values
        (new.deal_id, auth.uid(), 'document_review_returned', 'approved', 'returned',
         jsonb_build_object('reason', left(v_reason, 2000), 'source', 'cca'));

      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select distinct dp.profile_id,
             'document_review_returned',
             'CCA devolveu o dossiê: ' || v_deal.code,
             left(v_reason, 2000),
             '/pipeline',
             'in_app'::notification_channel
      from public.deal_participants dp
      where dp.deal_id = new.deal_id and dp.role = 'broker';
    end if;
  end if;

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Mover: avisa (e enfileira o e-mail) só quando a coluna avisa o comercial
--
-- Corpo da 0150 (§12). Mudam só o `if v_stage.notify_sales` em volta do aviso
-- e o e-mail, que sai dos MESMOS destinatários do aviso (`returning`): quem o
-- dedupe da devolução pulou também não recebe e-mail.
-- -----------------------------------------------------------------------------
create or replace function public.move_cca_case(p_case_id uuid, p_stage_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case      public.cca_cases;
  v_stage     public.cca_stages;
  v_message   text := btrim(coalesce(p_message, ''));
  v_code      text;
  v_ator_nome text;
  v_cliente   text;
  v_email     boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not public.has_permission('cca.review') then
    raise exception 'Seu perfil não move casos na esteira do CCA.' using errcode = '42501';
  end if;

  if v_message = '' then
    raise exception 'Escreva a mensagem da movimentação: ela fica registrada no negócio e avisa a equipe.'
      using errcode = 'P0001';
  end if;

  if length(v_message) > 4000 then
    raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_stage from public.cca_stages where id = p_stage_id and active;
  if not found then
    raise exception 'Coluna da esteira não encontrada ou desativada.' using errcode = 'P0001';
  end if;

  select * into v_case from public.cca_cases where id = p_case_id for update;
  if not found then
    raise exception 'Caso não encontrado.' using errcode = 'P0002';
  end if;

  perform set_config('faceimob.cca_move', 'on', true);

  update public.cca_cases
     set stage_id       = v_stage.id,
         status         = v_stage.status,
         decision_notes = v_message,
         -- Entre colunas do mesmo desfecho a data da decisão é a original.
         decided_at     = case
                            when v_stage.status not in ('approved', 'rejected') then null
                            when v_stage.status = v_case.status then coalesce(v_case.decided_at, now())
                            else now()
                          end
   where id = p_case_id;

  perform set_config('faceimob.cca_move', '', true);

  select d.code into v_code from public.deals d where d.id = v_case.deal_id;
  select p.full_name into v_ator_nome from public.profiles p where p.id = auth.uid();

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (v_case.deal_id, auth.uid(), 'comment',
          'STATUS: ' || v_stage.name || ' — ' || v_message);

  -- Movimento interno (0155): fica só no histórico acima.
  if v_stage.notify_sales then
    select s.cca_move_email into v_email from public.automation_settings s where s.id;
    select c.full_name into v_cliente
      from public.deal_clients c where c.deal_id = v_case.deal_id and c.ordinal = 1;

    with avisados as (
      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select dp.profile_id,
             'cca_status_changed',
             format('Crédito %s: %s', coalesce(v_code, 'negócio sem código'), v_stage.name),
             left(format('%s moveu para "%s": %s',
                         coalesce(v_ator_nome, 'Alguém'), v_stage.name, v_message), 2000),
             '/pipeline',
             'in_app'
        from (
          select distinct dp0.profile_id
            from public.deal_participants dp0
           where dp0.deal_id = v_case.deal_id and dp0.role in ('broker', 'manager')
        ) dp
        join public.profiles p on p.id = dp.profile_id and p.status = 'active'
       where dp.profile_id <> auth.uid()
         and not exists (
           select 1 from public.notifications n
            where n.profile_id = dp.profile_id
              and n.kind = 'document_review_returned'
              and n.title = 'CCA devolveu o dossiê: ' || v_code
              and n.created_at >= now()
         )
      returning profile_id
    )
    insert into public.cca_move_emails
      (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message)
    select v_case.deal_id, p.id, btrim(p.email::text), v_code, v_cliente, v_stage.name, v_ator_nome, v_message
      from avisados a
      join public.profiles p on p.id = a.profile_id
     where coalesce(v_email, false)
       -- Mesma regra do CHECK da fila; o marcador da 0002 não é caixa de ninguém.
       and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
       and p.email::text !~* '@sem-email\.local$';
  end if;

  return jsonb_build_object(
    'case_id', v_case.id,
    'deal_id', v_case.deal_id,
    'stage_id', v_stage.id,
    'status', v_stage.status);
end;
$$;

comment on function public.move_cca_case(uuid, uuid, text) is
  'Move o caso para uma coluna ativa da CCA com mensagem obrigatória: grava status e Status 2 (pela coluna), comentário no negócio e, se a coluna avisa o comercial, avisa corretor e gerente e enfileira o e-mail com o interruptor ligado. Única porta para mudar status/coluna com o token do usuário (0150, 0155).';

revoke all on function public.move_cca_case(uuid, uuid, text) from public, anon;
grant execute on function public.move_cca_case(uuid, uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Acionar a edge: o cron de minuto em minuto
--
-- Mesmo padrão de `dispatch_pending_submissions` (0065): URL e chave do cofre,
-- nenhuma requisição sem pendência, e o recorte de pendência é o MESMO da
-- consulta da edge (10 min de repesca, 5 tentativas) — mudou um, muda o outro.
--
-- Aviso de movimento velho não serve: o que não saiu em 24 h vira `expired`
-- aqui, e não no worker, para valer também com a edge fora do ar ou sem
-- credencial — os estados em que a fila cresce. Quem esgotou as tentativas fica
-- `failed`, com o motivo. Interruptor desligado também descarta o pendente:
-- ligar sem credencial e desligar deixaria a fila repescando até a credencial
-- chegar, e aí sairia tudo de uma vez, fora de hora. Só o cron aciona a edge,
-- então parar aqui para o worker também.
-- ponytail: prazo fixo de 24 h; virar ajuste quando a operação pedir outro.
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_pending_cca_emails()
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  update public.cca_move_emails
     set status = 'expired',
         last_error = 'Não saiu em 24 h: descartado para não chegar fora de hora.'
   where status in ('queued', 'sending', 'failed')
     and attempts < 5
     and created_at < now() - interval '24 hours';

  if not coalesce((select s.cca_move_email from public.automation_settings s where s.id), false) then
    update public.cca_move_emails
       set status = 'expired',
           last_error = 'Envio desligado em Admin → Integrações: descartado.'
     where status in ('queued', 'sending', 'failed')
       and attempts < 5;
    return;
  end if;

  if not exists (
    select 1 from public.cca_move_emails e
     where e.attempts < 5
       and (e.status = 'queued'
            or (e.status in ('failed', 'sending') and e.updated_at < now() - interval '10 minutes'))
  ) then
    return;
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_cca_emails: cadastre functions_url e service_role_key em Integrações.';
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/cca-email-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end;
$$;

comment on function public.dispatch_pending_cca_emails() is
  'Cron faceimob-cca-email-dispatch: expira o e-mail de movimento com mais de 24 h (ou todo o pendente, com o interruptor desligado) e aciona a edge cca-email-dispatch só quando há pendência (0155).';

revoke all on function public.dispatch_pending_cca_emails() from public, anon, authenticated;
grant execute on function public.dispatch_pending_cca_emails() to service_role;

-- Padrão da 0083/0143: falha de agendamento vira aviso.
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0155] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-cca-email-dispatch') then
      perform cron.unschedule('faceimob-cca-email-dispatch');
    end if;
    perform cron.schedule(
      'faceimob-cca-email-dispatch',
      '* * * * *',
      $cmd$select public.dispatch_pending_cca_emails();$cmd$
    );
    raise notice '[0155] e-mail de movimento da CCA agendado de minuto em minuto.';
  exception when others then
    raise warning '[0155] não foi possível agendar o e-mail de movimento da CCA: %', sqlerrm;
  end;
end
$do$;
