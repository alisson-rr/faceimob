-- =============================================================================
-- 0199 — corretor vê gerente e diretor no negócio; sem gerente, o admin confere
--
-- Pedido do cliente em 03/10/2026:
--   1. "Ao preencher proposta a sugestão de gerente e diretor não aparece":
--      a RLS de `profiles` entrega ao corretor só o próprio perfil, então os
--      campos Gerente e Diretor abriam vazios. `selectable_leaders()` devolve
--      id e nome de gerente e diretor ativos, e `lideranca_dos_corretores()` o
--      gerente e o diretor da equipe de cada corretor — a mesma regra do
--      gatilho `deal_participants_autofill` (filiação mais recente). Só ids e
--      nomes, o mesmo padrão de `selectable_brokers()` (0076).
--   2. "A aprovação do gerente, permita que o adm faça na falta deles": o
--      admin já podia aprovar (`review_deal_documents`); faltava o envio. O
--      negócio sem gerente vinculado deixa de ser recusado e o aviso vai aos
--      administradores e sócios.
-- =============================================================================

create or replace function public.selectable_leaders()
returns table (id uuid, full_name text, is_manager boolean, is_director boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id,
         p.full_name,
         exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'manager'),
         exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'director')
    from public.profiles p
   where (public.is_admin()
          or public.auth_effective_role(auth.uid()) = any (array['director', 'manager', 'broker', 'cca']::app_role[]))
     and p.status = 'active'
     and exists (select 1 from public.user_roles ur
                  where ur.profile_id = p.id and ur.role in ('manager', 'director'))
   order by p.full_name;
$$;

revoke all on function public.selectable_leaders() from public, anon;
grant execute on function public.selectable_leaders() to authenticated;
comment on function public.selectable_leaders() is
  'Gerentes e diretores ativos (só id, nome e papel) para os campos do negócio: o corretor não os enxerga pela RLS de profiles (0199).';

