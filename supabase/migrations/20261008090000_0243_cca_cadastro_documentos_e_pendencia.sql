-- =============================================================================
-- 0243 · Cadastro CCA, anexos múltiplos e contrato com pendência
-- =============================================================================

-- Negócio nascido de lead mantém uma origem operacional única, independente da
-- campanha/origem publicitária do lead (que continua registrada no próprio lead).
create or replace function public.deals_origin_from_lead()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.lead_id is not null then new.lead_origin := 'Lead Faceimob'; end if;
  return new;
end;
$$;

drop trigger if exists deals_aa_origin_from_lead on public.deals;
create trigger deals_aa_origin_from_lead
  before insert or update of lead_id, lead_origin on public.deals
  for each row execute function public.deals_origin_from_lead();

update public.deals set lead_origin = 'Lead Faceimob'
 where lead_id is not null and lead_origin is distinct from 'Lead Faceimob';

-- A interface aponta o campo exato, e o banco impede que importações/RPCs
-- contornem a mesma regra. Registros antigos inválidos continuam editáveis
-- enquanto CPF/PIS não forem alterados.
create or replace function public.deal_clients_validate_documents()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' or new.cpf is distinct from old.cpf)
     and nullif(btrim(coalesce(new.cpf, '')), '') is not null
     and length(regexp_replace(new.cpf, '\D', '', 'g')) <> 11 then
    raise exception 'CPF deve ter exatamente 11 números.' using errcode = 'P0001';
  end if;
  if (tg_op = 'INSERT' or new.pis is distinct from old.pis)
     and nullif(btrim(coalesce(new.pis, '')), '') is not null
     and length(regexp_replace(new.pis, '\D', '', 'g')) <> 11 then
    raise exception 'PIS deve ter exatamente 11 números.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists deal_clients_validate_documents on public.deal_clients;
create trigger deal_clients_validate_documents
  before insert or update of cpf, pis on public.deal_clients
  for each row execute function public.deal_clients_validate_documents();

-- Campos solicitados pelo CCA. Identificação aceita mais de um comprador.
insert into public.document_types
  (code, label, category, required_for_conversion, allows_multiple, naming_pattern, sort_order, active)
values
  ('cnh', 'CNH', 'identificacao', false, true, '{tipo}-{cliente}-{data}', 2, true),
  ('fator_social', 'Fator Social', 'social', false, true, '{tipo}-{cliente}-{data}', 9, true)
on conflict (code) do update set
  label = excluded.label, category = excluded.category,
  allows_multiple = true, active = true;

-- Todo campo aceita os documentos dos dois compradores (e outros integrantes),
-- sem transformar o segundo arquivo em “nova versão” do primeiro.
update public.document_types set allows_multiple = true;

-- Qualquer usuário que enxerga o negócio pode corrigir um anexo errado. O
-- acesso continua limitado ao escopo da equipe/diretoria por can_see_deal().
drop policy if exists deal_documents_delete on public.deal_documents;
create policy deal_documents_delete on public.deal_documents
  for delete to authenticated
  using (public.can_see_deal(deal_id) or public.has_role('cca'));

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists deal_documents_storage_delete on storage.objects';
  execute $policy$
    create policy deal_documents_storage_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'deal-documents'
        and (
          (public.deal_id_of_object(storage.objects.name) is not null
           and public.can_see_deal(public.deal_id_of_object(storage.objects.name)))
          or exists (
            select 1 from public.deal_documents d
             where d.storage_path = storage.objects.name
               and (public.can_see_deal(d.deal_id) or public.has_role('cca'))
          )
          or public.has_role('cca')
        )
      )
  $policy$;
end $$;

-- O selo precisa sobreviver depois que Status 2 deixa de dizer “com
-- pendências”. Ele é histórico do contrato, não uma inferência da tela.
alter table public.deals
  add column if not exists contract_has_pending_issue boolean not null default false;

create or replace function public.deals_mark_contract_pending()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and public.deal_status_bare(old.status_detail) = 'VIROU NEGÓCIO COM PENDÊNCIAS'
     and public.deal_status_bare(new.status_detail) = 'EM CONTRATO' then
    new.contract_has_pending_issue := true;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_aa_mark_contract_pending on public.deals;
create trigger deals_aa_mark_contract_pending
  before update of status_detail on public.deals
  for each row execute function public.deals_mark_contract_pending();

-- Exceção estrita: apenas o caminho solicitado ganha entrada em EM CONTRATO.
-- As demais transições continuam na matriz configurável.
create or replace function public.deal_status_move_block(p_from text, p_to text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_from public.deal_statuses;
  v_to public.deal_statuses;
begin
  if public.is_admin() then return null; end if;
  if public.deal_status_bare(p_from) = 'REPROVADO' and public.deal_status_bare(p_to) = 'OFF' then return null; end if;
  if public.deal_status_bare(p_from) = 'ANÁLISE EXTERNA'
     and public.deal_status_bare(p_to) in ('APROV. TOTAL', 'APROV. COND.')
     and public.has_any_role('manager', 'director') then return null; end if;
  if public.deal_status_bare(p_from) = 'VIROU NEGÓCIO COM PENDÊNCIAS'
     and public.deal_status_bare(p_to) = 'EM CONTRATO'
     and public.has_any_role('broker', 'manager', 'director', 'cca') then return null; end if;

  select * into v_to from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_to)
   order by active desc limit 1;
  if not found then return 'Este Status 2 não está no cadastro.'; end if;
  select * into v_from from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_from)
   order by active desc limit 1;
  if v_from.id is not null and v_from.id <> v_to.id and not exists (
    select 1 from public.deal_status_permissions p where p.status_id = v_from.id
      and p.can_exit and public.has_any_role(p.role)
  ) then return format('Seu perfil não tira o negócio de "%s".', v_from.label); end if;
  if not exists (
    select 1 from public.deal_status_permissions p where p.status_id = v_to.id
      and p.can_enter and public.has_any_role(p.role)
  ) then return format('Seu perfil não coloca o negócio em "%s".', v_to.label); end if;
  return null;
end;
$$;
revoke all on function public.deal_status_move_block(text, text) from public, anon;
grant execute on function public.deal_status_move_block(text, text) to authenticated, service_role;
