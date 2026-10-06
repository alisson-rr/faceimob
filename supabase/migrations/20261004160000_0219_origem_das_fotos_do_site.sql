-- =============================================================================
-- 0219 — coluna de origem das fotos que o importador do site grava
--
-- 04/10/2026: o importador de imóveis achava as fotos ("Importar 25 fotos") e
-- terminava com "0 imagens importadas". Ele grava em `source_url` de onde veio
-- cada foto (e lê essa coluna para não importar a mesma duas vezes), mas a
-- coluna existia só no banco antigo da Lovable — criada fora das migrations do
-- site — e não veio na cópia do schema `site` (0169). Cada gravação falhava,
-- o arquivo ficava no bucket e a foto não entrava na galeria.
-- Só estas duas colunas faltavam: comparado com o `types.ts` do site.
-- =============================================================================

alter table site.property_images add column if not exists source_url text;
alter table site.lote_imagens    add column if not exists source_url text;

comment on column site.property_images.source_url is
  'Endereço de onde o importador baixou a foto; evita importar a mesma de novo (0219).';
comment on column site.lote_imagens.source_url is
  'Endereço de onde o importador baixou a foto; evita importar a mesma de novo (0219).';
