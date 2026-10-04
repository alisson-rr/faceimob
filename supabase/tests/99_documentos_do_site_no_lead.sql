-- =============================================================================
-- 0218 — os documentos da coleta do site entram como anexos do lead do CRM;
-- caminho que não existe no bucket, ou fora de `site/`, não vira anexo.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

insert into storage.buckets (id, name) values ('lead-attachments', 'lead-attachments') on conflict do nothing;
insert into storage.objects (bucket_id, name) values
  ('lead-attachments', 'site/app0218/1-rg.pdf'),
  ('lead-attachments', 'site/app0218/2-renda.jpg'),
  ('lead-attachments', 'outro-lead/segredo.pdf');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into site.credit_applications (name, phone, doc_type, address, files, consent_lgpd)
values ('Dora Docs', '51999990218', 'rg', 'Rua 0218', jsonb_build_array(
  jsonb_build_object('name', 'RG frente.pdf', 'storage_path', 'site/app0218/1-rg.pdf', 'mime', 'application/pdf', 'size', 1234),
  jsonb_build_object('name', 'Holerite.jpg', 'storage_path', 'site/app0218/2-renda.jpg', 'mime', 'image/jpeg', 'size', 99),
  jsonb_build_object('name', 'inventado.pdf', 'storage_path', 'site/app0218/nao-existe.pdf'),
  jsonb_build_object('name', 'de outro lead', 'storage_path', 'outro-lead/segredo.pdf')
), true);
insert into site.leads (id, name, phone, message, source) values
  ('00000000-0000-0000-0000-000000021801', 'Dora Docs', '51999990218', 'Análise de crédito solicitada.', 'credit_application');

do $$
declare
  v public.leads;
begin
  select * into v from public.leads where external_id = 'site:00000000-0000-0000-0000-000000021801';
  perform pg_temp.ok(v.id is not null, 'o lead da coleta entrou no CRM');
  perform pg_temp.ok(
    (select array_agg(original_name order by original_name) from public.lead_attachments where lead_id = v.id)
      = array['Holerite.jpg', 'RG frente.pdf'],
    'os dois documentos gravados no bucket viram anexos do lead');
  perform pg_temp.ok(
    not exists (select 1 from public.lead_attachments
                 where storage_path in ('site/app0218/nao-existe.pdf', 'outro-lead/segredo.pdf')),
    'caminho inexistente ou fora de site/ não vira anexo');
  perform pg_temp.ok(v.notes like '%na aba Anexos deste lead%', 'a nota avisa onde estão os documentos');
end;
$$;

rollback;
