-- =============================================================================
-- 0153 · Cor das colunas da CCA
--
-- Pedido de 18/09/2026: kanban colorido, cabeçalho de cada coluna pintado com
-- a cor dela. `cca_stages.color` guardava só uma das seis chaves semânticas
-- (`warning`, `success`…): com 19 colunas, três amarelas seguidas e quatro
-- azuis. A coluna passa a aceitar também `#RRGGBB`, que é o que o seletor de
-- cor da tela "Gerenciar estágios" devolve — o mesmo formato de
-- `developers.color` (0152). As chaves antigas continuam valendo: a tela as
-- traduz para uma cor fixa.
--
-- Formato fechado aqui, e não só na tela: o valor vai direto para o `style` do
-- cabeçalho. Toda linha existente é chave semântica ou hex (o default da 0012
-- é '#94a3b8' e o `seed.sql` grava hex); nenhuma guarda classe do Tailwind
-- (`text-amber-400`, o formato antigo da tela, achado T14), que é o único que este
-- CHECK recusaria (conferido em 18/09).
--
-- Cor inicial por coluna, na família do significado: verde aprova, vermelho
-- recusa, amarelo/laranja pede atenção, azul/roxo está andando, dourado é a
-- venda (ASSINADO BANCO). Só troca a linha que ainda tem a cor da 0150 — a
-- coluna que o admin já recoloriu fica como está. A coluna repetida criada pela
-- tela ("RETORNO ESTEIRA  ÁGIL", dois espaços) não entra.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cca_stages_color_format') then
    alter table public.cca_stages
      add constraint cca_stages_color_format
      check (
        color is null
        or color ~ '^#[0-9A-Fa-f]{6}$'
        or color in ('info', 'warning', 'success', 'danger', 'highlight', 'neutral')
      );
  end if;
end
$$;

update public.cca_stages s
   set color = c.hex
  from (values
    ('RETORNO À ESTEIRA ÁGIL',              'danger',  '#F97316'),
    ('EM PROCESSAMENTO',                    'warning', '#3B82F6'),
    ('AGUARDANDO RETORNO AGÊNCIA',          'info',    '#6366F1'),
    ('APROVADO TOTAL',                      'success', '#16A34A'),
    ('APROVADO POTENCIAL',                  'info',    '#84CC16'),
    ('APROVADO CONDICIONADO',               'warning', '#EAB308'),
    ('APROVADO TOTAL COM RESTRIÇÃO',        'warning', '#F59E0B'),
    ('APROVADO CONDICIONADO COM RESTRIÇÃO', 'warning', '#FB923C'),
    ('REPROVADO',                           'danger',  '#DC2626'),
    ('BACEN',                               'danger',  '#7F1D1D'),
    ('VIROU NEGÓCIO',                       'success', '#059669'),
    ('VIROU NEGÓCIO COM PENDÊNCIAS',        'warning', '#D97706'),
    ('ANÁLISE CEOPF',                       'info',    '#0EA5E9'),
    ('INCONFORME CEOPF',                    'danger',  '#DB2777'),
    ('APROVADO/AGUARDANDO AGENDA',          'info',    '#14B8A6'),
    ('ENTREVISTA AGENDADA',                 'info',    '#8B5CF6'),
    ('ASSINADO BANCO',                      'success', '#CA8A04'),
    ('EM ANÁLISE',                          'warning', '#2563EB'),
    ('PENDENTE',                            'danger',  '#EF4444')
  ) as c(name, seeded, hex)
 where s.name = c.name
   and s.color = c.seeded;

comment on column public.cca_stages.color is
  'Cor da coluna na CCA: #RRGGBB, ou uma chave semântica antiga (info, warning, success, danger, highlight, neutral) que a tela traduz.';
