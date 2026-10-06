-- =============================================================================
-- 0185 — relatório só sai com admin e sócio; diretor ganha a lista de ligação
--
-- Pedido do cliente em 02/10/2026:
--   · corretor, gerente e diretor não extraem relatório nenhum. A planilha do
--     Pipeline (`pipeline.export`, 0092) nascia só para admin e sócio, mas a
--     tela de Permissões deixava ligá-la para outros papéis: aqui ela é
--     desligada para todos os outros e a tela passa a não oferecer a troca;
--   · o diretor extrai uma lista para ligação: leads antigos (de antes do mês
--     corrente) com CAMPANHA | CLIENTE | TELEFONE, em PDF e Excel.
--
-- A lista sai do banco por `lista_de_ligacao()`, com a RLS de quem pede
-- (`security invoker`): o diretor recebe os leads da diretoria dele, o admin
-- recebe tudo. Lead que virou negócio não entra (já é cliente).
-- =============================================================================

update public.role_permissions
   set allowed = false
 where permission = 'pipeline.export'
   and role not in ('admin', 'partner');

insert into public.permissions (code, label, category, description)
values (
  'leads.call_list',
  'Extrair lista de ligação',
  'leads',
  'Baixar em PDF ou Excel os leads de antes do mês corrente que não viraram negócio: campanha, cliente e telefone.'
)
on conflict (code) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description;

insert into public.role_permissions (role, permission, allowed)
values
  ('admin', 'leads.call_list', true),
  ('partner', 'leads.call_list', true),
  ('director', 'leads.call_list', true)
on conflict (role, permission) do update set allowed = excluded.allowed;

create or replace function public.lista_de_ligacao()
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.has_permission('leads.call_list') then
    raise exception 'Seu perfil não extrai a lista de ligação.' using errcode = '42501';
  end if;

  return query
  select coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), ''),
                  s.label, 'Sem campanha'),
         l.full_name,
         coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')),
         l.created_at
    from public.leads l
    left join public.lead_sources s on s.id = l.source_id
   -- "Do mês passado para trás": antes do 1º dia do mês corrente, no fuso da operação.
   where l.created_at < (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
     and l.converted_deal_id is null
     and coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) is not null
   order by 1, l.created_at desc;
end;
$$;

revoke all on function public.lista_de_ligacao() from public, anon;
grant execute on function public.lista_de_ligacao() to authenticated, service_role;
comment on function public.lista_de_ligacao() is
  'Lista de ligação do diretor (0185): leads de antes do mês corrente, sem negócio, com campanha, cliente e telefone. RLS de quem pede.';

-- A planilha do Pipeline não volta a ser ligada para outros papéis pela tela.
alter table public.role_permissions
  drop constraint if exists role_permissions_exportacao_so_admin;
alter table public.role_permissions
  add constraint role_permissions_exportacao_so_admin
  check (not (permission = 'pipeline.export' and allowed and role not in ('admin', 'partner')));
