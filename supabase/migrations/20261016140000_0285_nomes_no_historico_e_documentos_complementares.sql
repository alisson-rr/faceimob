-- =============================================================================
-- 0285 · Nome de quem fez no histórico do negócio + documentos complementares
--
-- Pedido de 16/10/2026:
--   1. O histórico do negócio mostra "por —" para o CCA: a tela resolve o nome
--      pela lista de `profiles`, que a visibilidade recorta. Mesmo remédio da
--      0275 para o lead: uma função que devolve só os nomes que aparecem no
--      histórico que o chamador já pode ler.
--   2. Documentos em três fases:
--      · antes da aprovação do crédito (inclusive INCOMPLETO): todos que editam
--        o negócio excluem o anexo errado;
--      · aprovado na CCA: o que foi aprovado trava; o que entra depois
--        (complementar, para virar negócio) pode ser excluído e renomeado até o
--        envio da análise p/ virar negócio;
--      · VIROU NEGÓCIO: tudo trava. Em VIROU NEGÓCIO COM PENDÊNCIAS o comercial
--        anexa o que falta (e pode tirar o que anexou errado nessa pendência),
--        e o CCA é avisado.
--   CCA e administrador continuam com a alçada de sempre (excluem em qualquer
--   fase).
--
-- A trava é por documento (`deal_documents.locked_at`): a tela separa
-- "aprovado" de "complementar" pela mesma coluna que a RLS cobra.
-- =============================================================================

-- 1. Nomes do histórico do negócio --------------------------------------------
-- Invoker: parte de `deal_history`, que já passa pela RLS do chamador; o nome
-- vem de `profile_display_name` (0275), que devolve só o nome.
create or replace function public.deal_history_names(p_deal_id uuid)
returns table(id uuid, full_name text)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with ids as (
    select h.actor_id as pid from public.deal_history h where h.deal_id = p_deal_id
    union
    select h.from_value::uuid from public.deal_history h
     where h.deal_id = p_deal_id
       and h.from_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select h.to_value::uuid from public.deal_history h
     where h.deal_id = p_deal_id
       and h.to_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select i.pid, public.profile_display_name(i.pid)
    from ids i where i.pid is not null
$$;
revoke all on function public.deal_history_names(uuid) from public, anon;
grant execute on function public.deal_history_names(uuid) to authenticated;
comment on function public.deal_history_names(uuid) is
  'Nomes de quem aparece no histórico do negócio (ator, de, para). Invoker: só devolve ids de linhas que a RLS deixa o chamador ler (0285).';

-- 2. Trava por documento --------------------------------------------------------
alter table public.deal_documents
  add column if not exists locked_at timestamptz;

comment on column public.deal_documents.locked_at is
  'Travado em (0285): preenchido na aprovação do crédito na CCA e ao virar negócio; limpo quando o negócio volta ao INCOMPLETO. NULL = complementar/editável pelo comercial.';

-- Caso aprovado na CCA trava o que estava no dossiê naquele momento. Vale para
-- a 1ª aprovação (Ágil) e para a análise p/ virar negócio: o complementar que
-- foi aprovado nela também passa a ser prova.
create or replace function public.cca_cases_trava_documentos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    update public.deal_documents
       set locked_at = now()
     where deal_id = new.deal_id and locked_at is null;
  end if;
  return null;
end;
$$;
revoke all on function public.cca_cases_trava_documentos() from public, anon, authenticated;

drop trigger if exists cca_cases_trava_documentos on public.cca_cases;
create trigger cca_cases_trava_documentos
  after insert or update of status on public.cca_cases
  for each row execute function public.cca_cases_trava_documentos();

-- Status 2: virar negócio trava tudo; voltar ao INCOMPLETO destrava tudo (o
-- negócio recomeça pela Esteira Ágil, 0278, e o dossiê volta a ser rascunho).
create or replace function public.deals_trava_documentos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_novo  text := public.deal_status_bare(new.status_detail);
  v_velho text := public.deal_status_bare(old.status_detail);
begin
  if v_novo = 'INCOMPLETO' and v_velho is distinct from 'INCOMPLETO' then
    update public.deal_documents set locked_at = null
     where deal_id = new.id and locked_at is not null;
  elsif v_novo in ('VIROU NEGÓCIO', 'VIROU NEGOCIO', 'VIROU NEGÓCIO COM PENDÊNCIAS')
        and v_velho is distinct from v_novo then
    update public.deal_documents set locked_at = now()
     where deal_id = new.id and locked_at is null;
  end if;
  return null;
end;
$$;
revoke all on function public.deals_trava_documentos() from public, anon, authenticated;

drop trigger if exists deals_trava_documentos on public.deals;
create trigger deals_trava_documentos
  after update of status_detail on public.deals
  for each row
  when (new.status_detail is distinct from old.status_detail)
  execute function public.deals_trava_documentos();

-- Dados existentes: negócio que já passou da aprovação trava o que tem hoje.
-- É o comportamento atual (o comercial não exclui nada depois do envio), então
-- ninguém perde permissão; o CCA e o admin seguem excluindo.
update public.deal_documents dd
   set locked_at = now()
  from public.deals d
 where d.id = dd.deal_id
   and dd.locked_at is null
   and public.deal_status_bare(d.status_detail) is distinct from 'INCOMPLETO'
   and (
     public.deal_status_bare(d.status_detail) in ('VIROU NEGÓCIO', 'VIROU NEGOCIO', 'VIROU NEGÓCIO COM PENDÊNCIAS')
     or d.review_esteira = 'virar'
     or exists (select 1 from public.cca_cases c where c.deal_id = d.id and c.status = 'approved')
   );

-- 3. Quem exclui ------------------------------------------------------------------
-- Uma regra só, usada pela tabela e pelo bucket.
create or replace function public.deal_document_pode_excluir(p_deal_id uuid, p_locked_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select public.can_edit_deal(d.id)
       and p_locked_at is null
       and (
         public.deal_status_bare(d.status_detail) in ('INCOMPLETO', 'VIROU NEGÓCIO COM PENDÊNCIAS')
         or (public.deal_status_bare(d.status_detail) not in ('VIROU NEGÓCIO', 'VIROU NEGOCIO')
             and public.dossie_com_o_comercial(d.id))
       )
      from public.deals d where d.id = p_deal_id), false);
