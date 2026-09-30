-- =============================================================================
-- 0176 — admin avisado de todo lead que chega (liga e desliga)
--
-- Pedido do cliente em 30/09/2026: além do corretor que recebe, o admin quer
-- saber de todo lead que chega — de onde veio e para quem foi —, com um
-- interruptor para desligar. Hoje o admin só é avisado do lead que entra na
-- fila sem dono.
--
--   · só lead que CHEGA sozinho: site, Meta, WhatsApp, IA de voz (inserido sem
--     sessão de usuário). Importação de planilha e cadastro manual não avisam —
--     uma planilha de 500 linhas viraria 500 avisos;
--   · roda no fim da transação (gatilho adiado), depois da roleta, para dizer
--     para quem o lead foi;
--   · vai para admin e sócio ativos, menos quem recebeu o lead (esse já tem o
--     aviso de lead recebido);
--   · interruptor: categoria `lead_geral` em `push_preferences`, ligada por
--     padrão (sem linha = ligada), na tela Avisos. Desligada, nem o sino recebe.
-- =============================================================================
alter table public.push_preferences drop constraint if exists push_preferences_category_check;
alter table public.push_preferences add constraint push_preferences_category_check
  check (category in ('lead_recebido', 'lead_prazo', 'lead_atividade', 'credito', 'outros', 'lead_geral'));

create or replace function public.leads_avisa_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead   public.leads;
  v_origem text;
  v_dono   text;
begin
  if auth.uid() is not null then
    return null;
  end if;

  select * into v_lead from public.leads where id = new.id;
  if not found then
    return null;
  end if;

  select label into v_origem from public.lead_sources where id = v_lead.source_id;
  v_origem := coalesce(v_origem, nullif(v_lead.utm_source, ''), 'Origem não informada');
  select full_name into v_dono from public.profiles where id = v_lead.assigned_to;

  insert into public.notifications (profile_id, kind, title, body, link)
  select distinct p.id,
         'lead_new_admin',
         'Novo lead: ' || coalesce(nullif(v_lead.full_name, ''), 'sem nome'),
         v_origem || ' · ' || case when v_dono is not null then 'foi para ' || v_dono
                                   else 'está na fila da roleta' end,
         '/leads?lead=' || v_lead.id
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id
   where ur.role in ('admin', 'partner')
     and p.status = 'active'
     and p.id is distinct from v_lead.assigned_to
     and coalesce((select pp.enabled from public.push_preferences pp
                    where pp.profile_id = p.id and pp.category = 'lead_geral'), true);

  return null;
exception when others then
  -- Aviso não pode derrubar a chegada do lead.
  raise warning 'leads_avisa_admin: aviso do lead % não saiu: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.leads_avisa_admin() from public, anon, authenticated;

drop trigger if exists leads_avisa_admin on public.leads;
create constraint trigger leads_avisa_admin
  after insert on public.leads
  deferrable initially deferred
  for each row execute function public.leads_avisa_admin();

comment on function public.leads_avisa_admin() is
  'Avisa admin e sócio de todo lead que chega sozinho (site, Meta, WhatsApp), com origem e destino; desliga pela categoria lead_geral (0176).';
