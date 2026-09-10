-- Sprint 3: origens do SDR, importação atômica de remarketing e métricas de campanha.

-- O SDR administra agentes e listas no mesmo módulo; também precisa cadastrar a
-- origem que escolhe esses agentes. Templates continuam editáveis só por
-- admin/marketing, mas podem ser lidos e vinculados pelo SDR.
drop policy if exists lead_sources_write on public.lead_sources;
create policy lead_sources_write on public.lead_sources
  for all to authenticated
  using (public.has_any_role('admin','marketing','sdr'))
  with check (public.has_any_role('admin','marketing','sdr'));

-- Cria lista e contatos na mesma transação. Qualquer telefone inválido dispara
-- o trigger existente e desfaz também a lista, evitando rascunho órfão.
create or replace function public.import_remarketing_list(
  p_name text,
  p_template_id uuid default null,
  p_agent_id uuid default null,
  p_contacts jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_list_id uuid;
begin
  if not public.has_any_role('admin','marketing','sdr') then
    raise exception 'Papel sem permissão para importar lista de remarketing'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Nome da lista obrigatório' using errcode = '22023';
  end if;
  if jsonb_typeof(p_contacts) <> 'array' or jsonb_array_length(p_contacts) = 0 then
    raise exception 'A lista precisa ter ao menos um contato' using errcode = '22023';
  end if;

  insert into public.remarketing_lists (name, template_id, agent_id, status, created_by)
  values (btrim(p_name), p_template_id, p_agent_id, 'draft', auth.uid())
  returning id into v_list_id;

  insert into public.remarketing_contacts (list_id, full_name, phone, extra)
  select
    v_list_id,
    nullif(btrim(contact.full_name), ''),
    contact.phone,
    coalesce(contact.extra, '{}'::jsonb)
  from jsonb_to_recordset(p_contacts) as contact(full_name text, phone text, extra jsonb);

  return v_list_id;
end;
$$;

revoke all on function public.import_remarketing_list(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_remarketing_list(text, uuid, uuid, jsonb) to authenticated, service_role;

-- Marketing precisa do agregado completo, inclusive depois que o lead foi
-- distribuído. A função não expõe dados pessoais nem amplia o SELECT de leads.
create or replace function public.marketing_campaign_stats()
returns table (campaign_id text, leads int, conversions int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin','director','partner','marketing') then
    raise exception 'Papel sem permissão para métricas de marketing'
      using errcode = '42501';
  end if;

  return query
  select
    l.campaign_id,
    count(*)::int,
    count(*) filter (where l.converted_deal_id is not null)::int
  from public.leads l
  where l.campaign_id is not null
  group by l.campaign_id;
end;
$$;

revoke all on function public.marketing_campaign_stats() from public, anon;
grant execute on function public.marketing_campaign_stats() to authenticated, service_role;
