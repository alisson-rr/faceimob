-- =============================================================================
-- 0335 · WhatsApp: lead que chega só pelo nome de usuário (BSUID) e nada some
--
-- Investigação de 14/11/2026: desde 07/11 o webhook grava 4–11 mensagens por
-- dia contra ~25 conversas/dia na Meta. O parse descartava em silêncio (200
-- para a Meta, sem log, sem linha) a mensagem sem `from` — e a Meta omite o
-- `from` de quem usa nome de usuário e nunca falou com a empresa, mandando só o
-- BSUID (`from_user_id`). Exatamente quem clica no anúncio pela primeira vez.
--
-- Decisões do Douglas (14/11/2026):
--  1. lead criado na hora, com anúncio, campanha, ctwa_clid e o BSUID;
--  2. o robô pede o telefone pelo BSUID (`recipient`);
--  3. telefone respondido entra no lead e segue a roleta normal;
--  4. sem telefone em 15 min, a roleta entrega mesmo assim, com a marca
--     "sem telefone · atender pelo chat do CRM";
--  5. quem volta depois com o telefone casa pelo BSUID, sem duplicar.
-- E: toda mensagem fica registrada (inclusive a descartada, com o payload cru)
-- e o POST recusado (assinatura, segredo, JSON) também deixa rastro.
-- =============================================================================

-- Lead: o BSUID de quem escreveu no WhatsApp.
alter table public.leads add column if not exists whatsapp_user_id text;
comment on column public.leads.whatsapp_user_id is
  'BSUID do WhatsApp (from_user_id): id do usuário no escopo da empresa. Único caminho para responder quem chega só pelo nome de usuário (0335).';
create index if not exists leads_whatsapp_user_id_idx
  on public.leads (whatsapp_user_id) where whatsapp_user_id is not null;

-- Registro bruto: telefone pode faltar; BSUID e payload cru do descarte.
alter table public.whatsapp_inbound_messages alter column from_phone drop not null;
alter table public.whatsapp_inbound_messages add column if not exists from_user_id text;
alter table public.whatsapp_inbound_messages add column if not exists payload jsonb;
comment on column public.whatsapp_inbound_messages.payload is
  'Mensagem crua da Meta, só para o que não virou atendimento (descartado_*), para investigar o formato (0335).';

alter table public.whatsapp_inbound_messages drop constraint if exists whatsapp_inbound_outcome_check;
alter table public.whatsapp_inbound_messages add constraint whatsapp_inbound_outcome_check check (
  outcome in ('sdr_turn', 'remarketing_lead', 'unmatched', 'agent_error', 'human_turn', 'audio_falhou', 'ignorado',
              'descartado_sem_telefone', 'descartado_tipo_desconhecido')
);
comment on column public.whatsapp_inbound_messages.outcome is
  'sdr_turn = turno do robô; remarketing_lead = virou lead; unmatched = ninguém soube rotear; agent_error = o turno ou a abertura do atendimento falhou; human_turn = entrou numa conversa que o robô não atende (0120); audio_falhou = áudio que não transcreveu (0120); ignorado = número da casa (0303); descartado_sem_telefone = sem telefone nem BSUID ou sem id (0335); descartado_tipo_desconhecido = reação ou aviso de sistema, que não é fala (0335).';

-- POSTs recusados pelo webhook: só o motivo e o tamanho (o corpo não é confiável).
create table if not exists public.whatsapp_webhook_recusas (
  id         uuid primary key default gen_random_uuid(),
  motivo     text not null check (motivo in ('assinatura_invalida', 'segredo_ausente', 'json_invalido')),
  bytes      int,
  created_at timestamptz not null default now()
);
comment on table public.whatsapp_webhook_recusas is
  'POST do whatsapp-inbound-webhook recusado antes de ler as mensagens (0335): sem isso a recusa só existia no log da VPS.';
alter table public.whatsapp_webhook_recusas enable row level security;
drop policy if exists whatsapp_webhook_recusas_select on public.whatsapp_webhook_recusas;
create policy whatsapp_webhook_recusas_select on public.whatsapp_webhook_recusas
  for select to authenticated using (public.is_admin());
revoke all on public.whatsapp_webhook_recusas from anon;
grant select on public.whatsapp_webhook_recusas to authenticated;

-- Dreno da roleta: o lead só com BSUID espera 15 min pelo telefone (decisão 4).
create or replace function public.assign_queued_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_done int := 0;
begin
  -- 0315: o bloqueio entra na ordem da fila, então é registrado antes de girar.
  perform public.fila_registrar_bloqueios();
  -- 0330: conversa da IA parada há 24 h solta o lead de compra para a roleta.
  perform public.sdr_entregar_conversas_paradas();

  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
      and not exists (
        select 1 from public.sdr_conversations c
        where c.lead_id = l.id and c.status = 'active'
      )
      -- 0335: chegou só pelo nome de usuário; o robô pediu o telefone.
      and not (l.phone is null and l.whatsapp_user_id is not null
               and l.created_at > now() - interval '15 minutes')
    order by l.created_at, l.id
  loop
    if public.assign_lead(v_lead) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.assign_queued_leads() from public, anon, authenticated;
grant execute on function public.assign_queued_leads() to service_role;
