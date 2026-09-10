# Decisões da importação Bubble → Supabase

Tomadas em 09/09/2026. Referências `N-xx` e `R-xx` apontam para `PLANO.md`.

## Decididas pelo dono da operação

| # | Decisão | Escolha | Efeito |
|---|---|---|---|
| N-05 | Reexportar do Bubble sem `-modified` | **Sim** | Os vínculos voltam como `unique id`. Elimina a heurística de nome em 1.723 linhas e corrige os 337.879 caracteres corrompidos de `leadfies`. **A carga de leads, observações e documentos espera esse reexport.** |
| N-07 | Recorte de leads | **Tudo (102.799)** | Relatório multi-ano completo. Contrapartida aceita: ~100 mil telefones sem consentimento documentado entram no banco. |
| N-28 | Documentos | **Só negócios recentes** | Baixa e sobe para o Storage privado apenas os documentos de negócios com movimentação nos últimos 12 meses. Os demais mantêm o registro em `deal_documents` sem arquivo, marcados como não migrados. |
| N-10 | 205 pessoas desligadas | **Importar** | Preserva 4.096 vínculos de `deal_participants` e o rateio histórico de VGV. **Corrigido em 09/09 após a revisão:** entram `status='suspended'` com conta bloqueada (`banned_until`), não `terminated`. O check `profiles_terminated_consistency` exige que `terminated` venha com data de desligamento, e essa data não existe na origem — usar `terminated` obrigaria a inventar uma. `suspended` é o mesmo estado que a tela grava ao desativar alguém. Quando houver data real, um UPDATE muda os dois campos juntos. |
| N-11 | Placar histórico do jogo | **Importar** (629 linhas / 7 temporadas) | Pódio antigo visível. Não alimenta comissão nem relatório fiscal. |
| N-08 | Recorte de negócios | **Todos os 7.579** | Default do plano; o denominador das taxas de conversão existe. |

## Decididas tecnicamente (reversíveis, sem impacto de negócio)

| # | Decisão | Escolha |
|---|---|---|
| N-06 | Tabela de-para | `public.import_bubble_map`, PK composta `(entidade, bubble_id, tabela_destino)`, com RLS e policy `is_admin()`. Resolve R-01. |
| N-04 | `document_review_status` dos fechados | Opção (c): `approved` **com a carga de CCA feita antes**, gatilho `cca_cases_sync_esteira_label` desligado no bloco. Evita as 1.267 reversões silenciosas e as 1.372 notificações falsas de R-04. |
| N-01 | Fuso do Bubble | `America/Sao_Paulo` como padrão. **A confirmar** quando o Bubble for reaberto para o reexport. |
| N-19 | `DISTRATO` / `QUEDA` | Criar `cca_stages` com `status='cancelled'` (1 linha de seed). |
| N-23 | 22 construtoras `CCA Externo` | Opção (A): entram todas como `flow='internal'`. Nenhum e-mail automático sai para endereço inventado. |
| R-13 | Caminho de execução | **Resolvido:** o MCP do Supabase conecta como `postgres` (dono das tabelas). `alter table … disable trigger` funciona; testado e religado em 09/09/2026. Não é necessário `psql` nem Docker. |
| — | Resolução de FK | Função única que tenta `unique id` primeiro e cai para nome normalizado. Arquivo reexportado usa o ramo do ID; arquivo antigo usa o ramo do nome. |

## Adiadas para depois do reexport

**Estado em 09/09/2026:** `leadfies` NÃO veio no reexport e não virá — o CSV de 08/09 é o arquivo
final. `scripts/import/05-leads.mjs` fechou N-02 e N-03 com o número medido nesse CSV (a regra e os
volumes estão no cabeçalho dele). **A escolha do implementador ainda não foi ratificada pelo dono da
operação**; até que seja, as duas linhas abaixo continuam valendo como decisão e a pendência está
registrada em `PENDENCIAS.md`.

| # | Decisão | Por quê |
|---|---|---|
| N-02 | `Arquivado` → `lost` ou `discarded` | R-07 mostra que o mapa se contradiz (1.044 × 5.107). Só remedir com o arquivo íntegro. |
| N-03 / R-08 | Escada de nomes de corretor nos leads | Deixa de existir se o reexport trouxer `unique id`. |
| N-09 | Criar `ad_campaigns` de `leadfies.Imóvel` | Default: **não**. Reversível depois. |
| N-13 | Deduplicar leads por telefone | Default: **não deduplicar** — fiel ao histórico. |

## Ordem de trabalho

**Onda 1 — não depende do reexport (em execução):** infraestrutura, pessoas, catálogo, negócios, jogo e metas.

**Onda 2 — espera os arquivos reexportados:** leads, observações, documentos e históricos.

**Onda 2, estado em 09/09/2026:** o reexport chegou para `pipelines`, `observacaoPipelines`,
`historicoPipes` e `Users`; `leadfies` e `doc-clientes` ficaram no CSV de 08/09 e não terão outra
versão. Os quatro domínios da onda 2 já têm carga escrita e registrada na esteira do `run.mjs`:
`03b-historico` (observações e histórico de anexos), `05-leads` e `06-documentos`. O roteiro de
operação das três está em `COMO_RODAR.md`.

## Volumes desta página

Medidos no `--dry-run` de 09/09/2026 sobre o reexport: **7.579 negócios**, **7.560 casos de CCA**,
**205 pessoas desligadas**. Os `mapa/*.md` publicam 7.568 / 7.549 / 204 e estão certos lá — eles
declaram medir o CSV de 08/09, que é um arquivo mais antigo e menor. Não "corrija" um pelo outro:
o que vale para conferir a carga é o número do reexport, que é o arquivo que ela lê.
