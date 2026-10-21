-- =============================================================================
-- 0298 · Resgate dos leads do site anteriores à integração
--
-- Pedido de 21/10/2026: "quero ver a possibilidade de resgatar o que não chegou
-- já que temos o registro no admin do site" — opção escolhida: mandar para a
-- roleta. A integração (0173) só pega leads novos; os de julho a setembro
-- ficaram só em `site.leads`. Conferido na VPS em 21/10: 185 sem lead no CRM,
-- 144 deles com o mesmo telefone já no CRM (Meta ou importação da Leadfy).
--
-- Resgata só quem não está no CRM nem pelo `external_id` nem pelo telefone
-- (últimos 8 dígitos, para ignorar DDI, DDD e o nono dígito), passando pelo
-- MESMO gatilho da integração: origem "Site · …", página de origem, anexos da
-- coleta e a roleta (`assign_lead`). Um gatilho de UPDATE temporário, disparado
-- por um update que não muda nada, e removido em seguida. Idempotente: rodar
-- de novo não acha ninguém (o `external_id` passa a existir).
-- =============================================================================

drop trigger if exists leads_para_o_crm_resgate on site.leads;
create trigger leads_para_o_crm_resgate
  after update on site.leads
  for each row execute function site.leads_para_o_crm();

update site.leads s
   set id = s.id
 where not exists (select 1 from public.leads l where l.external_id = 'site:' || s.id)
   and length(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g')) >= 8
   and not exists (
     select 1 from public.leads l
      where right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 8)
          = right(regexp_replace(s.phone, '\D', '', 'g'), 8));

drop trigger leads_para_o_crm_resgate on site.leads;
