-- =============================================================================
-- 0225 — CCA: coluna PENDENTE C/ RESTRIÇÃO, aviso da trava e INCOMPLETO
--
-- Reclamações da CCA (Thayse) em 05/10/2026, decididas pelo cliente:
--   1. Em análise o Status 2 continua mudando só pelo quadro Esteira CCA (com
--      mensagem, histórico e e-mail). Faltava a coluna para "pendenciar com
--      restrição": entra "PENDENTE C/ RESTRIÇÃO", logo depois de PENDENTE e com
--      a mesma mecânica (pending_documents), gravando esse Status 2.
--   2. O aviso da trava dizia à própria CCA para esperar "o CCA decidir o caso".
--      Para quem é CCA ele passa a apontar o quadro. A regra não muda.
--   3. "INCOMPLETO" não tinha linha de permissão para a CCA (Status 2 sem linha
--      é só do admin): ela não tirava ninguém de lá. Passa a entrar e sair.
-- =============================================================================

-- 1. A coluna, uma vez só (o nome é a chave, como na 0150).
do $$
declare
  v_pos    int;
  v_status uuid;
begin
  if exists (select 1 from public.cca_stages
              where public.cca_stage_name_key(name) = public.cca_stage_name_key('PENDENTE C/ RESTRIÇÃO')) then
    return;
  end if;
  select position into v_pos from public.cca_stages
   where active and public.cca_stage_name_key(name) = 'PENDENTE'
   order by position limit 1;
  v_pos := coalesce(v_pos, (select max(position) from public.cca_stages where active and position < 100));
  select id into v_status from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare('PENDENTE C/ RESTRIÇÃO')
   order by active desc limit 1;

  -- Entra na posição de PENDENTE e o quadro é renumerado na mesma ordem, com a
  -- nova logo depois dela (também desfaz posições repetidas que já existiam).
  insert into public.cca_stages (name, color, position, status, active, deal_status_id)
  values ('PENDENTE C/ RESTRIÇÃO', 'danger', v_pos, 'pending_documents', true, v_status);
  with ordem as (
    select id, row_number() over (
             order by position, (name = 'PENDENTE C/ RESTRIÇÃO'), name) as nova
      from public.cca_stages
     where active and position < 100
  )
  update public.cca_stages s set position = o.nova
    from ordem o
   where s.id = o.id and s.position is distinct from o.nova;
end;
$$;

-- 2. Mesmo gatilho da 0181; só o texto do aviso muda para quem é CCA.
create or replace function public.deals_guard_esteira_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new     text := public.deal_status_bare(new.status_detail);
  v_old     text := case when tg_op = 'UPDATE' then public.deal_status_bare(old.status_detail) else '' end;
  v_priv    boolean := current_user in ('postgres', 'service_role');
  v_sistema constant text[] := array['ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANÁLISE P/ VIRAR NEGÓCIO'];
begin
  if tg_op = 'UPDATE' and new.status_detail is not distinct from old.status_detail then
    return new;
  end if;

  if v_priv then
    return new;
  end if;

  if v_new = any (v_sistema) then
    raise exception
      'O rótulo "%" é escrito pelo sistema quando o negócio entra na esteira. Aprove a conferência documental em vez de marcá-lo.',
      new.status_detail
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and not public.is_admin()
     and v_new not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF')
     and exists (
       select 1 from public.cca_cases c
         left join public.cca_stages s on s.id = c.stage_id
         left join public.deal_statuses ds on ds.id = s.deal_status_id
        where c.deal_id = new.id
          and c.status in ('under_review', 'pending_documents')
          and (v_old = any (v_sistema)
               or (ds.value is not null and public.deal_status_bare(ds.value) = v_old))
     ) then
    if public.has_role('cca') then
      raise exception
        'Negócio em análise: mude o Status 2 pelo quadro Esteira CCA, movendo o card para a coluna do status (com a mensagem).'
        using errcode = 'P0001';
    end if;
    raise exception
      'O negócio está na esteira de crédito: o Status 2 volta a ser editável quando o CCA decidir o caso.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.deals_guard_esteira_label() is
  'Protege os rótulos de envio e trava o Status 2 durante a análise (admin e sócio passam); para a CCA o aviso aponta o quadro Esteira CCA (0225).';

-- 3. INCOMPLETO: a CCA coloca e tira.
insert into public.deal_status_permissions (status_id, role, can_enter, can_exit)
select s.id, 'cca', true, true
  from public.deal_statuses s
 where public.deal_status_bare(s.value) = 'INCOMPLETO'
on conflict (status_id, role) do update set can_enter = true, can_exit = true, updated_at = now();
