-- =============================================================================
-- 0258 · RG e CNH num documento só, obrigatório
--
-- Pedido de 10/10/2026: "junte estes campos em um só RG/CNH, sendo este campo
-- obrigatório". O tipo `rg_cpf` vira "RG / CNH", aceita vários arquivos (frente,
-- verso, RG ou CNH) e segue obrigatório. Os arquivos que estavam em CNH passam
-- para ele — só o tipo muda; arquivo, nome e histórico ficam como estão — e o
-- tipo CNH sai do catálogo (inativo, para não sumir de relatório antigo).
-- O código `rg_cpf` fica: é ele que nomeia os arquivos e as sementes usam.
-- =============================================================================

update public.document_types
   set label = 'RG / CNH',
       required_for_conversion = true,
       allows_multiple = true
 where code = 'rg_cpf';

update public.deal_documents dd
   set document_type_id = rg.id
  from public.document_types rg, public.document_types cnh
 where rg.code = 'rg_cpf' and cnh.code = 'cnh'
   and dd.document_type_id = cnh.id;

update public.lead_attachments la
   set document_type_id = rg.id
  from public.document_types rg, public.document_types cnh
 where rg.code = 'rg_cpf' and cnh.code = 'cnh'
   and la.document_type_id = cnh.id;

update public.document_types
   set active = false, required_for_conversion = false
 where code = 'cnh';
