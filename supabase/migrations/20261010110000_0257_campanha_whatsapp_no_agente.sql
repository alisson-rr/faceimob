-- =============================================================================
-- 0257 · Campanha de WhatsApp ligada ao agente pelo nome
--
-- Pedido de 10/10/2026: "trazer o nome da campanha e vincular ao agente". A
-- origem por ID de anúncio (0256) obrigava cadastrar cada anúncio novo. Agora a
-- origem pode apontar a CAMPANHA (`campaign_external_id`, o id da Meta): todo
-- anúncio dela segue o agente escolhido. O webhook descobre a campanha do
-- anúncio na Meta e procura, nesta ordem: campanha → anúncio → origem geral.
--
-- A lista das campanhas sai de `ad_campaigns` (meta-sync, de hora em hora ou
-- pelo "Atualizar"), cuja leitura é de quem vê finanças; a aba SDR IA → Origens
-- lê por esta RPC, só os campos que precisa, para quem já edita as origens.
-- =============================================================================

alter table public.lead_sources add column if not exists campaign_external_id text;

create unique index if not exists lead_sources_campaign_idx
  on public.lead_sources (campaign_external_id) where campaign_external_id is not null;

comment on column public.lead_sources.campaign_external_id is
  'Id da campanha na Meta (0257): lead de anúncio clique-para-WhatsApp desta campanha entra por esta origem e segue o agente dela.';

create or replace function public.campanhas_whatsapp()
returns table (
  external_id   text,
  name          text,
  status        text,
  source_id     uuid,
  sdr_agent_id  uuid,
  synced_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin', 'marketing', 'sdr') then
    raise exception 'Sem permissão para ver as campanhas de WhatsApp.' using errcode = '42501';
  end if;

  return query
  select c.external_id, c.name, coalesce(c.meta_effective_status, c.status), s.id, s.sdr_agent_id, c.synced_at
    from public.ad_campaigns c
    left join public.lead_sources s on s.campaign_external_id = c.external_id
   -- 'misto' entra: tem conjunto de WhatsApp junto com formulário ou site.
   where c.meta_channel in ('whatsapp', 'misto') and c.external_id is not null
   order by (coalesce(c.meta_effective_status, c.status) = 'ACTIVE') desc, c.name;
end;
$$;

revoke all on function public.campanhas_whatsapp() from public, anon;
grant execute on function public.campanhas_whatsapp() to authenticated, service_role;
