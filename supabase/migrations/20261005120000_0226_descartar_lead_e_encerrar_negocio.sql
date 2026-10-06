-- =============================================================================
-- 0226 — descartar lead e encerrar negócio voltam a funcionar
--
-- Reclamações de 05/10/2026 (Victor):
--   1. "Descartado como encerrar não está funcionando": `close_lead` gravava
--      `lost_at` também no descartado, e `leads_lost_consistency` (0005) só
--      aceita `lost_at` quando o status é "lost" — todo descarte caía com "um
--      dos campos está fora do valor permitido". `lost_at` passa a ser só do
--      perdido; o motivo continua em `lost_reason` e no evento 'closed'.
--   2. "Todos legados não consigo dar off": o diálogo "Encerrar negócio" grava
--      o Status 2 com a observação em `lost_reason`, mas o gatilho
--      `deals_guard_status_detail` recusava todo Status 2 com observação
--      obrigatória ("mova o negócio pelo Pipeline") — e `move_deal_status` por
--      sua vez manda encerrar pelo diálogo. Quando a mesma gravação traz a
--      observação em `lost_reason`, a exigência está cumprida.
-- =============================================================================

create or replace function public.close_lead(
  p_lead_id uuid,
  p_status public.lead_status,
  p_reason text
)
returns public.leads
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lead   public.leads;
  v_before public.lead_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('lost', 'discarded') then
    raise exception 'Encerrar um lead aceita só "perdido" ou "descartado".'
      using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'O motivo é obrigatório para encerrar um lead.'
      using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if not public.can_write_lead(p_lead_id) then
    raise exception 'Sem permissão para encerrar este lead.' using errcode = '42501';
  end if;

  if v_lead.converted_deal_id is not null then
    raise exception 'Este lead já virou negócio: encerre o negócio no Pipeline.'
      using errcode = 'P0001';
  end if;

  if v_lead.status in ('lost', 'discarded') then
    raise exception 'Este lead já está encerrado.' using errcode = 'P0001';
  end if;

  v_before := v_lead.status;

  -- A trava de atendimento morre junto: o lead encerrado não pode continuar
  -- correndo contra o relógio de ninguém.
  update public.lead_assignments
     set released_at = now(), release_reason = 'manual'
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = p_status,
         lost_reason      = v_reason,
         -- 0226: `leads_lost_consistency` só aceita lost_at no "perdido".
         lost_at          = case when p_status = 'lost' then now() end,
         attend_deadline  = null,
         -- Sai da conta de `overdue_lead_count` porque o status deixa de ser
         -- de operação; zerar o prazo aqui é o que impede o lead encerrado de
         -- reaparecer como atrasado se algum dia voltar.
         next_action_at   = null,
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  -- O gatilho `leads_log_changes` (0005) já grava um `status_changed` sempre que
  -- `leads.status` muda. Repetir o mesmo evento aqui gravava DOIS: a aba
  -- Histórico mostrava a linha duplicada e o relatório "quantos perdemos por
  -- preço" — a razão de a lista de motivos ser fixa — contava em dobro. O que
  -- só existe aqui é o MOTIVO, então ele entra como evento próprio, sem
  -- reescrever o log do gatilho (que é imutável por contrato).
  insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value, detail)
  values (p_lead_id, auth.uid(), 'closed', v_before::text, p_status::text,
          jsonb_build_object('reason', v_reason));

  return v_lead;
end;
$$;

comment on function public.close_lead(uuid, public.lead_status, text) is
  'Encerra o lead como perdido ou descartado com motivo obrigatório. É a saída '
  'legítima da contagem de atrasados que bloqueia o check-in em 20.';

revoke all on function public.close_lead(uuid, public.lead_status, text) from public, anon;
grant execute on function public.close_lead(uuid, public.lead_status, text) to authenticated;

create or replace function public.deals_guard_status_detail()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_block text;
begin
  if current_user in ('postgres', 'service_role') or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and public.deal_status_bare(new.status_detail) is not distinct from public.deal_status_bare(old.status_detail) then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.status_detail is null or public.deal_status_bare(new.status_detail) = 'PROPOSTA') then return new; end if;
  if not public.has_permission('deals.edit_status_detail') then
    raise exception 'Seu perfil não pode alterar o Status 2.' using errcode = '42501',
      hint = 'Permissão Alterar Status 2, em Administração → Permissões → Funcionalidades.';
  end if;

  v_block := public.deal_status_move_block(case when tg_op = 'UPDATE' then old.status_detail end, new.status_detail);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;

  -- 0226: encerrar pelo diálogo de perda já traz a observação em `lost_reason`.
  if exists (select 1 from public.deal_statuses s
              where public.deal_status_bare(s.value) = public.deal_status_bare(new.status_detail)
                and s.requires_note)
     and not (nullif(btrim(coalesce(new.lost_reason, '')), '') is not null
              and (tg_op = 'INSERT' or new.lost_reason is distinct from old.lost_reason)) then
    raise exception 'Este Status 2 pede uma observação: mova o negócio pelo Pipeline.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.deals_guard_status_detail() from public, anon, authenticated;
