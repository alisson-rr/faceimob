-- =============================================================================
-- 0184 — aviso com o nome do cliente no lugar do código do negócio
--
-- Pedido do cliente em 02/10/2026: "Documentos aprovados: NEG-001227" não diz
-- nada a quem recebe no celular; o corretor reconhece o cliente, não o código.
--
-- Um ponto só, e não as ~10 funções que escrevem aviso: antes de gravar a
-- notificação (sininho, push e WhatsApp saem da mesma linha), cada código
-- `NEG-…` do título e do texto vira o nome do 1º cliente do negócio. Sem
-- cliente cadastrado (aviso que nasce junto com o negócio) o código fica.
-- =============================================================================

-- O texto com cada `NEG-…` trocado pelo nome do 1º cliente do negócio.
create or replace function public.texto_com_nome_do_cliente(p_texto text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto  text := p_texto;
  v_codigo text;
  v_nome   text;
begin
  if p_texto is null then
    return null;
  end if;
  for v_codigo in
    select distinct m[1] from regexp_matches(p_texto, '(NEG-[0-9]{4,})', 'g') as m
  loop
    select nullif(btrim(c.full_name), '') into v_nome
      from public.deals d
      join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
     where d.code = v_codigo;
    if v_nome is not null then
      v_texto := replace(v_texto, v_codigo, v_nome);
    end if;
  end loop;
  return v_texto;
end;
$$;

revoke all on function public.texto_com_nome_do_cliente(text) from public, anon, authenticated;

create or replace function public.notifications_nome_do_cliente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.title := public.texto_com_nome_do_cliente(new.title);
  new.body := public.texto_com_nome_do_cliente(new.body);
  return new;
end;
$$;

revoke all on function public.notifications_nome_do_cliente() from public, anon, authenticated;

drop trigger if exists notifications_nome_do_cliente on public.notifications;
create trigger notifications_nome_do_cliente
  before insert on public.notifications
  for each row execute function public.notifications_nome_do_cliente();

-- -----------------------------------------------------------------------------
-- A trava de aviso repetido do CCA comparava o título com o código; agora o
-- título gravado traz o nome. Mesmas funções de antes (`pg_get_functiondef`),
-- só a comparação passa pelo mesmo texto que o gatilho grava.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_cca_status_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ator      uuid := auth.uid();
  v_ator_nome text;
  v_code      text;
  -- Mesmos rótulos de src/components/pipeline/ccaStage.ts.
  v_rotulo    constant jsonb := '{
    "pending_documents": "Aguardando documentos",
    "under_review": "Em análise",
    "sent_to_developer": "Enviado à construtora",
    "sent_to_agency": "Enviado à agência",
    "approved": "Aprovado",
    "rejected": "Reprovado",
    "cancelled": "Cancelado"
  }';
begin
  if v_ator is null or current_setting('faceimob.cca_move', true) = 'on' then
    return null;
  end if;

  select d.code into v_code from public.deals d where d.id = new.deal_id;
  select full_name into v_ator_nome from public.profiles where id = v_ator;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dp.profile_id,
         'cca_status_changed',
         format('Crédito %s: %s',
                coalesce(v_code, 'negócio sem código'),
                coalesce(v_rotulo ->> new.status::text, new.status::text)),
         format('%s moveu a análise de crédito de "%s" para "%s".',
                coalesce(v_ator_nome, 'Alguém'),
                coalesce(v_rotulo ->> old.status::text, old.status::text),
                coalesce(v_rotulo ->> new.status::text, new.status::text)),
         '/pipeline',
         'in_app'
    from (
      select distinct dp0.profile_id
        from public.deal_participants dp0
       where dp0.deal_id = new.deal_id and dp0.role = 'broker'
    ) dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.profile_id <> v_ator
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = dp.profile_id
          and n.kind = 'document_review_returned'
          and n.title = public.texto_com_nome_do_cliente('CCA devolveu o dossiê: ' || v_code)
          and n.created_at >= now()
     );

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.move_cca_case(p_case_id uuid, p_stage_id uuid, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
              and n.title = public.texto_com_nome_do_cliente('CCA devolveu o dossiê: ' || v_code)
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
$function$;
