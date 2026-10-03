-- =============================================================================
-- 0206 — cópia dos e-mails de movimento: admin em tudo, sócios na venda
--
-- Pedido do cliente em 03/10/2026: "eu, admin, quero ser copiado em tudo para
-- ver a movimentação da empresa; os sócios, somente movimentos de venda e
-- pós-venda de todos".
--
-- Antes, a fila `cca_move_emails` só tinha os participantes do negócio (e, na
-- conferência, admin e sócio). Agora um gatilho único na fila copia cada aviso:
--   · para todo ADMIN ativo, sempre (Pipeline, CCA e conferência);
--   · para todo SÓCIO ativo, só quando o negócio está em venda (fechado ou
--     Status 1 VENDA), em distrato, ou acabou de sair da VENDA (queda).
-- Um e-mail por endereço e por aviso; quem fez a ação não recebe a cópia.
-- A cópia segue o interruptor da origem, como o original.
--
-- ponytail: a cópia nasce de um aviso enfileirado; movimento sem nenhum
-- participante com e-mail não gera cópia. Evoluir quando houver negócio sem
-- corretor e gerente com e-mail.
-- =============================================================================

alter table public.cca_move_emails add column if not exists copia boolean not null default false;
comment on column public.cca_move_emails.copia is
  'Cópia do aviso para admin ou sócio (0206), não o aviso ao participante.';

-- Saída da VENDA: o gatilho do Pipeline avisa, nesta transação, que o Status 1
-- anterior era VENDA. É o único caso em que o estado atual do negócio não basta.
create or replace function public.deals_queue_status_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_message text;
  v_actor text;
  v_client text;
  v_status1 text;
  v_status2 text;
begin
  if new.status_group_id is not distinct from old.status_group_id
     and new.status_detail is not distinct from old.status_detail then return null; end if;
  -- A ação da CCA já possui aviso/e-mail e respeita "Avisar o comercial".
  if coalesce(current_setting('faceimob.cca_move', true), '') = 'on' then return null; end if;
  if not coalesce((select pipeline_move_email from public.automation_settings where id), false) then return null; end if;
  -- 0206: a cópia dos sócios vale para a queda de uma venda.
  perform set_config('faceimob.saiu_da_venda',
    case when exists (select 1 from public.deal_status_groups g where g.id = old.status_group_id and g.code = 'VENDA')
         then 'on' else '' end, true);
  select full_name into v_actor from public.profiles where id = auth.uid();
  select full_name into v_client from public.deal_clients where deal_id = new.id and ordinal = 1;
  select label into v_status1 from public.deal_status_groups where id = new.status_group_id;
  select label into v_status2 from public.deal_statuses where value = new.status_detail;
  v_status2 := coalesce(v_status2, public.deal_status_bare(new.status_detail), 'Sem Status 2');
  v_message := concat_ws(E'\n',
    case when new.status_group_id is distinct from old.status_group_id then
      'Status 1: ' || coalesce((select label from public.deal_status_groups where id = old.status_group_id), 'Sem Status 1')
        || ' → ' || coalesce(v_status1, 'Sem Status 1') end,
    case when new.status_detail is distinct from old.status_detail then
      'Status 2: ' || coalesce(public.deal_status_bare(old.status_detail), 'Sem Status 2') || ' → ' || v_status2 end);
  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text))) new.id, p.id, btrim(p.email::text),
    new.code, v_client, concat_ws(' · ', v_status1, v_status2), coalesce(v_actor, 'Sistema'), v_message, 'pipeline',
    public.email_detalhes_do_negocio(new.id) || jsonb_strip_nulls(jsonb_build_object(
      'status2_antes', case when new.status_detail is distinct from old.status_detail
                            then coalesce((select label from public.deal_statuses where value = old.status_detail),
                                          public.deal_status_bare(old.status_detail)) end,
      'observacao', nullif(btrim(coalesce(current_setting('faceimob.status_note', true), '')), '')))
  from public.deal_participants dp join public.profiles p on p.id = dp.profile_id
  where dp.deal_id = new.id and dp.role in ('broker', 'manager', 'director')
    and p.status = 'active'
    and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    and p.email::text !~* '@sem-email\.local$'
  order by lower(btrim(p.email::text)), p.id;
  perform set_config('faceimob.saiu_da_venda', '', true);
  return null;
end;
$$;

revoke all on function public.deals_queue_status_email() from public, anon, authenticated;

create or replace function public.copiar_email_para_admin_e_socios()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venda boolean;
begin
  select d.outcome = 'won'
      or coalesce(g.code in ('VENDA', 'DISTRATO'), false)
      or public.negocio_em_distrato(d)
      or coalesce(current_setting('faceimob.saiu_da_venda', true), '') = 'on'
    into v_venda
    from public.deals d
    left join public.deal_status_groups g on g.id = d.status_group_id
   where d.id = new.deal_id;

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes, copia)
  select distinct on (lower(btrim(p.email::text)))
         new.deal_id, p.id, btrim(p.email::text), new.deal_code, new.client_name, new.stage_name,
         new.actor_name, new.message, new.source, new.detalhes, true
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where (ur.role = 'admin' or (ur.role = 'partner' and coalesce(v_venda, false)))
     and p.id is distinct from auth.uid()
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
     -- O mesmo aviso (mesma transação) já tem esse endereço: participante ou
     -- cópia de uma linha irmã.
     and not exists (
       select 1 from public.cca_move_emails e
        where e.deal_id = new.deal_id and e.source = new.source and e.stage_name = new.stage_name
          and e.created_at = new.created_at
          and lower(btrim(e.to_email)) = lower(btrim(p.email::text)))
   order by lower(btrim(p.email::text)), p.id;
  return null;
