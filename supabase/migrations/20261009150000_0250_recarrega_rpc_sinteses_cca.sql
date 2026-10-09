-- A migration 0248 criou a RPC usada pelo segundo filtro do CCA, mas a
-- ordenação dos corretores referenciava a coluna antiga `share`. A coluna real
-- é `share_pct`. Substituir a função corrige somente a leitura das sínteses:
-- nenhuma linha, month_base ou data de venda é alterada.
create or replace function public.cca_monthly_synthesis(p_month date)
returns table (
  event_id uuid,
  deal_id uuid,
  stage_name text,
  entered_at timestamptz,
  deal_code text,
  client_name text,
  developer_name text,
  project_name text,
  broker_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if not (public.is_admin() or public.has_permission('cca.review')) then
    raise exception 'Seu perfil não consulta as sínteses do CCA.' using errcode = '42501';
  end if;
  if p_month is null then raise exception 'Escolha o mês das sínteses.' using errcode = 'P0001'; end if;

  v_start := make_timestamptz(extract(year from p_month)::int, extract(month from p_month)::int,
                              1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';

  return query
  with movimentos as (
    select h.id, h.deal_id, h.created_at,
           btrim(split_part(substr(h.to_value, length('STATUS: ') + 1), ' — ', 1)) as stage
      from public.deal_history h
     where h.kind = 'comment'
       and h.to_value like 'STATUS: % — %'
       and h.created_at >= v_start and h.created_at < v_end
  )
  select m.id, m.deal_id, m.stage, m.created_at, d.code,
         c.full_name, dev.name, d.project_name,
         brokers.names
    from movimentos m
    join public.deals d on d.id = m.deal_id
    left join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
    left join public.developers dev on dev.id = d.developer_id
    left join lateral (
      select string_agg(p.full_name, ', ' order by dp.share_pct desc, p.full_name) as names
        from public.deal_participants dp
        join public.profiles p on p.id = dp.profile_id
       where dp.deal_id = d.id and dp.role = 'broker'
    ) brokers on true
   where public.deal_status_bare(m.stage) in
     ('INCONFORME CEOPF', 'RESOLVER P/ ASSINAR BANCO',
      'AGUARDANDO DEMANDA MÍNIMA', 'ASSINADO BANCO')
   order by m.created_at, m.id;
end;
$$;

revoke all on function public.cca_monthly_synthesis(date) from public, anon;
grant execute on function public.cca_monthly_synthesis(date) to authenticated, service_role;

comment on function public.cca_monthly_synthesis(date) is
  'Agrupa as quatro sínteses solicitadas pelo mês em que o CCA entrou no status, usando deal_history.created_at e nunca o mês-base da venda.';

-- Publica imediatamente a assinatura corrigida no PostgREST.
notify pgrst, 'reload schema';

