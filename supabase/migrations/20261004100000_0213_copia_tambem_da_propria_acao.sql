-- =============================================================================
-- 0213 — a cópia do e-mail chega também a quem fez a ação
--
-- Reclamação de 04/10/2026 (controle@faceimob.com.br): "sigo não recebendo as
-- cópias; preciso receber cópia de tudo mesmo que seja eu quem edite". A 0206
-- tirava da cópia quem tinha feito a ação — e quem mais edita é justamente o
-- admin que quer o registro. Agora admin (sempre) e sócio (nos movimentos de
-- venda) recebem a cópia também do que eles mesmos fizeram. O resto da 0206
-- continua: um e-mail por endereço e por aviso, e a cópia segue o interruptor
-- da origem.
-- =============================================================================

create or replace function public.copiar_email_para_admin_e_socios()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venda boolean;
begin
  select d.outcome = 'won'
      or coalesce(g.code in ('VENDA', 'DISTRATO'), false)
      or public.negocio_em_distrato(d)
      or coalesce(current_setting('faceimob.saiu_da_venda', true), '') = 'on'
    into v_venda
    from public.deals d
    left join public.deal_status_groups g on g.id = d.status_group_id
   where d.id = new.deal_id;

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes, copia)
  select distinct on (lower(btrim(p.email::text)))
         new.deal_id, p.id, btrim(p.email::text), new.deal_code, new.client_name, new.stage_name,
         new.actor_name, new.message, new.source, new.detalhes, true
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where (ur.role = 'admin' or (ur.role = 'partner' and coalesce(v_venda, false)))
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
     -- O mesmo aviso (mesma transação) já tem esse endereço: participante ou
     -- cópia de uma linha irmã.
     and not exists (
       select 1 from public.cca_move_emails e
        where e.deal_id = new.deal_id and e.source = new.source and e.stage_name = new.stage_name
          and e.created_at = new.created_at
          and lower(btrim(e.to_email)) = lower(btrim(p.email::text)))
   order by lower(btrim(p.email::text)), p.id;
  return null;
end;
$$;

revoke all on function public.copiar_email_para_admin_e_socios() from public, anon, authenticated;
