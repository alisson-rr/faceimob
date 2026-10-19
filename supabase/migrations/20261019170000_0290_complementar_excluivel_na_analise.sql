-- =============================================================================
-- 0290 · Documento complementar excluível também com a análise na CCA
--
-- Pedido de 19/10/2026: o corretor anexou um complementar errado e o banco
-- recusou a exclusão ("você não tem acesso a este negócio"). A 0285 só
-- deixava excluir o complementar enquanto o dossiê estava com o comercial;
-- com a análise na CCA, nada saía.
--
-- Complementar = anexo NÃO travado de um negócio que já tem documento aprovado
-- (travado). Ele passa a sair para quem edita o negócio em qualquer fase, menos
-- depois de VIROU NEGÓCIO. O resto da 0285 fica: antes da primeira aprovação, o
-- dossiê enviado ao gerente ou em análise continua sendo prova e não sai pela
-- mão do comercial; o aprovado segue travado; CCA e admin passam pela policy.
-- =============================================================================
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
             and (public.dossie_com_o_comercial(d.id)
                  or exists (select 1 from public.deal_documents x
                              where x.deal_id = d.id and x.locked_at is not null)))
       )
      from public.deals d where d.id = p_deal_id), false);
$$;

comment on function public.deal_document_pode_excluir(uuid, timestamptz) is
  'Comercial exclui anexo não travado: antes da aprovação com o dossiê com o comercial, no INCOMPLETO, o complementar em qualquer fase até VIROU NEGÓCIO (0290) e na pendência de VIROU NEGÓCIO. CCA/admin passam pela policy.';
