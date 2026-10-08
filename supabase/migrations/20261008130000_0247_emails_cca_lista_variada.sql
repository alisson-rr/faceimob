-- =============================================================================
-- 0247 · E-mail em toda movimentação CCA e lista de ligação da base completa
-- =============================================================================

-- A lista é uma exportação de gestão. `security invoker` fazia a RLS reduzir a
-- base conforme quem clicava: dois gestores podiam extrair listas diferentes e,
-- quando o recorte continha uma campanha dominante, o arquivo parecia ser só
-- daquele empreendimento. A permissão continua obrigatória; a leitura passa a
-- ser da base histórica inteira e a ordem intercala campanhas.
create or replace function public.lista_de_ligacao()
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.has_permission('leads.call_list') then
    raise exception 'Seu perfil não extrai a lista de ligação.' using errcode = '42501';
  end if;

  return query
  with base as (
    select l.id,
           coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), ''),
                    s.label, 'Sem campanha') as campanha_nome,
           l.full_name as cliente_nome,
           coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) as telefone_numero,
           l.created_at as criado
      from public.leads l
      left join public.lead_sources s on s.id = l.source_id
     where l.created_at < (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
       and l.converted_deal_id is null
       and l.status <> 'converted'
       and coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) is not null
  ), rodadas as (
    select b.*,
           row_number() over (
             partition by lower(b.campanha_nome)
             order by random()
           ) as rodada
      from base b
  )
  select r.campanha_nome, r.cliente_nome, r.telefone_numero, r.criado
    from rodadas r
   order by r.rodada,
            random();
end;
$$;

revoke all on function public.lista_de_ligacao() from public, anon;
grant execute on function public.lista_de_ligacao() to authenticated, service_role;
comment on function public.lista_de_ligacao() is
  'Base histórica não convertida, inclusive perdidos/descartados, para lista de ligação da liderança; campanhas intercaladas e sorteadas a cada extração, independentemente da RLS do solicitante.';

-- E-mail de movimentação é trilha operacional: ator, CCA e responsáveis do
-- negócio recebem sempre. `notify_sales` continua controlando somente o sino
-- interno para evitar duplicidade/ruído no aplicativo.
create or replace function public.move_cca_case(p_case_id uuid, p_stage_id uuid, p_message text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_case public.cca_cases;
  v_stage public.cca_stages;
  v_message text := btrim(coalesce(p_message, ''));
  v_code text;
  v_ator_nome text;
  v_cliente text;
  v_email boolean;
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if not public.has_permission('cca.review') then
    raise exception 'Seu perfil não move casos na esteira do CCA.' using errcode = '42501';
  end if;
  if v_message = '' then
    raise exception 'Escreva a mensagem da movimentação: ela fica registrada no negócio e avisa a equipe.' using errcode = 'P0001';
  end if;
  if length(v_message) > 4000 then raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001'; end if;

  select * into v_stage from public.cca_stages where id = p_stage_id and active;
  if not found then raise exception 'Coluna da esteira não encontrada ou desativada.' using errcode = 'P0001'; end if;
  select * into v_case from public.cca_cases where id = p_case_id for update;
  if not found then raise exception 'Caso não encontrado.' using errcode = 'P0002'; end if;

  perform set_config('faceimob.cca_move', 'on', true);
  update public.cca_cases
     set stage_id = v_stage.id, status = v_stage.status, decision_notes = v_message,
         decided_at = case when v_stage.status not in ('approved', 'rejected') then null
                           when v_stage.status = v_case.status then coalesce(v_case.decided_at, now())
                           else now() end
   where id = p_case_id;
  perform set_config('faceimob.cca_move', '', true);

  select d.code into v_code from public.deals d where d.id = v_case.deal_id;
  select p.full_name into v_ator_nome from public.profiles p where p.id = auth.uid();
  select c.full_name into v_cliente from public.deal_clients c
   where c.deal_id = v_case.deal_id and c.ordinal = 1;
  select s.cca_move_email into v_email from public.automation_settings s where s.id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (v_case.deal_id, auth.uid(), 'comment', 'STATUS: ' || v_stage.name || ' — ' || v_message);

  if v_stage.notify_sales then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select distinct dp.profile_id, 'cca_status_changed',
           format('Crédito %s: %s', coalesce(v_code, 'negócio sem código'), v_stage.name),
           left(format('%s moveu para "%s": %s', coalesce(v_ator_nome, 'Alguém'), v_stage.name, v_message), 2000),
           '/pipeline', 'in_app'::notification_channel
      from public.deal_participants dp
      join public.profiles p on p.id = dp.profile_id and p.status = 'active'
     where dp.deal_id = v_case.deal_id and dp.role in ('broker', 'manager', 'director')
       and dp.profile_id <> auth.uid()
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = dp.profile_id and n.kind = 'document_review_returned'
            and n.title = public.texto_com_nome_do_cliente('CCA devolveu o dossiê: ' || v_code)
            and n.created_at >= now());
  end if;

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text)))
         v_case.deal_id, p.id, btrim(p.email::text), v_code, v_cliente, v_stage.name,
         coalesce(v_ator_nome, 'Sistema'), v_message, 'cca',
         public.email_detalhes_do_negocio(v_case.deal_id)
           || jsonb_build_object('status2', v_stage.name, 'observacao', v_message)
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = v_case.deal_id
         and dp.role in ('broker', 'manager', 'director')
      union
      select auth.uid() where auth.uid() is not null
      union
      select ur.profile_id from public.user_roles ur where ur.role = 'cca'
    ) destino
    join public.profiles p on p.id = destino.pid and p.status = 'active'
   where coalesce(v_email, false)
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
   order by lower(btrim(p.email::text)), p.id;

  return jsonb_build_object('case_id', v_case.id, 'deal_id', v_case.deal_id,
                            'stage_id', v_stage.id, 'status', v_stage.status);
end;
$$;
revoke all on function public.move_cca_case(uuid, uuid, text) from public, anon;
grant execute on function public.move_cca_case(uuid, uuid, text) to authenticated, service_role;
