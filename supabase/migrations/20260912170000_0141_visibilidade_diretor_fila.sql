-- =============================================================================
-- 0141 · Diretor e gerente enxergam só o que é deles
--
-- Regra do dono (12/09/2026): o corretor vê os leads que recebeu; SÓ sócio e
-- administrador veem tudo; gerente e diretor veem o que se relaciona com eles.
-- O CCA continua vendo todos os negócios (esteira de crédito) — não muda aqui.
-- Toda visibilidade continua saindo de auth_visible_profiles(); nada abaixo
-- copia a hierarquia.
--
--   1. can_read_all() deixa de incluir o diretor. Os consumidores, conferidos
--      em pg_proc e pg_policies antes de escrever: policies deals_select,
--      deal_participants_select, deal_clients_select, deal_documents_select,
--      deal_history_select, cca_cases_select, developer_submissions_select,
--      visits_select e goals_select; as funções can_see_deal (→ add_deal_comment,
--      cca_case_events_select, storage de documentos) e deal_participant_names.
--      O diretor passa a chegar aos negócios por auth_visible_deal_ids(), como
--      gerente e corretor. Medido na homologação (md5 da lista visível,
--      expressão atual × nova, sem DDL):
--        diretor  negócios 7.579 → 2.947 · casos CCA 7.560 → 2.945 ·
--                 participantes 20.737 → 8.008
--        admin, sócio, gerente, gerente suspenso, corretor e CCA: md5 idênticos.
--
--   2. Fila (lead sem dono). leads.view_queue abria a fila de TODOS os grupos
--      para ler e editar. Marketing, administrador e sócio seguem com a fila
--      inteira; os demais (gerente, diretor, ou quem ganhar o switch) ficam com
--      a fila geral e a dos grupos em que está alguém do alcance deles — o que o
--      NewLeadNotifier já presumia. Vale para ler, editar, anexar, distribuir e
--      REALOCAR: reassign_lead (0128) usava "o mesmo predicado da leads_select",
--      e sem acompanhar a regra o gerente puxava para a equipe dele o lead da
--      fila de outra — o mesmo alargamento que a 0128 fechou para lead com dono.
--      Como o alcance sai da filiação à roleta, o diretor só grava filiação em
--      roleta que já alcança e de quem enxerga (distribution_group_members_write);
--      o aviso de lead sem atendimento (assign_lead) vai só a quem alcança a
--      roleta; e lead_assignments_select deixa de abrir tudo ao diretor.
--
--   3. Storage: as policies FOR ALL liberavam DELETE a quem só VÊ o arquivo.
--      Leitura por quem vê; gravação e remoção seguem a regra da LINHA de
--      deal_documents (inclusive a trava do dossiê enviado). Sem policy de
--      UPDATE: o front só usa upload sem upsert, copy e remove.
--
--   4. marketing_campaign_stats e marketing_developer_summary: empresa inteira
--      só para marketing, administrador e sócio; os demais somam o que veem.
--
--   5. existing_lead_phones: no máximo 1.000 telefones por chamada.
--
--   6. lead_distribution_group e distribution_queue exigem alcance.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quem lê todos os negócios: administrador e sócio
-- -----------------------------------------------------------------------------
create or replace function public.can_read_all()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin();
$$;

comment on function public.can_read_all() is
  'Lê todos os negócios: administrador e sócio (is_admin). O diretor saiu na 0141 e vê a própria hierarquia por auth_visible_deal_ids(); o CCA vê a esteira pelo ramo has_role(''cca'') de cada policy.';

-- -----------------------------------------------------------------------------
-- 2. Fila por grupo de distribuição
-- -----------------------------------------------------------------------------

-- Grupos que o usuário alcança. `distribution_groups` não tem equipe: o elo é
-- a filiação — grupo em que está alguém que ele enxerga (ele mesmo incluso).
-- A fila geral é de quem tem leads.view_queue. Marketing, administrador e sócio
-- operam a roleta inteira.
create or replace function public.auth_distribution_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.id
    from public.distribution_groups g
   where (select public.has_any_role('admin', 'marketing'))
  union
  select m.group_id
    from public.distribution_group_members m
   where m.active
     and m.profile_id in (select public.auth_visible_profiles())
  union
  select g.id
    from public.distribution_groups g
   where g.kind = 'general'
     and (select public.has_permission('leads.view_queue'));
