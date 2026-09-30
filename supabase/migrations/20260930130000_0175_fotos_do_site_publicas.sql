-- =============================================================================
-- 0175 — fotos de imóveis, lotes e blog em pasta pública
--
-- Na prévia do site na Vercel as fotos dos cards, das páginas de imóvel e do
-- blog não abriam: o site passou a usar o link público (fixo, que a prévia de
-- compartilhamento do WhatsApp consegue ler), e na VPS as pastas vieram
-- privadas. Só estas duas viram públicas: são as fotos que o site já mostra a
-- qualquer visitante. Documentos (`property-docs`, `support-docs`) e o material
-- de campanha (`campaign-images`) continuam privados. Gravar e apagar seguem
-- pelas policies de sempre.
-- =============================================================================
do $$
begin
  update storage.buckets set public = true where id in ('property-images', 'blog-images');
exception when insufficient_privilege then
  raise warning '0175: sem permissão para tornar as pastas de fotos públicas: %', sqlerrm;
end
$$;