create or replace function public.lideranca_dos_corretores()
returns table (broker_id uuid, manager_id uuid, director_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (tm.profile_id) tm.profile_id, t.manager_id, t.director_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.profiles p on p.id = tm.profile_id and p.status = 'active'
   where tm.left_at is null
     and (public.is_admin()
          or public.auth_effective_role(auth.uid()) = any (array['director', 'manager', 'broker', 'cca']::app_role[]))
   -- A filiação mais recente ganha: a mesma ordem de deal_participants_autofill.
   order by tm.profile_id, tm.joined_at desc nulls last, tm.created_at desc, tm.id desc;
$$;

revoke all on function public.lideranca_dos_corretores() from public, anon;
grant execute on function public.lideranca_dos_corretores() to authenticated;
comment on function public.lideranca_dos_corretores() is
  'Gerente e diretor da equipe de cada corretor ativo (só ids), para sugerir no negócio a quem não enxerga a equipe (0199).';

create or replace function public.submit_deal_for_manager_review(
  p_deal_id uuid,
  p_message text,
  p_esteira text default 'agil'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals;
  v_previous text;
  v_missing  text;
  v_message  text := btrim(coalesce(p_message, ''));
  v_esteira  text := coalesce(p_esteira, 'agil');
  v_texto    text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if v_esteira not in ('agil', 'virar') then
    raise exception 'Esteira de envio desconhecida: use "agil" ou "virar".' using errcode = 'P0001';
  end if;

  if v_message = '' then
    raise exception 'Escreva a mensagem do envio: ela fica registrada no negócio e avisa a equipe.'
      using errcode = 'P0001';
  end if;

  if length(v_message) > 4000 then
    raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  -- 0164: corretor, gerente ou diretor do negócio (era só o corretor).
  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role in ('broker', 'manager', 'director')
  ) then
    raise exception 'Somente corretor, gerente ou diretor do negócio pode enviar para análise.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status = 'pending' then
    raise exception 'A documentação já aguarda conferência do gerente.'
      using errcode = 'P0001';
  end if;

  if v_esteira = 'virar' then
    if not exists (
      select 1 from public.cca_cases c
      where c.deal_id = p_deal_id
        and (c.status = 'approved'
             or (c.status = 'pending_documents' and v_deal.review_esteira = 'virar'))
    ) then
      raise exception 'A análise p/ virar negócio é o 2º envio: só vale para negócio com crédito aprovado na CCA.'
        using errcode = 'P0001';
    end if;
  elsif v_deal.document_review_status = 'approved' then
    raise exception 'A documentação deste negócio já foi aprovada.'
      using errcode = 'P0001';
  end if;

  if v_deal.developer_id is null then
    raise exception 'Defina a construtora na aba Detalhes antes de enviar ao gerente.'
      using errcode = 'P0001';
  end if;

  select string_agg(dt.label, ', ' order by dt.sort_order) into v_missing
  from public.document_types dt
  where dt.active and dt.required_for_conversion
    and not exists (
      select 1 from public.deal_documents dd
      where dd.deal_id = p_deal_id
        and dd.document_type_id = dt.id
        and dd.superseded_at is null
    );

  if v_missing is not null then
    raise exception 'Faltam documentos obrigatórios: %', v_missing using errcode = 'P0001';
  end if;

  v_previous := v_deal.document_review_status;
  v_texto := case v_esteira
               when 'virar' then 'ENVIO ANÁLISE P/ VIRAR NEGÓCIO: '
               else 'ENVIO ESTEIRA ÁGIL: '
             end || v_message;

  update public.deals
  set document_review_status = 'pending',
      document_review_requested_at = now(),
      document_review_requested_by = auth.uid(),
      document_reviewed_at = null,
      document_reviewed_by = null,
      document_review_reason = null,
      review_esteira = v_esteira
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_requested', v_previous, 'pending');

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', v_texto);

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (p_deal_id, auth.uid(), 'esteira_sent', jsonb_build_object('esteira', v_esteira));

  -- 0199: negócio sem gerente vai para o administrador conferir.
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct q.profile_id,
         'document_review_requested',
         'Documentos para conferir: ' || v_deal.code,
         left(v_texto, 2000),
         '/pipeline?conferencia=pendente',
         'in_app'::notification_channel
  from (
    select dp.profile_id from public.deal_participants dp
     where dp.deal_id = p_deal_id and dp.role = 'manager'
    union
    select ur.profile_id from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id and p.status = 'active'
     where ur.role in ('admin', 'partner')
       and not exists (select 1 from public.deal_participants dp
                        where dp.deal_id = p_deal_id and dp.role = 'manager')
  ) q;

  return jsonb_build_object('status', 'pending', 'esteira', v_esteira);
end;
$$;

comment on function public.submit_deal_for_manager_review(uuid, text, text) is
  'Corretor, gerente ou diretor do negócio (0164) envia o dossiê à conferência com mensagem obrigatória, pela esteira agil (1º envio) ou virar (2º envio, só com crédito aprovado na CCA). Avisa os gerentes do negócio; sem gerente vinculado, avisa administradores e sócios, que conferem na falta dele (0199).';

-- O popup de entrada do gerente (0196) também conta, para o admin, o que
-- espera conferência sem gerente vinculado.
create or replace function public.minhas_conferencias_pendentes()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.deals d
   where auth.uid() is not null
     and d.document_review_status = 'pending'
     and (exists (select 1 from public.deal_participants dp
                   where dp.deal_id = d.id and dp.role = 'manager' and dp.profile_id = auth.uid())
          or (public.is_admin()
              and not exists (select 1 from public.deal_participants dp
                               where dp.deal_id = d.id and dp.role = 'manager')));
$$;

revoke all on function public.minhas_conferencias_pendentes() from public, anon;
grant execute on function public.minhas_conferencias_pendentes() to authenticated;
comment on function public.minhas_conferencias_pendentes() is
  'Negócios em conferência documental (pending) em que quem pergunta é o gerente; para o admin, também os sem gerente vinculado (0196, 0199).';