$$;

comment on function public.auth_distribution_group_ids() is
  'Grupos de distribuição ao alcance do usuário: todos para marketing/admin/sócio; senão os grupos com alguém de auth_visible_profiles() e a fila geral para quem tem leads.view_queue (0141).';

revoke all on function public.auth_distribution_group_ids() from public, anon;
grant execute on function public.auth_distribution_group_ids() to authenticated, service_role;

-- Leads da fila que o usuário alcança, para as funções SECURITY DEFINER
-- (can_write_lead, distribute_queued_lead, reassign_lead, métricas de
-- marketing). O grupo efetivo é o de lead_distribution_group(): o do lead,
-- senão o do formulário, senão a fila geral — e a geral é de todo mundo que tem
-- a permissão, por isso "sem grupo resolvido" entra.
-- MESMO predicado do ramo de fila de leads_select e leads_update, logo abaixo:
-- mudar os três juntos (supabase/tests/99_visibilidade_diretor_fila.sql compara a função com a policy).
create or replace function public.auth_queue_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id
    from public.leads l
   where l.assigned_to is null
     and (select public.has_permission('leads.view_queue'))
     and (l.distribution_group_id in (select public.auth_distribution_group_ids())
          or (l.distribution_group_id is null
              and (l.form_id is null
                   or l.form_id not in (select f.form_id
                                          from public.distribution_group_forms f
                                         where f.group_id not in (select public.auth_distribution_group_ids())))));
$$;

comment on function public.auth_queue_lead_ids() is
  'Leads sem dono ao alcance do usuário, para can_write_lead, distribute_queued_lead, reassign_lead e as métricas de marketing (0141). Mesmo predicado do ramo de fila de leads_select/leads_update.';

revoke all on function public.auth_queue_lead_ids() from public, anon;
grant execute on function public.auth_queue_lead_ids() to authenticated, service_role;

-- O ramo de fila lê as COLUNAS da linha, não `id in (auth_queue_lead_ids())`:
-- INSERT/UPDATE com RETURNING (createLead, createLeads) confere a policy de
-- SELECT na linha nova ANTES de gravá-la, e um conjunto lido de `leads` ainda
-- não a contém — criar lead sem dono falhava até para o administrador.
-- Medido na homologação: md5 idêntico ao do conjunto para os seis papéis.
alter policy leads_select on public.leads
  using (assigned_to in (select public.auth_visible_profiles())
      or (assigned_to is null
          and (select public.has_permission('leads.view_queue'))
          and (distribution_group_id in (select public.auth_distribution_group_ids())
               or (distribution_group_id is null
                   and (form_id is null
                        or form_id not in (select f.form_id
                                             from public.distribution_group_forms f
                                            where f.group_id not in (select public.auth_distribution_group_ids())))))));

alter policy leads_update on public.leads
  using (assigned_to = (select auth.uid())
      or (select public.is_admin())
      or public.manages_profile(assigned_to)
      or (assigned_to is null
          and (select public.has_permission('leads.view_queue'))
          and (distribution_group_id in (select public.auth_distribution_group_ids())
               or (distribution_group_id is null
                   and (form_id is null
                        or form_id not in (select f.form_id
                                             from public.distribution_group_forms f
                                            where f.group_id not in (select public.auth_distribution_group_ids())))))))
  with check (assigned_to = (select auth.uid())
      or (select public.is_admin())
      or public.manages_profile(assigned_to)
      or (assigned_to is null
          and (select public.has_permission('leads.view_queue'))
          and (distribution_group_id in (select public.auth_distribution_group_ids())
               or (distribution_group_id is null
                   and (form_id is null
                        or form_id not in (select f.form_id
                                             from public.distribution_group_forms f
                                            where f.group_id not in (select public.auth_distribution_group_ids())))))));

