-- =============================================================================
-- 0022 — Varredura da fila respeita o SDR
--
-- A 0020 criou assign_queued_leads() para reprocessar leads presos em 'queued'.
-- Com o desvio de SDR ligado no meta-ads-webhook, o lead em qualificação pela
-- IA também fica 'queued' (o status é da roleta; a posse temporária é da
-- conversa) — e a varredura o puxaria para a roleta no minuto seguinte,
-- atropelando a qualificação da ata 14/07. Lead com conversa SDR ativa fica
-- fora da varredura; o retorno à fila é papel do sdr_handoff.
-- =============================================================================

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
  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
      and not exists (
        select 1 from public.sdr_conversations c
        where c.lead_id = l.id and c.status = 'active'
      )
    order by l.created_at
    limit 50
  loop
    if public.assign_lead(v_lead) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;
