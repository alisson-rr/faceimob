-- =============================================================================
-- 0186 — limpeza dos leads de teste, pelo administrador, com cópia
--
-- Pedido do cliente em 02/10/2026: "remova os leads antigos dos testes para
-- começarmos uma nova distribuição". Decisão: apagar todo lead que NÃO virou
-- negócio; o que virou fica, para não quebrar o vínculo do Pipeline.
--
-- Não é migration que apaga às cegas: é uma ação de Admin → Gestão de dados.
--   · `previa_limpeza_de_leads()` diz quantos e de quais origens;
--   · `apagar_leads_sem_negocio(total)` só apaga se o total confirmado na tela
--     for o mesmo de agora (lead que chegou no meio não some sem ser visto);
--   · antes de apagar, cada lead vai para `private.leads_apagados` com os
--     comentários, eventos e atribuições dele (jsonb), para recuperar se preciso.
-- Os filhos com `on delete cascade` (atribuições, eventos, comentários,
-- anexos, visitas, conversas do SDR) saem junto; remarketing e mensagens de
-- WhatsApp só perdem o vínculo.
-- =============================================================================

create table if not exists private.leads_apagados (
  id          uuid primary key,
  dados       jsonb not null,
  apagado_em  timestamptz not null default now(),
  apagado_por uuid
);

revoke all on private.leads_apagados from public, anon, authenticated;

-- Lead sem negócio: nem `converted_deal_id`, nem negócio apontando para ele.
create or replace function public.lead_sem_negocio(p_lead public.leads)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_lead.converted_deal_id is null
     and not exists (select 1 from public.deals d where d.lead_id = p_lead.id);
$$;

revoke all on function public.lead_sem_negocio(public.leads) from public, anon;
grant execute on function public.lead_sem_negocio(public.leads) to authenticated, service_role;

create or replace function public.previa_limpeza_de_leads()
returns table (origem text, total bigint, mais_antigo timestamptz, mais_novo timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só administrador e sócio limpam leads.' using errcode = '42501';
  end if;
  return query
  select coalesce(s.label, 'Sem origem'), count(*), min(l.created_at), max(l.created_at)
    from public.leads l
    left join public.lead_sources s on s.id = l.source_id
   where public.lead_sem_negocio(l)
   group by 1
   order by 2 desc;
end;
$$;

revoke all on function public.previa_limpeza_de_leads() from public, anon;
grant execute on function public.previa_limpeza_de_leads() to authenticated;

create or replace function public.apagar_leads_sem_negocio(p_total_confirmado int)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só administrador e sócio limpam leads.' using errcode = '42501';
  end if;

  -- Trava a tabela para o total conferido não mudar entre a contagem e o delete.
  lock table public.leads in share row exclusive mode;

  select count(*) into v_total from public.leads l where public.lead_sem_negocio(l);
  if v_total is distinct from p_total_confirmado then
    raise exception 'A quantidade mudou (agora são %). Revise a prévia e confirme de novo.', v_total
      using errcode = 'P0001';
  end if;

  insert into private.leads_apagados (id, dados, apagado_por)
  select l.id,
         to_jsonb(l) || jsonb_build_object(
           'comentarios', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.lead_comments c where c.lead_id = l.id),
           'eventos', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.lead_events e where e.lead_id = l.id),
           'atribuicoes', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.lead_assignments a where a.lead_id = l.id)
         ),
         auth.uid()
    from public.leads l
   where public.lead_sem_negocio(l)
  on conflict (id) do update set dados = excluded.dados, apagado_em = now(), apagado_por = excluded.apagado_por;

  delete from public.leads l where public.lead_sem_negocio(l);
  return v_total;
end;
$$;

revoke all on function public.apagar_leads_sem_negocio(int) from public, anon;
grant execute on function public.apagar_leads_sem_negocio(int) to authenticated;
comment on function public.apagar_leads_sem_negocio(int) is
  'Apaga os leads que não viraram negócio, com cópia em private.leads_apagados. Só admin e sócio, com o total confirmado na tela (0186).';
