-- =============================================================================
-- 0313 — "Mandar para a roleta" a partir da conversa do SDR.
-- =============================================================================
-- Pedido de 30/10/2026: conversas que a IA passou para humano e ninguém
-- assumiu ("Sem responsável") ficavam paradas, com o lead fora da fila. O
-- botão devolve o lead à roleta, que escolhe o corretor pelas mesmas regras de
-- um lead novo (grupo, turno, horário, trava de atendimento).
--
-- Por que não chamar o `sdr_handoff` direto da tela: ele zera `assigned_to` sem
-- olhar o status, e tiraria o lead de um corretor que já está atendendo.
--
-- Lead que já está com corretor ou já virou negócio é recusado: o botão nunca
-- tira lead de quem está atendendo. Para isso existe o repasse manual.

create or replace function public.sdr_mandar_para_roleta(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.sdr_conversations;
  v_lead public.leads;
begin
  -- Os mesmos papéis que assumem e resolvem a conversa (WRITE_ROLES do SDR).
  if not public.has_any_role('admin', 'marketing', 'sdr') then
    raise exception 'Sem permissão para mandar leads para a roleta.' using errcode = '42501';
  end if;

  select * into v_conv from public.sdr_conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  -- Com a IA atendendo, o dreno da fila pula o lead de propósito; conversa já
  -- entregue não tem o que mandar de novo.
  if v_conv.status = 'active' then
    raise exception 'A IA ainda está atendendo esta conversa.' using errcode = 'P0001';
  end if;
  if v_conv.status = 'handed_off' then
    raise exception 'Esta conversa já foi entregue à roleta.' using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = v_conv.lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.utm_source = 'sdr_playground' then
    raise exception 'Lead de teste do Playground não vai para a roleta.' using errcode = 'P0001';
  end if;

  if v_lead.status = 'converted' then
    raise exception 'Este lead já virou negócio.' using errcode = 'P0001';
  end if;

  if v_lead.status in ('assigned', 'attending', 'in_progress') then
    raise exception 'Este lead já está com um corretor.' using errcode = 'P0001';
  end if;

  -- Encerrado (perdido/descartado): desfaz o que o `close_lead` preencheu, na
  -- mesma linha que tira o status. O check da 0005 amarra `lost_at` ao status
  -- 'lost' nos dois sentidos, e o handoff abaixo não toca nessas colunas.
  if v_lead.status in ('lost', 'discarded') then
    update public.leads
       set status = 'queued',
           lost_reason = null,
           lost_at = null,
           next_action_at = null
     where id = v_lead.id;
  end if;

  -- O mesmo caminho do robô quando termina sem qualificar: grupo de entrega do
  -- agente, lead para 'queued', `assign_lead` e conversa 'handed_off'. Fora do
  -- horário ou sem corretor livre, devolve nulo e o cron `faceimob-assign-queued`
  -- entrega assim que der.
  return public.sdr_handoff(p_conversation_id, 'exhausted');
end;
$$;

revoke all on function public.sdr_mandar_para_roleta(uuid) from public, anon;
grant execute on function public.sdr_mandar_para_roleta(uuid) to authenticated;

comment on function public.sdr_mandar_para_roleta is
  'Devolve à roleta o lead de uma conversa do SDR sem corretor. Recusa lead com corretor ou convertido. Devolve o corretor que recebeu, ou nulo se ficou na fila (0313).';
