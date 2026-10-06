-- =============================================================================
-- 0234 · close_lead limpa assigned_to quando lead é perdido/descartado
--
-- Pedido de 06/10/2026: ao encerrar um lead como perdido ou descartado, ele
-- continua aparecendo na base do corretor porque `assigned_to` não era limpo.
-- O corretor via o lead "perdido" na lista e achava que ainda precisava agir.
--
-- A RPC `close_lead` (0074) já limpava `attend_deadline` e `next_action_at`,
-- mas deixava `assigned_to` intacto. Sem ele nulo, o lead encerrado continuava
-- vinculado ao corretor e aparecia nos filtros "meus leads".
--
-- Correção: adicionar `assigned_to = null` no UPDATE da RPC.
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
         -- Mantém a correção da 0226: a constraint só aceita `lost_at` no
         -- status perdido; descartado guarda o motivo, mas não essa data.
         lost_at          = case when p_status = 'lost' then now() end,
         attend_deadline  = null,
         -- Sai da conta de `overdue_lead_count` porque o status deixa de ser
         -- de operação; zerar o prazo aqui é o que impede o lead encerrado de
         -- reaparecer como atrasado se algum dia voltar.
         next_action_at   = null,
         -- 0234: limpa o vínculo com o corretor. Sem isso, o lead perdido
         -- continuava aparecendo na base do corretor como se ainda fosse dele.
         assigned_to      = null,
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
  'legítima da contagem de atrasados que bloqueia o check-in em 20. Limpa '
  'assigned_to para o lead sair da base do corretor (0234).';

revoke all on function public.close_lead(uuid, public.lead_status, text) from public;
grant execute on function public.close_lead(uuid, public.lead_status, text) to authenticated;

-- Sem este recorte, limpar `assigned_to` transformaria perdido/descartado em
-- "lead sem dono" e o corretor voltaria a enxergá-lo pelo ramo da fila. A base
-- histórica continua disponível para gestão, mas sai definitivamente da base
-- operacional do corretor que encerrou.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    (assigned_to in (select public.auth_visible_profiles())
      and ((select public.has_any_role('admin', 'partner', 'director', 'manager', 'cca', 'sdr', 'marketing'))
           or coalesce(assigned_at, created_at) >= (select public.leads_recomeco())))
    or (assigned_to is null
      and status in ('queued', 'assigned', 'attending', 'in_progress')
      and (select public.has_permission('leads.view_queue'))
      and (distribution_group_id in (select public.auth_distribution_group_ids())
        or (distribution_group_id is null
          and (form_id is null or form_id not in (
            select f.form_id from public.distribution_group_forms f
             where f.group_id not in (select public.auth_distribution_group_ids())
          )))))
    or (assigned_to is null
      and status in ('converted', 'lost', 'discarded')
      and (select public.has_any_role('admin', 'partner', 'director', 'manager', 'cca', 'sdr', 'marketing')))
  );
