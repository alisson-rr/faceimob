-- =============================================================================
-- 0238 — gerente e diretor enxergam a própria fila de aprovações
--
-- A 0235 permitiu ao diretor vinculado conferir o dossiê, mas a contagem da
-- 0199 continuou procurando somente o participante `manager`. O poder existia
-- no modal e ficava invisível no Pipeline do diretor.
-- =============================================================================

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
     and (
       public.is_admin()
       or exists (
         select 1
           from public.deal_participants dp
          where dp.deal_id = d.id
            and dp.profile_id = auth.uid()
            and dp.role in ('manager', 'director')
       )
     );
$$;

revoke all on function public.minhas_conferencias_pendentes() from public, anon;
grant execute on function public.minhas_conferencias_pendentes() to authenticated;

comment on function public.minhas_conferencias_pendentes() is
  'Propostas pendentes que o gerente ou diretor vinculado pode conferir; admin/sócio vê todas (0238).';