-- A filiação à roleta decide o alcance da fila: gravar filiação é ampliar o
-- próprio alcance. A 0004 deixava o diretor gravar em QUALQUER roleta (e se
-- incluir na de outra equipe para ler, editar e realocar a fila dela). Agora ele
-- só mexe em roleta que já alcança e em quem enxerga; ligar uma roleta a outra
-- equipe é do administrador. A checagem enxerga o banco do início do comando,
-- então a filiação sendo gravada não se autoriza.
alter policy distribution_group_members_write on public.distribution_group_members
  using ((select public.is_admin())
      or ((select public.has_role('director'))
          and group_id in (select public.auth_distribution_group_ids())
          and profile_id in (select public.auth_visible_profiles())))
  with check ((select public.is_admin())
      or ((select public.has_role('director'))
          and group_id in (select public.auth_distribution_group_ids())
          and profile_id in (select public.auth_visible_profiles())));

-- Atribuições (quem recebeu, prazo, estouro): o `or has_any_role('admin',
-- 'director')` da 0005 abria as de toda a empresa ao diretor, por fora de
-- can_read_all(). Fica quem o usuário enxerga, e administrador/sócio.
alter policy lead_assignments_select on public.lead_assignments
  using (profile_id in (select public.auth_visible_profiles())
      or (select public.is_admin()));

-- Anexo, comentário e encerramento passam por aqui.
create or replace function public.can_write_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        l.assigned_to = auth.uid()
        or public.is_admin()
        or public.manages_profile(l.assigned_to)
        or (l.assigned_to is null and l.id in (select public.auth_queue_lead_ids()))
      )
  );
$$;

