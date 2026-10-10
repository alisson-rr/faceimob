-- =============================================================================
-- 0256 — Luna cadastrada e origens dos anúncios de WhatsApp ligadas aos agentes.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
begin
  if not exists (select 1 from public.sdr_agents where name = 'Luna' and active and max_turns = 18) then
    raise exception 'FALHOU: agente Luna devia existir, ativo, com 18 respostas';
  end if;
  raise notice '  ok  Luna cadastrada';

  if (select sdr_agent_id from public.lead_sources where code = 'whatsapp_vaga_corretor')
     is distinct from (select id from public.sdr_agents where name = 'Luna') then
    raise exception 'FALHOU: anúncio VAGA CORRETOR devia ir para a Luna';
  end if;
  if (select form_id from public.lead_sources where code = 'whatsapp_aprova_na_hora') <> '120252702946200042' then
    raise exception 'FALHOU: origem do APROVA NA HORA devia casar pelo ID do anúncio';
  end if;
  raise notice '  ok  origens dos anúncios casam pelo ID e apontam o agente';
end;
$$;

rollback;
