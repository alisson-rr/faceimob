-- =============================================================================
-- 0323 · Avisos de lead novo por WhatsApp, por dia (tela de custo)
--
-- Pedido de 07/11/2026: medir se o aviso de lead novo por WhatsApp vale o que
-- custa. O custo e a entrega vêm da Meta (edge `whatsapp-custos`); daqui sai o
-- lado do CRM: quantos avisos a Meta aceitou, quantos falharam e quantos não
-- saíram por falta de telefone.
--
-- `notifications` não é legível por admin pela API (a policy só mostra o
-- `in_app` do próprio usuário), por isso a função é security definer com a
-- mesma porta da fila de notificações (`settings.integrations`). Só contagens:
-- nenhum título, corpo ou destinatário sai daqui.
-- =============================================================================

create or replace function public.whatsapp_avisos_por_dia(p_dias integer default 30)
returns table (
  dia         date,
  enviados    bigint,
  falhas      bigint,
  sem_telefone bigint,
  esperando   bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias integer := least(greatest(coalesce(p_dias, 30), 1), 90);
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para ver os avisos de WhatsApp.' using errcode = '42501';
  end if;

  return query
  select (n.created_at at time zone 'America/Sao_Paulo')::date                          as dia,
         count(*) filter (where n.sent_at is not null and n.last_error is null)          as enviados,
         count(*) filter (where n.last_error is not null
                            and n.last_error <> 'perfil sem telefone')                   as falhas,
         count(*) filter (where n.last_error = 'perfil sem telefone')                    as sem_telefone,
         count(*) filter (where n.sent_at is null and n.last_error is null)              as esperando
    from public.notifications n
   where n.channel = 'whatsapp'
     and n.kind = 'lead_assigned'
     and n.created_at >= (now() at time zone 'America/Sao_Paulo')::date - (v_dias - 1)
   group by 1
   order by 1;
end;
$$;

comment on function public.whatsapp_avisos_por_dia(integer) is
  'Avisos de lead novo por WhatsApp por dia (fuso de São Paulo): aceitos pela Meta, com falha, sem telefone e esperando. Só contagens. Exige settings.integrations. Janela de 1 a 90 dias.';

revoke all on function public.whatsapp_avisos_por_dia(integer) from public, anon;
grant execute on function public.whatsapp_avisos_por_dia(integer) to authenticated;