-- Corpo da definição em vigor; a diferença é a trava de alcance no `select`.
create or replace function public.distribute_queued_lead(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.lead_status;
  v_paused boolean;
begin
  if not public.has_permission('leads.view_queue') then
    raise exception 'Sem permissão para distribuir leads da fila.' using errcode = '42501';
  end if;

  -- Fora do alcance a resposta é a de id inexistente: a função é SECURITY
  -- DEFINER e, sem isto, o id de um lead da fila de outra equipe bastava.
  select l.status into v_status
    from public.leads l
   where l.id = p_lead_id
     and (l.assigned_to in (select public.auth_visible_profiles())
          or l.id in (select public.auth_queue_lead_ids()));
  if v_status is null then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  if v_status <> 'queued' then
    raise exception 'Este lead não está na fila (%).', v_status using errcode = 'P0001';
  end if;

  select s.leads_paused into v_paused from public.automation_settings s where s.id;
  if coalesce(v_paused, false) then
    raise exception 'A distribuição está pausada em Admin · Automação de Leads. '
                    'Nenhum lead sai da fila até religar.' using errcode = 'P0001';
  end if;

  if public.lead_distribution_group(p_lead_id) is null then
    raise exception 'Este lead não tem grupo de distribuição e não há fila geral ativa. '
                    'Defina o grupo do lead ou ative a fila geral em Admin · Distribuição.'
                    using errcode = 'P0001';
  end if;

  -- Devolve null quando não há ninguém elegível: a tela precisa dizer isso em
  -- vez de fingir que distribuiu.
  return public.assign_lead(p_lead_id, true);
end;
$$;

-- Corpo da 0128; a diferença é o ramo de fila, que acompanha a leads_select.
create or replace function public.reassign_lead(p_lead_id uuid, p_target uuid)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_timeout int;
begin
  if not public.has_permission('leads.reassign') then
    raise exception 'Sem permissão para realocar leads.' using errcode = '42501';
  end if;

  if not (public.is_admin() or public.manages_profile(p_target)) then
    raise exception 'Sem permissão para realocar para este corretor.' using errcode = '42501';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  -- Mesmo predicado da `leads_select`: dono no alcance, ou lead da fila ao
  -- alcance (auth_queue_lead_ids, 0141). Fora do alcance a resposta é a mesma
  -- de id inexistente: "sem permissão" confirmaria que o lead existe.
  -- `coalesce` porque `null in (...)` é null, e `if null` deixaria passar.
  if not found or not coalesce(
       case when v_lead.assigned_to is null
            then v_lead.id in (select public.auth_queue_lead_ids())
            else v_lead.assigned_to in (select public.auth_visible_profiles())
       end, false) then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  update public.lead_assignments
     set released_at = now(), release_reason = 'reassigned'
   where lead_id = p_lead_id and released_at is null;

  v_timeout := public.effective_attend_timeout(v_lead.distribution_group_id);

  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  select p_lead_id, p_target, v_lead.distribution_group_id,
         coalesce(max(la.sequence), 0) + 1,
         now() + make_interval(secs => v_timeout)
  from public.lead_assignments la where la.lead_id = p_lead_id;

  update public.leads
     set status           = 'assigned',
         assigned_to      = p_target,
         assigned_at      = now(),
         attend_deadline  = now() + make_interval(secs => v_timeout),
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, auth.uid(), 'reassigned', p_target::text,
          jsonb_build_object('manual', true));

  return v_lead;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Storage: ler quem vê; gravar e apagar quem edita
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage do Supabase ausente - policies de bucket ignoradas (ambiente de teste)';
    return;
  end if;

  execute 'drop policy if exists deal_documents_storage on storage.objects';
  execute 'drop policy if exists deal_documents_storage_select on storage.objects';
  execute 'drop policy if exists deal_documents_storage_insert on storage.objects';
  execute 'drop policy if exists deal_documents_storage_delete on storage.objects';

  -- Leitura: o USING da policy FOR ALL da 0059, sem mudança.
  execute $p$
    create policy deal_documents_storage_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'deal-documents'
        and (
          (select public.has_role('cca'))
          or exists (
            select 1 from public.deal_documents d
            where d.storage_path = storage.objects.name
              and public.can_see_deal(d.deal_id)
          )
          or (
            public.deal_id_of_object(storage.objects.name) is not null
            and public.can_see_deal(public.deal_id_of_object(storage.objects.name))
          )
        )
      )
  $p$;

  -- Gravação: o WITH CHECK da 0059 mais a trava de deal_documents_insert —
  -- dossiê já enviado só recebe arquivo de administrador ou de quem revisa
  -- (cca.review). Sem a trava, o upload passava, a linha era recusada e o
  -- arquivo virava órfão (o rollback do front esbarra na trava da remoção).
  -- O ramo de lead_attachments é a cópia do anexo promovido, sob <lead_id>/….
  execute $p$
    create policy deal_documents_storage_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'deal-documents'
        and public.deal_id_of_object(storage.objects.name) is not null
        and (
          (
            public.can_edit_deal(public.deal_id_of_object(storage.objects.name))
            and (
              public.is_admin()
              or public.has_permission('cca.review')
              or exists (
                select 1 from public.deals dl
                where dl.id = public.deal_id_of_object(storage.objects.name)
                  and coalesce(dl.document_review_status, 'draft') in ('draft', 'returned')
              )
            )
          )
          or exists (
            select 1 from public.lead_attachments a
            where a.storage_path = storage.objects.name
              and a.lead_id = public.deal_id_of_object(storage.objects.name)
          )
        )
      )
  $p$;

  -- Remoção: a regra de deal_documents_delete (administrador, ou quem edita o
  -- negócio com o dossiê em rascunho/devolvido) — senão o participante apagava
  -- o arquivo de dossiê em análise e a linha ficava apontando para o nada. Os
  -- dois ramos são os de deleteDealDocument: pela pasta <deal_id>/… (linha já
  -- apagada) ou pela linha de deal_documents (arquivo fora da pasta).
  execute $p$
    create policy deal_documents_storage_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'deal-documents'
        and (
          public.is_admin()
          or (
            public.deal_id_of_object(storage.objects.name) is not null
            and public.can_edit_deal(public.deal_id_of_object(storage.objects.name))
            and exists (
              select 1 from public.deals dl
              where dl.id = public.deal_id_of_object(storage.objects.name)
                and coalesce(dl.document_review_status, 'draft') in ('draft', 'returned')
            )
          )
          or exists (
            select 1
            from public.deal_documents d
            join public.deals dl on dl.id = d.deal_id
            where d.storage_path = storage.objects.name
              and public.can_edit_deal(d.deal_id)
              and coalesce(dl.document_review_status, 'draft') in ('draft', 'returned')
          )
        )
      )
  $p$;

  execute 'drop policy if exists lead_attachments_storage on storage.objects';
  execute 'drop policy if exists lead_attachments_storage_select on storage.objects';
  execute 'drop policy if exists lead_attachments_storage_insert on storage.objects';
  execute 'drop policy if exists lead_attachments_storage_delete on storage.objects';

  -- Leitura e gravação: USING e WITH CHECK da 0071, sem mudança.
  execute $p$
    create policy lead_attachments_storage_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'lead-attachments'
        and (
          (
            public.deal_id_of_object(storage.objects.name) is not null
            and public.can_see_lead(public.deal_id_of_object(storage.objects.name))
          )
          or exists (
            select 1 from public.lead_attachments a
            where a.storage_path = storage.objects.name
              and public.can_see_lead(a.lead_id)
          )
        )
      )
  $p$;

  execute $p$
    create policy lead_attachments_storage_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'lead-attachments'
        and public.deal_id_of_object(storage.objects.name) is not null
        and public.can_write_lead(public.deal_id_of_object(storage.objects.name))
      )
  $p$;

  -- Remoção: quem escreve no lead (dono, gestor do dono, admin, fila ao
  -- alcance) — o mesmo que pôde gravar. O front só remove no rollback do upload.
  execute $p$
    create policy lead_attachments_storage_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'lead-attachments'
        and (
          (
            public.deal_id_of_object(storage.objects.name) is not null
            and public.can_write_lead(public.deal_id_of_object(storage.objects.name))
          )
          or exists (
            select 1 from public.lead_attachments a
            where a.storage_path = storage.objects.name
              and public.can_write_lead(a.lead_id)
          )
        )
      )
  $p$;
