-- =============================================================================
-- 0303 · Todo contato do WhatsApp vira lead na roleta, menos os números da casa
--
-- Pedido de 24/10/2026: "traga todos os leads que chamam no WhatsApp para a
-- roleta, com exceção de 3 números que recebem o relatório, inclusive não
-- quero que a IA responda estes números". Antes só o "clique para o WhatsApp"
-- de anúncio virava lead; o número desconhecido sem anúncio caía em
-- `unmatched`. O `whatsapp-inbound-webhook` passa a criar o lead para todo
-- número desconhecido e ignora os três números da casa (lista em `parse.ts`).
--
--   · origem "WhatsApp · Direto" (sem agente de IA: vai direto para a roleta);
--   · desfecho `ignorado` no registro de mensagens recebidas, para a mensagem
--     dos números da casa ficar registrada sem acionar o sino.
-- =============================================================================

insert into public.lead_sources (code, label, channel, active)
values ('whatsapp_direto', 'WhatsApp · Direto', 'whatsapp', true)
on conflict (code) do nothing;

alter table public.whatsapp_inbound_messages drop constraint if exists whatsapp_inbound_outcome_check;
alter table public.whatsapp_inbound_messages add constraint whatsapp_inbound_outcome_check check (
  outcome in ('sdr_turn', 'remarketing_lead', 'unmatched', 'agent_error', 'human_turn', 'audio_falhou', 'ignorado')
);

comment on column public.whatsapp_inbound_messages.outcome is
  'sdr_turn = turno do robô; remarketing_lead = virou lead; unmatched = ninguém soube rotear; agent_error = o turno ou a abertura do atendimento falhou; human_turn = entrou numa conversa que o robô não atende (0120); audio_falhou = áudio que não transcreveu, e a conversa foi para humano (0120); ignorado = número da casa que recebe o relatório, sem lead nem IA (0303).';