end;
$$;

revoke all on function public.copiar_email_para_admin_e_socios() from public, anon, authenticated;

drop trigger if exists copiar_email_para_admin_e_socios on public.cca_move_emails;
create trigger copiar_email_para_admin_e_socios
  after insert on public.cca_move_emails
  for each row when (not new.copia)
  execute function public.copiar_email_para_admin_e_socios();

-- Conferência (0203): o e-mail deixa de chamar admin e sócio direto; a cópia
-- acima manda ao admin todos os avisos (inclusive a devolução) e ao sócio só os
-- de venda. O push segue igual. Resto do corpo é o da 0203.
create or replace function public.avisar_conferencia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator     uuid := auth.uid();
  v_evento   text;
  v_titulo   text;
  v_mensagem text;
  v_cliente  text;
  v_ator_nome text;
  v_push     text[];   -- papéis do negócio que ganham push aqui
  v_email    text[];   -- papéis do negócio que ganham e-mail
  v_admin    boolean;
  v_cca      boolean;
  v_kind     text;
begin
  if new.document_review_status is not distinct from old.document_review_status then
    return null;
  end if;

  if new.document_review_status = 'pending' then
    v_evento := 'Análise enviada para conferência';
    v_kind := 'document_review_requested';
    v_push := array['broker', 'director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := true; v_cca := false;
    -- A mensagem do envio é o último comentário que a função gravou.
    select h.to_value into v_mensagem from public.deal_history h
     where h.deal_id = new.id and h.kind = 'comment' order by h.created_at desc limit 1;
  elsif new.document_review_status = 'approved' then
    v_evento := 'Análise aprovada e enviada ao CCA';
    v_kind := 'document_review_approved';
    v_push := array['manager', 'director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := true; v_cca := true;
    v_mensagem := 'A conferência foi aprovada e o negócio seguiu para a análise de crédito.';
  elsif new.document_review_status = 'returned' then
    -- Devolve o gerente (conferência) ou o CCA (pendência de documento).
    v_evento := 'Análise devolvida para ajustes';
    v_kind := 'document_review_returned';
    v_push := array['director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := false; v_cca := false;
    v_mensagem := coalesce(new.document_review_reason, 'A documentação voltou para ajustes.');
  else
    return null;
  end if;

  select nullif(btrim(c.full_name), '') into v_cliente from public.deal_clients c where c.deal_id = new.id and c.ordinal = 1;
  select full_name into v_ator_nome from public.profiles where id = v_ator;
  v_titulo := v_evento || ': ' || coalesce(v_cliente, new.code, 'negócio');

  -- Push (sino). Fora quem agiu e quem já recebeu da função de origem.
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct q.pid, v_kind, v_titulo, left(coalesce(v_mensagem, ''), 2000),
         case when v_kind = 'document_review_requested' then '/pipeline?conferencia=pendente' else '/pipeline' end,
         'in_app'::notification_channel
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = new.id and dp.role::text = any (v_push)
      union
      select ur.profile_id from public.user_roles ur where v_admin and ur.role in ('admin', 'partner')
    ) q
    join public.profiles p on p.id = q.pid and p.status = 'active'
   where q.pid is distinct from v_ator
     -- Quem a função de origem já avisou: gerente no envio, corretor na
     -- aprovação e na devolução.
     and not exists (
       select 1 from public.deal_participants x
        where x.deal_id = new.id and x.profile_id = q.pid
          and x.role::text = case new.document_review_status
                               when 'pending' then 'manager' else 'broker' end);

  -- E-mail (fila da Brevo), um por endereço.
  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text)))
         new.id, p.id, btrim(p.email::text), new.code, v_cliente, v_evento, coalesce(v_ator_nome, 'Sistema'),
         coalesce(v_mensagem, ''), 'conferencia',
         public.email_detalhes_do_negocio(new.id)
           || jsonb_build_object('status2', v_evento, 'observacao', coalesce(v_mensagem, ''))
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = new.id and dp.role::text = any (v_email)
      -- 0206: admin e sócio recebem pela cópia da fila.
      union
      select ur.profile_id from public.user_roles ur where v_cca and ur.role = 'cca'
    ) q
    join public.profiles p on p.id = q.pid and p.status = 'active'
   where q.pid is distinct from v_ator
     and coalesce((select s.conferencia_email from public.automation_settings s where s.id), false)
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
   order by lower(btrim(p.email::text)), p.id;

  return null;
end;
$$;

revoke all on function public.avisar_conferencia() from public, anon, authenticated;