exception
  when insufficient_privilege then
    raise notice 'sem privilégio para recriar as policies de bucket - ignorado';
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Métricas de marketing: empresa inteira só para marketing, admin e sócio
--
-- As duas são SECURITY DEFINER (o agregado precisa passar pela RLS de deals
-- para o marketing, que não participa de negócio). Para os demais papéis com
-- reports.view_finance o filtro é o das policies: leads_select (dono no
-- alcance ou fila ao alcance) e deals_select (autor, CCA ou participante no
-- alcance). Aporte e gasto de campanha não são de pessoa e não mudam.
-- A atribuição de campanha a um negócio continua olhando todos os leads: é o
-- lead mais antigo que decide, e o número não pode mudar conforme quem olha.
-- -----------------------------------------------------------------------------
create or replace function public.marketing_campaign_stats()
returns table(campaign_id text, leads integer, conversions integer, sales integer, revenue numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_empresa boolean;
begin
  if not public.has_permission('reports.view_finance') then
    raise exception 'Papel sem permissão para métricas de marketing'
      using errcode = '42501';
  end if;

  v_empresa := public.has_any_role('admin', 'marketing');

  return query
  with por_campanha as (
    select
      l.campaign_id as cid,
      count(*)::int as leads,
      -- Negócio, não venda: é o que a coluna "Conversões" da tela mostra.
      count(*) filter (where l.converted_deal_id is not null)::int as conversions
    from public.leads l
    where l.campaign_id is not null
      and (v_empresa
           or l.assigned_to in (select public.auth_visible_profiles())
           or (l.assigned_to is null and l.id in (select public.auth_queue_lead_ids())))
    group by l.campaign_id
  ),
  -- UM negócio, UMA campanha: a do lead mais antigo que aponta para ele.
  -- Sem este `distinct on`, o mesmo VGV somava em cada campanha que tivesse um
  -- lead apontando para o negócio, e a soma das campanhas passava do VGV real.
  origem as (
    select distinct on (l.converted_deal_id)
      l.converted_deal_id as did,
      l.campaign_id as cid
    from public.leads l
    where l.campaign_id is not null and l.converted_deal_id is not null
    order by l.converted_deal_id, l.created_at, l.id
  ),
  ganhos as (
    select o.cid, count(*)::int as sales, coalesce(sum(d.vgv_net), 0)::numeric as revenue
    from origem o
    join public.deals d on d.id = o.did and d.outcome = 'won'
    where v_empresa
       or d.created_by = (select auth.uid())
       or (select public.has_role('cca'))
       or d.id in (select public.auth_visible_deal_ids())
    group by o.cid
  )
  select p.cid, p.leads, p.conversions, coalesce(g.sales, 0), coalesce(g.revenue, 0)::numeric
  from por_campanha p
  left join ganhos g on g.cid = p.cid;
end;
$$;

create or replace function public.marketing_developer_summary(p_period date default null)
returns table(developer_id uuid, developer_name text, active boolean, investment numeric,
              campaign_spend numeric, campaigns integer, leads integer, deals integer,
              sales integer, vgv numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_period  date := case when p_period is null then null else public.month_start(p_period) end;
  v_empresa boolean;
begin
  if not public.has_permission('reports.view_finance') then
    raise exception 'Papel sem permissão para o resumo por construtora'
      using errcode = '42501';
  end if;

  v_empresa := public.has_any_role('admin', 'marketing');

  return query
  with aporte as (
    select mi.developer_id as dev, sum(mi.amount)::numeric as amount
    from public.marketing_investments mi
    where v_period is null or mi.period = v_period
    group by mi.developer_id
  ),
  campanha as (
    select c.developer_id as dev, sum(c.total_spend)::numeric as spend, count(*)::int as qtd
    from public.ad_campaigns c
    group by c.developer_id
  ),
  -- Lead → construtora pela campanha cadastrada. Lead sem campanha, ou com
  -- `campaign_id` que não casa com nenhuma linha de `ad_campaigns`, cai no
  -- balde nulo — é exatamente o lead que hoje some da conta sem aviso.
  lead_por_dev as (
    select c.developer_id as dev, count(*)::int as qtd
    from public.leads l
    left join public.ad_campaigns c on c.external_id = l.campaign_id
    where (v_period is null
           or public.month_start((l.created_at at time zone 'America/Sao_Paulo')::date) = v_period)
      and (v_empresa
           or l.assigned_to in (select public.auth_visible_profiles())
           or (l.assigned_to is null and l.id in (select public.auth_queue_lead_ids())))
    group by c.developer_id
  ),
  negocio as (
    select
      d.developer_id as dev,
      count(*)::int as qtd,
      count(*) filter (where d.outcome = 'won')::int as won,
      coalesce(sum(d.vgv_net) filter (where d.outcome = 'won'), 0)::numeric as vgv
    from public.deals d
    where (v_period is null or d.month_base = v_period)
      and (v_empresa
           or d.created_by = (select auth.uid())
           or (select public.has_role('cca'))
           or d.id in (select public.auth_visible_deal_ids()))
    group by d.developer_id
  ),
  chaves as (
    select dv.id as dev from public.developers dv
    union select a.dev from aporte a
    union select cp.dev from campanha cp
    union select lp.dev from lead_por_dev lp
    union select ng.dev from negocio ng
  )
  select
    k.dev,
    coalesce(dv.name, 'Sem construtora')::text,
    coalesce(dv.active, false),
    coalesce(a.amount, 0)::numeric,
    coalesce(cp.spend, 0)::numeric,
    coalesce(cp.qtd, 0),
    coalesce(lp.qtd, 0),
    coalesce(ng.qtd, 0),
    coalesce(ng.won, 0),
    coalesce(ng.vgv, 0)::numeric
  from chaves k
  left join public.developers dv on dv.id = k.dev
  left join aporte a          on a.dev  is not distinct from k.dev
  left join campanha cp       on cp.dev is not distinct from k.dev
  left join lead_por_dev lp   on lp.dev is not distinct from k.dev
  left join negocio ng        on ng.dev is not distinct from k.dev
  order by 4 desc, 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. existing_lead_phones: lista limitada
-- -----------------------------------------------------------------------------
create or replace function public.existing_lead_phones(p_phones text[])
returns table(phone_digits text, lead_count integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin'::app_role, 'director'::app_role, 'manager'::app_role,
                             'marketing'::app_role, 'sdr'::app_role) then
    raise exception 'Sem permissão para importar leads.' using errcode = '42501';
  end if;

  -- A função é SECURITY DEFINER e varre `leads` inteira: sem teto, uma chamada
  -- com milhões de itens era carga livre. A importação manda em lotes de 1.000
  -- (existingLeadPhones, src/integrations/supabase/leads.ts).
  if cardinality(p_phones) > 1000 then
    raise exception 'No máximo 1.000 telefones por consulta (vieram %).', cardinality(p_phones)
      using errcode = '22023';
  end if;

  -- `normalize_phone` é a MESMA função que o gatilho de `leads` aplica na
  -- gravação (0001: "Base do dedupe de leads"): a coluna guarda E.164 com DDI
  -- 55, e comparar dígito a dígito com o que veio da planilha nunca casaria.
  -- Devolve o telefone COMO FOI INFORMADO, para quem chamou casar com a própria
  -- linha sem repetir a normalização no cliente.
  return query
  select p.informado, count(l.id)::int
  from unnest(coalesce(p_phones, '{}'::text[])) as p(informado)
  join public.leads l on l.phone = public.normalize_phone(p.informado)
  where p.informado is not null and p.informado <> ''
  group by p.informado;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Roleta: grupo e fila só para quem alcança
-- -----------------------------------------------------------------------------

-- SECURITY INVOKER: chamada direta pela API passa pela RLS de `leads`, e lead
-- fora do alcance vira null — "vê o lead" sem uma segunda cópia da regra. Os
-- chamadores internos (assign_lead, distribute_queued_lead, reassign_lead) são
-- SECURITY DEFINER do dono das tabelas e continuam lendo tudo.
create or replace function public.lead_distribution_group(p_lead_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    l.distribution_group_id,
    (select f.group_id from public.distribution_group_forms f where f.form_id = l.form_id),
    (select g.id from public.distribution_groups g where g.kind = 'general' and g.active limit 1)
  )
  from public.leads l
  where l.id = p_lead_id;
$$;

-- A fila lista nome e posição de corretores: só de grupo ao alcance. Sem
-- sessão (`auth.uid()` nulo: cron e edge functions com service role) passa, é
-- o caminho da roleta. Fora do alcance devolve vazio, não erro: a assign_lead
-- também chama daqui, e a tela recorta os grupos antes (listGroupQueues).
create or replace function public.distribution_queue(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select
      c.profile_id,
      p.full_name,
      (
        select max(la.assigned_at)
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_assigned_at,
      -- Fim da última vez na roleta: lead perdido no prazo encerra a vez no
      -- released_at, não no assigned_at (0014).
      (
        select max(
          case
            when la.release_reason = 'timeout' then la.released_at
            else la.assigned_at
          end
        )
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_turn_at
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m
      on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g
      on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date()
      and c.checked_out_at is null
      and m.group_id = p_group_id
      and p.status = 'active'
      and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and public.overdue_lead_count(c.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
      and ((select auth.uid()) is null
           or p_group_id in (select public.auth_distribution_group_ids()))
  )
  select
    e.profile_id,
    e.full_name,
    row_number() over (order by e.last_turn_at asc nulls first, e.profile_id)::int
      as queue_position,
    e.last_assigned_at,
    e.last_turn_at
  from eligible e;
$$;

-- Corpo da 0074; a diferença são os destinatários do aviso `lead_unattended`,
-- que levava o nome do cliente a TODO gerente e diretor, inclusive a quem não
-- enxerga a roleta do lead desde o recorte da fila acima.
create or replace function public.assign_lead(p_lead_id uuid, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lead        public.leads;
  v_group       uuid;
  v_target      uuid;
  v_timeout     int;
  v_seq         int;
  v_paused      boolean;
  v_last_miss   uuid;
  v_miss_count  int;
  v_total_miss  int;
  v_max_rounds  int;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead % não encontrado.', p_lead_id using errcode = 'P0002';
  end if;

  select s.leads_paused, s.roulette_max_rounds
    into v_paused, v_max_rounds
  from public.automation_settings s where s.id;

  if coalesce(v_paused, false) then
    return null;
  end if;

  if v_lead.status not in ('queued') then
    return v_lead.assigned_to;
  end if;

  v_group := public.lead_distribution_group(p_lead_id);

  if v_group is null then
    return null;
  end if;

  -- TETO TOTAL. Um lead que ninguém atendeu depois de N voltas não é um lead
  -- que precisa girar mais: é um lead que precisa de gente. Ele sai da roleta,
  -- fica na bandeja do gestor e avisa quem responde pela operação.
  select count(*)::int into v_total_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout';

  if not coalesce(p_force, false) and v_total_miss >= coalesce(v_max_rounds, 5) then
    -- Um aviso por travessia, não um por tentativa do cron (que roda a cada
    -- minuto): o evento só entra quando ainda não existe para esta contagem.
    if not exists (
      select 1 from public.lead_events e
      where e.lead_id = p_lead_id
        and e.kind = 'unattended'
        and (e.detail ->> 'misses')::int = v_total_miss
    ) then
      insert into public.lead_events (lead_id, actor_id, kind, detail)
      values (p_lead_id, null, 'unattended',
              jsonb_build_object('misses', v_total_miss, 'group_id', v_group));

      -- Destinatários: administrador; e gerente/diretor que alcança a roleta —
      -- o critério de auth_distribution_group_ids() visto pelo destinatário, que
      -- não é a sessão (quem chama aqui é o cron). Fila geral é de todos; roleta
      -- específica, de quem está nela ou lidera equipe ativa em que está alguém
      -- dela (membro ou gerente) — as regras de auth_visible_profiles(). Mudou a
      -- hierarquia lá, muda aqui: o teste 99_visibilidade_diretor_fila cobre.
      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select distinct p.id,
             'lead_unattended',
             'Lead sem atendimento: ' || coalesce(v_lead.full_name, 'sem nome'),
             format('Voltou %s vezes para a roleta sem ninguém atender. Ele saiu da '
                    || 'distribuição automática e espera na bandeja "sem atendimento".',
                    v_total_miss),
             '/leads?lead=' || p_lead_id::text,
             'in_app'::public.notification_channel
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role = 'admin'
          or (ur.role in ('manager', 'director')
              and (exists (select 1 from public.distribution_groups g
                            where g.id = v_group and g.kind = 'general')
                   or exists (
                     select 1
                       from public.distribution_group_members m
                      where m.group_id = v_group
                        and m.active
                        and (m.profile_id = p.id
                             or exists (
                               select 1
                                 from public.teams t
                                where t.active
                                  and p.id in (t.manager_id, t.director_id)
                                  and (t.manager_id = m.profile_id
                                       or exists (select 1 from public.team_members tm
                                                   where tm.team_id = t.id
                                                     and tm.profile_id = m.profile_id
                                                     and tm.left_at is null)))))));
    end if;

    return null;
  end if;

  -- Quem deixou ESTE lead vencer na rodada anterior não é o primeiro a recebê-lo
  -- de volta: senão, com um único corretor na fila, o mesmo lead circula nele a
  -- cada prazo vencido e infla o contador de "leads recebidos".
  select la.profile_id into v_last_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout'
  order by la.released_at desc nulls last
  limit 1;

  select q.profile_id into v_target
  from public.distribution_queue(v_group) q
  where v_last_miss is null or q.profile_id <> v_last_miss
  order by q.queue_position
  limit 1;

  -- Fila com um corretor só: o lead ainda volta para ele — o cliente aceitou
  -- isso em 30/07 —, mas no máximo 3 vezes por conta do cron. Depois fica
  -- `queued` e aparece no card de saúde da roleta em vez de rodar em laço; o
  -- gestor destrava pelo botão "Distribuir" (`p_force`), que é o único caminho
  -- que ignora o teto.
  if v_target is null and v_last_miss is not null then
    select count(*)::int into v_miss_count
    from public.lead_assignments la
    where la.lead_id = p_lead_id
      and la.profile_id = v_last_miss
      and la.release_reason = 'timeout';

    if coalesce(p_force, false) or v_miss_count < 3 then
      select q.profile_id into v_target
      from public.distribution_queue(v_group) q
      order by q.queue_position
      limit 1;
    end if;
  end if;

  if v_target is null then
    return null;
  end if;

  v_timeout := public.effective_attend_timeout(v_group);

  select coalesce(max(la.sequence), 0) + 1 into v_seq
  from public.lead_assignments la where la.lead_id = p_lead_id;

  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  values (p_lead_id, v_target, v_group, v_seq, now() + make_interval(secs => v_timeout));

  update public.leads
     set status                = 'assigned',
         assigned_to           = v_target,
         assigned_at           = now(),
         attend_deadline       = now() + make_interval(secs => v_timeout),
         distribution_group_id = v_group,
         last_activity_at      = now()
   where id = p_lead_id;

  -- Dia operacional de São Paulo (`current_work_date`, 0057), não a data do
  -- servidor: o banco está em UTC e o turno da noite acaba depois da virada.
  update public.checkins
     set leads_received = leads_received + 1
   where profile_id = v_target
     and work_date = public.current_work_date()
     and checked_out_at is null;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, null, 'assigned', v_target::text,
          jsonb_build_object('group_id', v_group, 'sequence', v_seq,
                             'timeout_seconds', v_timeout, 'misses', v_total_miss));

  return v_target;
end;
$$;