$$;
revoke all on function public.deal_document_pode_excluir(uuid, timestamptz) from public, anon;
grant execute on function public.deal_document_pode_excluir(uuid, timestamptz) to authenticated, service_role;
comment on function public.deal_document_pode_excluir(uuid, timestamptz) is
  'Comercial exclui anexo não travado: antes da aprovação, no INCOMPLETO, no complementar com o dossiê com o comercial, e na pendência de VIROU NEGÓCIO (0285). CCA/admin passam pela policy.';

drop policy if exists deal_documents_delete on public.deal_documents;
create policy deal_documents_delete on public.deal_documents
  for delete to authenticated
  using (
    public.is_admin()
    or public.has_role('cca')
    or public.deal_document_pode_excluir(deal_id, locked_at)
  );

-- O front apaga a linha antes do arquivo: no bucket, objeto sem linha (já
-- excluída pela policy acima) sai para quem edita o negócio; com linha, vale a
-- mesma regra da tabela.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists deal_documents_storage_delete on storage.objects';
  execute $policy$
    create policy deal_documents_storage_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'deal-documents'
        and public.deal_id_of_object(storage.objects.name) is not null
        and (
          public.is_admin()
          or public.has_role('cca')
          or (
            public.can_edit_deal(public.deal_id_of_object(storage.objects.name))
            and not exists (
              select 1 from public.deal_documents dd
               where dd.storage_path = storage.objects.name
                 and not public.deal_document_pode_excluir(dd.deal_id, dd.locked_at)
            )
          )
        )
      )
  $policy$;
end $$;

-- 4. Anexar na pendência de VIROU NEGÓCIO --------------------------------------
-- Mesmas cláusulas da 0229, mais a pendência do contrato.
drop policy if exists deal_documents_insert on public.deal_documents;
create policy deal_documents_insert on public.deal_documents
  for insert to authenticated
  with check (
    public.can_edit_deal(deal_id)
    and (
      public.is_admin()
      or public.has_permission('cca.review')
      or public.dossie_com_o_comercial(deal_id)
      or exists (select 1 from public.deals d
                  where d.id = deal_documents.deal_id
                    and public.deal_status_bare(d.status_detail) = 'VIROU NEGÓCIO COM PENDÊNCIAS')
    )
  );

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists deal_documents_storage_insert on storage.objects';
  execute $p$
    create policy deal_documents_storage_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'deal-documents'
        and public.deal_id_of_object(storage.objects.name) is not null
        and (
          (
            public.can_edit_deal(public.deal_id_of_object(storage.objects.name))
            and (
              public.is_admin()
              or public.has_permission('cca.review')
              or public.dossie_com_o_comercial(public.deal_id_of_object(storage.objects.name))
              or exists (select 1 from public.deals d
                          where d.id = public.deal_id_of_object(storage.objects.name)
                            and public.deal_status_bare(d.status_detail) = 'VIROU NEGÓCIO COM PENDÊNCIAS')
            )
          )
          or exists (
            select 1 from public.lead_attachments a
            where a.storage_path = storage.objects.name
              and a.lead_id = public.deal_id_of_object(storage.objects.name)
          )
        )
      )
  $p$;
end $$;

-- 5. Aviso ao CCA quando o comercial anexa na pendência --------------------------
-- Um aviso por pessoa a cada 10 minutos por negócio: subir cinco arquivos
-- seguidos não vira cinco notificações.
create or replace function public.deal_documents_avisa_pendencia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator  uuid := auth.uid();
  v_deal  public.deals;
  v_nome  text;
begin
  select * into v_deal from public.deals where id = new.deal_id;
  if v_deal.id is null
     or public.deal_status_bare(v_deal.status_detail) <> 'VIROU NEGÓCIO COM PENDÊNCIAS' then
    return null;
  end if;
  select full_name into v_nome from public.profiles where id = v_ator;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select ur.profile_id,
         'cca_pending_document_attached',
         format('Pendência anexada: %s', coalesce(v_deal.code, 'negócio sem código')),
         format('%s anexou documento na pendência de VIROU NEGÓCIO.', coalesce(v_nome, 'O comercial')),
         '/cca?negocio=' || new.deal_id,
         'in_app'
    from (select distinct profile_id from public.user_roles where role = 'cca') ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where ur.profile_id is distinct from v_ator
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = ur.profile_id
          and n.kind = 'cca_pending_document_attached'
          and n.link = '/cca?negocio=' || new.deal_id
          and n.created_at > now() - interval '10 minutes'
     );
  return null;
end;
$$;
revoke all on function public.deal_documents_avisa_pendencia() from public, anon, authenticated;

drop trigger if exists deal_documents_avisa_pendencia on public.deal_documents;
create trigger deal_documents_avisa_pendencia
  after insert on public.deal_documents
  for each row execute function public.deal_documents_avisa_pendencia();
