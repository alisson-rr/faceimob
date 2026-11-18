-- =============================================================================
-- 0343 · Repasse de leads de quem saiu (admin e sócio)
--
-- Pedido de 18/11/2026: o mesmo repasse dos negócios (0327/0328), agora para
-- leads. Lista os leads EM ATENDIMENTO (assigned, attending, in_progress) de
-- quem está desligado ou suspenso e passa os escolhidos a um corretor ativo.
-- O repasse em si é o `reassign_lead` (0275) de sempre, lead a lead: sem
-- cronômetro, próxima ação preservada ou no padrão, histórico com os nomes.
-- A lista volta em jsonb: em função que devolve linhas o PostgREST corta em
-- 1.000 (0342), e a carteira de quem saiu passa disso.
-- =============================================================================

create or replace function public.leads_de_corretores_inativos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin') then
    raise exception 'Só o administrador repassa leads.' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'lead_id', l.id,
             'cliente', l.full_name,
             'telefone', coalesce(nullif(btrim(l.phone), ''), l.phone_raw),
             'campanha', coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), '')),
             'status', l.status,
             'criado_em', l.created_at,
             'corretor_id', p.id,
             'corretor_nome', p.full_name,
             'corretor_status', p.status::text
           ) order by p.full_name, l.created_at desc), '[]'::jsonb)
      from public.leads l
      join public.profiles p on p.id = l.assigned_to and p.status <> 'active'
     where l.status in ('assigned', 'attending', 'in_progress')
  );
end;
$$;
comment on function public.leads_de_corretores_inativos() is
  'Leads em atendimento de corretor desligado ou suspenso, para o repasse (0343). Só admin/sócio. jsonb para não sofrer o teto de 1.000 linhas.';
revoke all on function public.leads_de_corretores_inativos() from public, anon;
grant execute on function public.leads_de_corretores_inativos() to authenticated;

create or replace function public.repassar_leads(p_de uuid, p_para uuid, p_lead_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_feitos integer := 0;
begin
  if not public.has_any_role('admin') then
    raise exception 'Só o administrador repassa leads.' using errcode = '42501';
  end if;
  if p_de is null or p_para is null or p_de = p_para then
    raise exception 'Escolha o corretor de origem e um corretor de destino diferente.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_lead_ids, 1), 0) = 0 then
    raise exception 'Escolha ao menos um lead.' using errcode = '22023';
  end if;
  if array_length(p_lead_ids, 1) > 5000 then
    raise exception 'Repasse no máximo 5.000 leads por vez.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = p_de and status = 'active') then
    raise exception 'O corretor de origem ainda está ativo: o repasse é para quem saiu.' using errcode = '22023';
  end if;

  for v_lead in
    select l.id from public.leads l
     where l.id = any (p_lead_ids)
       and l.assigned_to = p_de
       and l.status in ('assigned', 'attending', 'in_progress')
     order by l.created_at
  loop
    -- `reassign_lead` valida o destino (ativo e corretor) e grava o histórico.
    perform public.reassign_lead(v_lead, p_para);
    v_feitos := v_feitos + 1;
  end loop;

  return v_feitos;
end;
$$;
comment on function public.repassar_leads(uuid, uuid, uuid[]) is
  'Passa os leads em atendimento escolhidos do corretor inativo p_de para o corretor ativo p_para, um a um pelo reassign_lead (0343). Só admin/sócio. Devolve quantos foram repassados.';
revoke all on function public.repassar_leads(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.repassar_leads(uuid, uuid, uuid[]) to authenticated;
