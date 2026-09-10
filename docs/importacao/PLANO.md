# PLANO DE IMPORTAÇÃO — Bubble → Supabase (FACEIMOB)

Consolidado crítico de 9 perfis de origem, 6 restrições de alvo, 6 mapeamentos e 12 verificações
adversariais. Escrito em 09/09/2026.

**Procedência de cada número deste documento:** `[medido]` = comando que rodei nesta sessão contra
os arquivos do repositório; `[refutação:arquivo]` = número reproduzido por uma verificação adversarial
em `docs/importacao/refutacao/`; `[mapa:arquivo]` = número que o mapeamento publica e que **nenhuma**
verificação reproduziu de forma independente. Onde o mapa e a refutação divergem, **vale a refutação**
e o mapa está errado até ser corrigido.

**Nada foi executado contra o banco.** Todo o estado do destino descrito aqui foi inferido de
`supabase/migrations/`, `supabase/seed.sql`, `supabase/seeds/` e do snapshot em `SCHEMA_ALVO.md`.

---

## 1. Cobertura dos 23 CSVs

Os 23 arquivos existem em `DOCUMENTOS/DADOS_BUBBLE/`. Contagem feita com o módulo `csv` do Python 3
(nunca `wc -l`: há quebra de linha dentro de aspas em `dicadeouros`, `mensagemdodias`,
`observacaoPipelines` e `leadfies`). **Todos os 23 têm perfil e todos os 23 têm destino declarado em
algum mapeamento. Não há arquivo órfão.**

| # | Arquivo | Registros | Col. | Perfil | Mapa | Destino |
|---|---|---:|---:|---|---|---|
| 1 | `export_All---DadosGames-modified_…19-36-26.csv` | 7 | 14 | gamificacao | game_metas | `game_seasons` + `game_scoring_rules` |
| 2 | `export_All---gameficacaos-modified--_…19-36-34.csv` | 1.063 | 19 | gamificacao | game_metas | `game_season_results` (629 úteis; 434 legado descartado) |
| 3 | `export_All-Construtoras-modified_…19-36-44.csv` | 41 | 13 | catalogo | catalogo | **descartado** — snapshot 25 min mais velho do #4 |
| 4 | `export_All-Construtoras-modified_…19-37-19.csv` | 41 | 13 | catalogo | catalogo | `developers` |
| 5 | `export_All-Equipes-modified_…19-38-04.csv` | 12 | 14 | hierarquia | pessoas | `teams` |
| 6 | `export_All-Users-modified--_…19-44-45.csv` | 298 | 34 | usuarios/hierarquia | pessoas | `auth.users` + `profiles` + `user_roles` + `team_members` |
| 7 | `export_All-corretors-modified_…19-37-25.csv` | 365 | 11 | hierarquia | pessoas | decide papel e roleta (`distribution_group_members`); não vira tabela própria |
| 8 | `export_All-dicadeouros-modified_…19-37-31.csv` | 10 | 6 | catalogo | catalogo | `gold_tips` |
| 9 | `export_All-doc-clientes-modified_…19-37-56.csv` | 25.890 | 23 | documentos | documentos | `deal_documents` + `storage.objects` + `deal_clients` |
| 10 | `export_All-doc-clientes_…19-37-42.csv` | 25.890 | 7 | documentos | documentos | **descartado** — subconjunto de colunas do #9 |
| 11 | `export_All-financeiros_…19-38-25.csv` | 26 | 7 | metas | game_metas | **sem destino** (decisão N-16) |
| 12 | `export_All-gerentes-modified_…19-38-54.csv` | 22 | 10 | hierarquia | pessoas | `teams.manager_id` / `teams.director_id`; não vira tabela própria |
| 13 | `export_All-historicoPipes-modified_…19-39-27.csv` | 10.343 | 9 | documentos | documentos | `deal_history` (decisão N-12) |
| 14 | `export_All-leadfies-modified--_…19-40-11.csv` | 102.799 | 42 | leads | leads | `leads` + `lead_comments` |
| 15 | `export_All-ligacoes_…19-41-06.csv` | 8.365 | 6 | leads | leads | `lead_events` kind=`call` |
| 16 | `export_All-links_…19-41-17.csv` | 3 | 6 | catalogo | catalogo | `useful_links` |
| 17 | `export_All-mensagemdodias-modified_…19-41-43.csv` | 18 | 6 | catalogo | catalogo | `important_notices` |
| 18 | `export_All-meta-constutoras-modified_…19-41-57.csv` | 402 | 9 | metas | game_metas | **sem destino** (decisão N-15) |
| 19 | `export_All-meta-equipes-modified_…19-42-19.csv` | 201 | 9 | metas | game_metas | `goals` (191 úteis; 10 sem equipe/mês) |
| 20 | `export_All-observacaoPipelines-modified_…19-43-41.csv` | 24.766 | 8 | observacoes | negocios | `deal_history` |
| 21 | `export_All-pipelines-modified--_…19-43-56.csv` | 7.568 | 110 | pipelines | negocios | `deals` + `deal_clients` + `deal_participants` + `cca_cases` |
| 22 | `export_All-resultado-anuals-modified_…19-44-26.csv` | 67 | 8 | metas | game_metas | `annual_results` (66 após a duplicata de 2024-11) |
| 23 | `export_All-vendas-modified_…19-45-58.csv` | 6 | 14 | gamificacao | game_metas | **descartado** — resíduo abandonado, coberto por `pipelines` |

**Total: 208.203 registros na origem** `[medido]`. Cinco arquivos entram como descarte deliberado
(#3, #10, #23 por redundância comprovada; #11 e #18 por decisão pendente de dono).

**Ressalva sobre "coberto":** cobertura aqui significa *perfilado e com destino declarado*. Ela **não**
significa que os números do mapeamento estejam certos — 12 de 12 verificações adversariais refutaram
pelo menos um número do mapa que auditaram. Ver §5.

---

## 2. As 62 tabelas do alvo: quem recebe o quê

O `SCHEMA_ALVO.md` lista **61** tabelas. As migrations criam **62** `[medido: diff entre os
`create table public.*` das 86 migrations e a lista do SCHEMA_ALVO]`. **`work_shifts` está faltando no
SCHEMA_ALVO** — criada em `0004_distribution.sql`, semeada com 3 turnos em `seed.sql:100`, é FK
NOT NULL de `checkins.shift_id` e é lida por `AdminLeadAutomation.tsx`. Nenhum mapa a menciona como
destino, o que está certo (não há origem), mas o documento de referência do alvo tem um buraco.

### 2.1 Recebem dado da importação (22 tabelas)

| Tabela | Linhas | Origem | Fonte do número |
|---|---:|---|---|
| `auth.users` + `auth.identities` | 298 + 298 | Users | `[mapa:pessoas §8]` |
| `profiles` | 298 | Users | `[refutação:pessoas-*]`, reproduzido 3× |
| `user_roles` | **317** | Users + corretors | `[refutação:pessoas-schema]` reproduziu 317 pela regra; o SQL do mapa entrega 318 |
| `teams` | 12 | Equipes | `[refutação:pessoas-*]` |
| `team_members` | 267 (88 abertos / 179 fechados) | Users.equipe | `[refutação:pessoas-integridade]` |
| `distribution_group_members` | **87** (mapa diz 88) | corretors ∩ Users | `[refutação:pessoas-integridade]` — o 88º é o único administrador |
| `developers` | 41 | Construtoras | `[refutação:catalogo-*]`, 3× |
| `developer_projects` | 625 | pipelines | `[refutação:catalogo-*]`, 3× |
| `lead_sources` | +6 ou +12 | leadfies + pipelines | `[mapa:catalogo]` × `[mapa:leads]` — divergem entre si |
| `useful_links` | 3 | links | `[medido]` |
| `gold_tips` | 10 | dicadeouros | `[medido]` |
| `important_notices` | 18 (17 com decisão) | mensagemdodias | `[medido]` |
| `deals` | 7.568 | pipelines | `[medido]` + `[refutação:negocios-*]` |
| `deal_clients` | 7.904 | pipelines | `[mapa:negocios §10]` — não reproduzido por ninguém |
| `deal_participants` | 20.722 | pipelines | `[refutação:negocios-integridade]` |
| `deal_history` | 24.552–24.593 | observacaoPipelines (+historicoPipes) | `[refutação:negocios-dados e -integridade]` — o mapa diz 24.551 e as duas refutações chegaram a números diferentes entre si |
| `cca_cases` | 7.549 | pipelines.STATUS2 | `[refutação:documentos-integridade]` |
| `deal_documents` | 29.741–30.915 | doc-clientes + pipelines.documentos | **não reproduzível** — 4 números conflitantes, ver §3.4 |
| `leads` | 41.367 (12 m) ou 102.799 | leadfies | `[medido: 102.799]`; o corte de 12 m não reproduz (40.852 × 41.367) |
| `lead_comments` | 2.970 ou 7.432 | leadfies.Observações | `[refutação:leads-integridade]` |
| `lead_events` kind=`call` | 5.051 ou 6.421 | ligacoes | `[mapa:leads §9]` |
| `game_seasons` / `game_scoring_rules` / `game_season_results` / `goals` / `annual_results` | 7 / 35 / 629 / 191 / 66 | DadosGames, gameficacaos, meta-equipes, resultado-anuals | `[refutação:game_metas-*]`, 3× |

### 2.2 Ficam com dado de catálogo/seed — **e o destino NÃO está vazio**

**Este é o achado que invalida a maioria das verificações de aceite escritas nos mapas.** O snapshot
do `SCHEMA_ALVO.md` registra `teams 3`. `seeds/010_identity_and_teams.sql` insere **2** equipes
(`Equipe Paulista`, `Equipe Sul`) e `seeds/060_demo_showcase.sql` insere **1** (`Equipe Centro`)
`[medido]`. Logo **as fases de seed 010 a 060 foram todas aplicadas** — inclusive a de demonstração,
que os mapas de catálogo e de jogo tratam como hipótese ainda não confirmada.

Confirmado de forma independente pelo resto do snapshot: `profiles 24`, `developers 2`, `deals 32`,
`game_seasons 4`, `notifications 1839`, `lead_events 1070`.

| Tabela | Origem do dado existente | Consequência para a carga |
|---|---|---|
| `pipeline_stages` (9) · `cca_stages` (6) · `document_types` (9) · `work_shifts` (3) · `permissions` · `role_permissions` · `stage_permissions` | `seed.sql` | Catálogo estável. `document_types` e `cca_stages` só mudam se N-19/N-20 mandarem |
| `lead_sources` (6) · `distribution_groups` (2) | `seed.sql:111,120` | A carga acrescenta; `fila-geral` é **pré-requisito de FK** do passo de roleta |
| `developers` (2) · `developer_projects` (4) · `sdr_agents` · `whatsapp_templates` · `allowed_ips` · `distribution_group_forms` | `seeds/020` | **`developers` fecha em 43, não 41**; `developer_projects` em 629, não 625 |
| `useful_links` (3) · `important_notices` (2) · `gold_tips` (3) · `game_seasons` · `game_season_results` (3) · `goals` · `annual_results` (2026-08 e 2026-09) · `marketing_investments` · `public_links` · `funnel_targets` | `seeds/040` | `useful_links` fecha em 6; a dica que o mural mostra é a **do seed**, não a do Bubble; `annual_results` fica com 2 meses fictícios que a origem não cobre |
| `profiles` · `teams` · `deals` · `leads` · `checkins` · `cca_cases` · `game_events` · `tasks` · `visits` · `notifications` | `seeds/010`, `030`, `050`, `060` | Dado de demonstração **misturado** com o importado. Toda contagem de aceite precisa ser escopada por procedência |

### 2.3 Ficam vazias (18 tabelas) e o que isso faz nas telas

| Tabela | Fica vazia porque | Tela | Quebra? |
|---|---|---|---|
| `lead_assignments` | decisão do mapa de leads (evita 2 notificações por linha) | `/leads` | **Não.** `leads.assigned_to` carrega a informação |
| `lead_attachments` | sem origem | anexo de lead | Não — recurso novo |
| `visits` | sem origem no Bubble | `/atividades` | Não — a página lê `tasks` via `listOpenTasksVisible` `[medido]` |
| `tasks` | sem origem | `/atividades` | Não — nasce com o que os seeds 040/050/060 deixaram |
| `checkins` | sem origem | `/checkin` e **a roleta** | **Não quebra, mas trava a operação:** `distribution_queue()` filtra por check-in do dia. Ninguém recebe lead até bater ponto. É comportamento correto, não defeito |
| `closed_months` / `month_reopenings` | fechamento é ato operacional | `/resultados` | Não |
| `developer_submissions` | sem origem | envio à construtora | Não |
| `cca_case_events` | decisão N-21 | linha do tempo do caso CCA | Não — cai para o comentário livre |
| `funnel_targets` | seed global 10/40/50 cobre | `/checkpoint` | Não |
| `marketing_investments` | nenhum CSV corresponde | `/marketing` (CPL) | **Sim, parcialmente:** sem investimento e sem `ad_campaigns` (N-09), o CPL da operação fica vazio |
| `ad_campaigns` | decisão N-09 (default: não criar) | `/marketing` | **Sim:** 102.799 leads caem em "Sem construtora" |
| `daily_reports` / `daily_entries` | não há CSV de diário | `/diario`, `/checkpoint` | Não — começa do zero por desenho |
| `remarketing_lists` / `remarketing_contacts` | sem origem | `/sdr` | Não |
| `sdr_conversations` / `sdr_messages` | sem origem | `/sdr` | Não |
| `whatsapp_inbound_messages` | sem origem | — | Não |
| `access_provision_log` / `role_change_log` | auditoria, nunca import | — | Não |

**Nenhuma tela quebra por tabela vazia.** As duas perdas reais de função são de negócio, não técnicas:
o CPL de marketing (N-09) e a linha do tempo da esteira de crédito (N-21).

---

## 3. O que ninguém verificou e é material para a carga

Ordenado por quanto pode custar.

**3.1 O estado real do banco de destino.** Nenhuma das 12 verificações adversariais executou uma linha
contra o banco — e nem podia. Todo o §2.2 acima é inferência de arquivo. **Antes de qualquer carga
alguém precisa rodar o inventário de contagens no destino real** (fase 0 da §6). Se a fase 060 tiver
sido só parcialmente aplicada, ou se alguém tiver mexido pela tela, os números do §2.2 mudam.

**3.2 O contrato do de-para. Seis mapas propõem seis tabelas incompatíveis com o mesmo papel** `[medido]`:

| Mapa | Objeto | Colunas | PK |
|---|---|---|---|
| pessoas | `import.bubble_map` | entity, bubble_id, display_norm, target_table, target_id, imported_at | (entity, bubble_id) |
| catalogo | `public.import_bubble_map` | bubble_table, bubble_id, target_table, target_id, imported_at, notes | (bubble_table, bubble_id) |
| leads | `public.import_bubble_map` | bubble_table, bubble_id, target_table, target_id, imported_at | (bubble_table, bubble_id, target_table) |
| negocios | `public.import_bubble_map` | entity, bubble_key, target_table, target_id, note | (entity, bubble_key) |
| documentos | `public.import_bubble_map` | entidade, bubble_id, tabela, registro_id, detalhe, criado_em | (entidade, bubble_id, tabela) |
| game_metas | `private.import_bubble_map` | source_table, bubble_id, target_table, target_pk, imported_at | (source_table, bubble_id, target_table) |

Três schemas diferentes (`import`, `public`, `private` — só `private` existe hoje `[medido]`), quatro
conjuntos de nomes de coluna, três aridades de PK. Cinco deles usam `create table if not exists`:
**o primeiro a rodar vence e os outros quatro viram no-op silencioso, quebrando no primeiro `insert`
com 42703.** A refutação de documentos achou 2 dos 6; os outros 4 são novos aqui. E duas dessas PKs
(as de 2 colunas) **proíbem** o mesmo `bubble_id` apontar para duas tabelas destino — que é exatamente
o uso real de `pipeline → deals` **e** `pipeline → cca_cases`.

**3.3 O volume real de bytes do storage.** `[mapa:documentos §8]` estima ≈4,5 GB numa faixa de 4,5 a
18,7 GB, extrapolada de uma amostra HEAD de **n=39** sobre 30.279 objetos — 0,13% numa distribuição
declaradamente de cauda longa. Ninguém rodou HEAD nas 30 mil URLs, e ninguém verificou se as URLs do
CDN do Bubble ainda respondem. Se o plano do Bubble já tiver caído, o domínio inteiro de documentos é
irrecuperável e nenhum documento diz isso.

**3.4 O total de `deal_documents` não é reproduzível.** Quatro números circulam para a mesma grandeza:
29.263 (perfil), 29.721, 29.741 e 30.279/30.915 (mapa) `[refutação:documentos-dados e
documentos-integridade, que chegaram a números diferentes entre si]`. Nenhuma das duas verificações
reproduziu o número do mapa a partir da regra escrita. **Sem esse número não há critério de aceite
para a fase mais cara da carga inteira.**

**3.5 O fuso horário.** Declarado como suposição em 4 mapas, refutável em 5 minutos abrindo um
registro no Bubble e comparando com o CSV, **e ninguém fez**. Se for UTC, ~4% dos registros mudam de
dia — e de mês na virada, o que desloca `deals.month_base`, o fechamento mensal e o placar do jogo.

**3.6 A resolução `leadfies.Imóvel` → `developers`** (104 campanhas / 34.333 leads / 18 construtoras)
está publicada em `[mapa:catalogo §6.3]` e a verificação registrou explicitamente que **não a
reproduziu** — confirmou só os insumos. A coluna "leads" da tabela de construtoras ativas depende dela.

**3.7 Se o reexport sem `-modified` é possível.** A decisão N-05, de alto impacto, depende de uma
rodada nova de export do Bubble. Ninguém verificou se a conta ainda permite exportar, quanto tempo
leva, ou se o schema do Bubble mudou desde 08/09.

**3.8 O encoding de `leadfies` é recuperável?** 337.879 caracteres U+FFFD `[refutação:leads-*]`. A
correção proposta é reexportar. Ninguém testou se um reexport corrige — pode ser corrupção na origem.

**3.9 Nenhum mapa declara sob qual papel a carga roda de ponta a ponta.** As refutações provaram três
restrições incompatíveis: `deal_documents_storage` e `deals_guard_document_review` exigem
`postgres`/`service_role`; `lead_comments_insert` amarra `author_id = auth.uid()`, logo **só**
`service_role`; e `alter table … disable trigger` exige **dono da tabela**, que `service_role` não é e
que PostgREST não executa. **Conclusão: a carga tem de ser `psql` como `postgres`. Nenhum mapa escreve
isso.**

**3.10 Consistência entre mapas.** Cada verificação auditou um mapa isolado. Números que aparecem em
dois mapas com valores diferentes não foram confrontados por ninguém: `developer_projects` 625
(catalogo) × 635 (negocios); `lead_sources` +6 (catalogo) × +12 (leads); `deal_history` 24.551
(negocios) × 24.572/24.593 (refutações).

---

## 4. Decisões de negócio pendentes (consolidadas, sem repetição)

51 decisões cruas nos 6 mapas → **28 depois de fundir as repetidas.** Fusões: fuso horário
(leads D7 = negocios D9); reexport sem `-modified` (negocios D8 = documentos D8); recorte temporal
(pessoas 7.8, catalogo D7 e game D9 não têm o que cortar — só leads e negócios têm escolha real);
de-para (game D8 absorve o conflito de §3.2).

### 4.1 Travam a carga — precisam de resposta antes de rodar

| # | Decisão | Opções e consequência de cada uma |
|---|---|---|
| **N-01** | **Fuso do Bubble: `America/Sao_Paulo` ou UTC?** | **São Paulo:** o que todos os mapas assumem; se estiver errado, todo horário está 3 h adiantado. **UTC:** ~4% dos registros mudam de dia, e na virada de mês mudam `deals.month_base`, o fechamento e a temporada do jogo. **Custo de resolver: 5 minutos** abrindo um negócio conhecido no Bubble |
| **N-02** | **`Arquivado` vira `lost` ou `discarded`?** | A pergunta está mal posta no mapa e por isso trava. **(a) `Contato Inválido` é descarte** → 5.105 `discarded` / 31.160 `lost`. **(b) não é** → 1.044 / 35.221. `lost` conta como perda no funil e **exige `lost_at`**; `discarded` **exige `lost_at` NULL** (`leads_lost_consistency`). Escolher errado derruba o lote inteiro por constraint |
| **N-03** | **Os 17 nomes de corretor ausentes de `Users` (2.361 leads)** | **REABERTA:** 4 dos 17 EXISTEM em `Users.Nome_completo`, 2 deles **ativos** (`Janaina Fraga`, `Kelvin Castro`) `[refutação:leads-integridade]`. **Criar perfil `terminated`** para eles = perfil duplicado de gente em atividade, quebrando `team_members`, `auth_visible_profiles()`, rateio de VGV e pódio. **Deixar NULL** = 2.361 leads na bandeja da gestão. **A resposta certa é nenhuma das duas: corrigir a escada de nomes primeiro (R-08)** |
| **N-04** | **`document_review_status='approved'` nos negócios fechados?** | **(a) `approved` nos 7.072 fechados:** é a recomendação do mapa — **mas dispara a reversão de `cca_cases_sync_esteira_label` em 1.267 negócios** (R-04). **(b) `draft` em tudo:** honesto, mas 7.072 negócios travam no primeiro UPDATE de etapa por `deals_guard_stage`. **(c) `approved` + carga de CCA na ordem invertida:** funciona; é a mitigação de R-04 |
| **N-05** | **Reexportar do Bubble sem `-modified`?** | **(a) reexportar** `observacaoPipelines`, `doc-clientes` e `historicoPipes`: as FKs voltam como `unique id` e **1.723 linhas** deixam de depender de heurística de nome `[refutação:negocios-dados]`. **(b) não:** 724 observações + 779 doc-clientes + 220 históricos ficam sujeitos a desempate por janela de data que **elege candidato único em só 435 dos 724 casos** — os outros 289 caem em escolha arbitrária, e `on conflict (id) do nothing` **nunca corrige** numa reimportação |
| **N-06** | **Contrato único do de-para** | Ver §3.2. Sem escolher um dos 6, a carga não começa. **Recomendação: `public.import_bubble_map` com PK de 3 colunas** (entidade, bubble_id, tabela) — é a única forma que aceita o mesmo `bubble_id` apontando para duas tabelas destino |

### 4.2 Escopo — mudam o volume, não travam

| # | Decisão | Opções e consequência |
|---|---|---|
| **N-07** | **Quanto histórico de leads importar** | **A (102.799):** relatório multi-ano; 60% nasce morto e 100 mil telefones entram em escopo de LGPD sem consentimento documentado. **B (27.477 ativos):** CRM limpo, relatório de 2024/25 sem base. **C (12 meses):** recomendado pelo mapa — **mas o número não reproduz** (40.852 × 41.367) e o mapa não diz qual coluna de data define o corte |
| **N-08** | **7.568 negócios ou só os 2.640 com valor?** | **(a) tudo:** o denominador de toda taxa de conversão existe. **(b) enxuto:** −65% de linhas e some o denominador. Recomendação do mapa: (a) — 7.568 é volume trivial e o corte não economiza risco |
| **N-09** | **Criar 335 `ad_campaigns` de `leadfies.Imóvel`?** | **Sim:** 34.333 leads ganham construtora em `/marketing`, ao custo de `total_spend=0` (zera o CPL da operação) **e de 14 colisões de `external_id` que abortam a carga** (R-09). **Não (default):** os 102.799 caem em "Sem construtora". Reversível depois, se `leads.campaign_id` receber a mesma chave agora |
| **N-10** | **Importar as 204 pessoas desligadas?** | **Sim (recomendado):** nenhum negócio, lead, documento ou ponto histórico fica órfão — o legado referencia 290 pessoas em `corretors`. **Não:** 4.096 linhas de `deal_participants` caem por FK restrict `[refutação:negocios-integridade]` |
| **N-11** | **Importar o placar histórico do jogo (629 linhas)?** | **Sim:** 7 temporadas com pódio na tela. **Não:** nada operacional se perde — o placar do Bubble não alimenta comissão nem relatório fiscal. **Mas 55 dos 142 participantes estão `Ativo=não`** e 160 das 629 linhas dependem de N-10 `[refutação:game_metas-dados]` |
| **N-12** | **Importar `historicoPipes` (10.343 snapshots) em `deal_history`?** | **Sim:** auditoria de quem anexou o quê e quando, com **zero** arquivo extra. **Não:** o histórico anterior a 08/09/2026 desaparece |
| **N-13** | **Deduplicar leads por telefone?** | 14.005 telefones em 2+ leads (36.751 leads). **Não deduplicar:** fiel ao histórico, mas dois corretores trabalham o mesmo número. **Deduplicar:** apaga 22.746 registros e o histórico de re-entrada. O banco **não** tem unique em telefone, de propósito |
| **N-14** | **O lote Instagram de nov/2024 (719 leads)** | Layout próprio, sem status/atividade/grupo/motivo. **`discarded`** (mantém rastro) ou **não importar** (0,70% do arquivo) |
| **N-15** | **Metas por construtora (402 linhas)** | **(a) descartar:** perde o desdobramento por incorporadora; a série já tem 6 buracos. **(b) migration** com `developer_id` em `goals`: preserva, mas abre tela nova a construir. **(c) CSV fora do banco** |
| **N-16** | **Plano de pagamento (`financeiros`, 26 linhas / 7 negócios)** | **(a) não importar (recomendado):** tabela nova para 26 linhas com rótulo texto livre e sem `unique id`. **(b) depois**, com reexport e uma `deal_payment_items` |
| **N-17** | **`meta_remuneracao` (160 valores)** | **(a) descartar:** perde o patamar contratual de comissão de 2024-09 a 2026-09. **(b) migration** com `'sales_comp'` no CHECK de `goals.metric`: preserva, mas cria métrica que nenhuma tela lê |

### 4.3 Semântica — mudam o que a tela mostra

| # | Decisão | Opções e consequência |
|---|---|---|
| **N-18** | **`BACEN` (465) e `RESTRIÇÃO` (201) são reprovação ou pendência?** | `rejected`: 666 negócios aparecem como reprovados no quadro do CCA e não geram rótulo de funil. `pending_documents`: viram fila de pendência ativa e o negócio recebe `RET. ESTEIRA AGIL` — parece trabalho a fazer num negócio antigo |
| **N-19** | **`DISTRATO`/`QUEDA` (290 casos)** | (a) criar `cca_stages` com `status='cancelled'` — 1 linha de seed, resolve o fallback; (b) não criar caso de CCA — perde o registro de que passaram pela esteira; (c) deixar como está: os 290 aparecem em "Pendência de Documentos", sugerindo trabalho que não existe |
| **N-20** | **`document_types` cresce de 9 para 12?** | Manter 9: **29,3% dos arquivos caem em `outros`** e 2.245 nascem escondidos por versionamento. Criar 3 com `allows_multiple=true` (`carta_cancelamento` 763, `identificacao_extra`, `renda_extra`) reduz os dois problemas, mas mexe no seed e na tela do CCA |
| **N-21** | **`cca_case_events` das observações com prefixo `STATUS:` (4.561)?** | **Sim:** o caso de crédito ganha linha do tempo real, com autor e data. **Não:** nasce vazio e o histórico da esteira fica só no comentário livre |
| **N-22** | **`ANÁLISE EXTERNA` (86) foi para a construtora ou a agência?** | Muda só a coluna do quadro; o rótulo do funil é o mesmo. Sem resposta: `sent_to_agency`, e `sent_to_developer` nunca é usado |
| **N-23** | **As 22 construtoras `CCA Externo` entram com que fluxo?** | **(A) `internal` nas 41 (default):** nada quebra, alguém preenche 22 e-mails na tela antes do primeiro negócio novo. **(B) `external` com placeholder:** o cron **manda e-mail de verdade com anexo de cliente** para endereço inventado — e `developers_submission_email_format` (`0063:84-91`) rejeita placeholder mal formado. **(C) `external` com caixa interna:** correto, com reencaminhamento manual |
| **N-24** | **VGV bruto ou líquido?** (não dá os dois) | **(a) bruto + `discount_pct`:** o líquido erra até **R$ 2.000,00**, total **R$ 5.804,33** `[refutação:negocios-dados; o mapa publica R$ 20,20 / ~R$ 4 mil, medido excluindo a linha que a própria regra quebra]`. **(b) líquido:** exato, mas o desconto de R$ 12,6 mi desaparece. **(c) bruto sem desconto:** infla o VGV em R$ 12,6 mi |
| **N-25** | **`resultado-anuals`: 2024-11 duplicado e 2024-10 ausente** | Duplicata: a linha B (59 vendas / R$ 12.069.138,34) bate com `pipelines` a 0,002% — mas a linha A está no legado há 2 anos e pode ter virado número oficial em alguma apresentação. 2024-10: deixar o buraco (11 pontos no gráfico) ou lançar 91 vendas recontadas, com `notes` marcando que é derivado |
| **N-26** | **As metas de 2025-09 a 2025-12 são vendas mesmo?** | A soma mensal salta de ~90 para 138/162/209/**363**. Importar como está = 4 meses de fracasso artificial no gráfico realizado × meta. Excluir = buraco na série. Corrigir exige o número certo, que só a operação tem |
| **N-27** | **O nome original com CPF pode aparecer na tela?** | 1.113 arquivos com CPF formatado no nome `[refutação:documentos-dados]`. Mascarar em `stored_name` e manter `original_name` preserva a auditoria; não mascarar expõe CPF em log e em **anexo de e-mail para a construtora** |
| **N-28** | **Baixar do CDN antes ou depois de encerrar o Bubble?** | As URLs são **públicas sem autenticação** — qualquer pessoa com o link lê CPF, holerite e extrato. Enquanto o Bubble estiver de pé o vazamento continua ativo; migrar para bucket privado só o encerra quando os links antigos deixarem de existir |

**Decisões com default seguro, que seguem sem perguntar** (`CLAUDE.md`: "para detalhes seguros e
reversíveis, faça a suposição mais conservadora e siga"): `LOTTICI` × `LOTTICCI` não fundir, com
`LOTTICCI` inativa; 17 das 18 mensagens do mural, todas `active=false`; heurística de título com
revisão humana depois; `teams.active=true` nas 12; `SERVICOS GERAIS`/`JR` sem papel e sem bloqueio;
manter o vínculo que `Users.equipe` diz para os 2 gerentes; baixar as 87 fotos; `deals.code = BUB-<uid>`;
`DISTRATO` como `lost`; `status_detail='OFF'` nos 4.400 com o rótulo em `lost_reason`; acrescentar
`Leadfy`/`Lead Loja`/`Lead Feirão` ao `<Select>` de origem; abrir a temporada nova ao final da carga.

**Pendências de identidade que não são decisão, são correção:** `Gerente Interino` (placeholder que
carrega `director` e por isso ganha leitura ampla via `can_read_all()`); os 6 CPFs duplicados
(12 pessoas, 3 pares parecem a mesma pessoa cadastrada duas vezes); e o par `Isaias Lucca` /
`Isaías Luca` — mesma pessoa, dois e-mails que diferem em um único acento, e `citext` é
case-insensível mas **não** acento-insensível `[refutação:game_metas-schema]`.

---

## 5. Riscos bloqueantes, em ordem de gravidade

Bloqueante = faz a carga **falhar** (aborta, ou a verificação de aceite reprova uma carga correta) ou
**corrompe dado** (grava fato falso, ou destrói dado existente).

| # | Risco | Efeito | Mitigação |
|---|---|---|---|
| **R-01** | **Seis DDLs incompatíveis de de-para** (§3.2) | `create table if not exists` faz os 5 perdedores virarem no-op; o segundo script quebra com 42703 — ou pior, grava numa tabela cuja PK **proíbe** `pipeline → deals` e `pipeline → cca_cases` ao mesmo tempo | Fase 1: uma migration única, `public.import_bubble_map` com PK de 3 colunas, **`enable row level security` + policy `is_admin()`**. Sem RLS a tabela nasce legível e gravável por `anon` (`0023:65-66` mantém o default privilege) e `scripts/validate-schema.sh:110-123` sai com código 1 |
| **R-02** | **O destino não está vazio** (§2.2) | 5 das 8 verificações de catálogo, 4 das 5 do jogo e as contagens de negócios **reprovam uma carga correta**. E 2 linhas de `annual_results` inventadas (2026-08, 2026-09) sobrevivem à carga sem marca que as distinga | **Todo aceite deste plano é escopado por procedência** (`join import_bubble_map`), nunca `count(*)` de tabela. Antes da carga, desativar o conteúdo de seed que disputa o mural. **Não apagar** as 2 construtoras nem os 4 empreendimentos do seed: `deals.developer_id` é `on delete restrict` e `seeds/030` aponta para elas — o delete é recusado pelo banco |
| **R-03** | **NOT NULL sem valor** — a linha `1780772620462x354212239768173300` ("Teste Leadfy Integ") tem `STATUS`, `mes`, `ENVIO` e `mudou_status` **todos vazios** | `deals.month_base` e `stage_entered_at` são NOT NULL e as três cadeias de fallback terminam em `ENVIO`. Com transação única, **as 7.568 linhas fazem rollback**. Se o ETL "consertar" omitindo a coluna, entra `month_start(current_date)` e o negócio de jun/2026 vai para set/2026 | Estender o fallback até `Creation Date` (preenchido em 7.568/7.568), **ou** descartar essa linha e ajustar o volume para 7.567 — ela não tem valor, então o VGV não muda |
| **R-04** | **`cca_cases_sync_esteira_label` reverte a conferência documental** | Caso entrando `pending_documents` num negócio já `approved` — que é exatamente o que N-04(a) produz — faz `document_review_status` voltar para `returned`, `document_reviewed_by = NULL`, **1.267 reversões silenciosas + 1.267 linhas falsas em `deal_history` + 1.372 notificações `in_app`** na tela dos corretores. E `deals_guard_stage` passa a recusar o avanço: a carga produz o travamento que N-04 existia para evitar | Carregar os 1.454 casos primeiro como `under_review` (o ramo não dispara) e só depois `update … set status='pending_documents'` **com o gatilho desligado**, gravando `deals.status_detail` no mesmo bloco. Trocar a limpeza pós-carga de `channel <> 'in_app'` para `sent_at is null and created_at >= :inicio_carga` |
| **R-05** | **`team_members` não tem chave de idempotência para linha fechada** | O unique parcial só cobre `left_at is null`. 179 das 267 linhas não são cobertas por nada: rodar o passo duas vezes insere +179 sem erro, sem conflito e sem log. E a receita de reimport indicada (`people.ts:210-243`) **carimba data de saída de hoje nos 88 vínculos abertos** — 88 desligamentos fabricados, e nenhuma trava do banco dispara | `create unique index team_members_import_key on public.team_members (profile_id, team_id, joined_at)` **antes** do passo, e `on conflict … do nothing`. Remover de vez a indicação de `people.ts:210-243` como receita de lote |
| **R-06** | **`on conflict (external_id) do nothing` contra índice PARCIAL** | `leads_external_id_idx` é `unique … where external_id is not null` `[medido: 0005_leads.sql:83-84]`. O Postgres não infere índice parcial como arbiter sem o predicado repetido: **SQLSTATE 42P10, 100% dos chunks falham antes da primeira linha entrar** | `on conflict (external_id) where external_id is not null do nothing`. Validar antes num banco descartável: `create unique index on t(x) where x is not null; insert … on conflict (x) do nothing;` deve devolver 42P10 |
| **R-07** | **A regra `lost` × `discarded` contradiz o número publicado** | O §4.3 do mapa lista sob "Grupo A (1.044 leads)" motivos que somam 5.107 ocorrências. Implementar o texto ao pé da letra classifica 4.061 leads a mais como `discarded` — e `discarded` exige `lost_at` NULL enquanto `lost` exige `lost_at` preenchido: **um script guiado pela contagem errada derruba o lote por constraint** | Resolver N-02 e reescrever as três linhas de `Arquivado`, o Grupo A e os volumes **antes** de escrever o loader |
| **R-08** | **A escada de nomes de leads produz falso positivo e perda silenciosa** | `fernanda lucas teixeira` (85 leads com nome, telefone e e-mail reais) casa com `Fernanda Cardoso Teixeira` — pessoas diferentes, e os leads ficam visíveis para a corretora errada, com marca indistinguível de um acerto. E 1.090 leads que o mapa declara "ausentes de Users" casam por **igualdade exata** com `Users.Nome_completo`, incluindo 2 funcionários **ativos** | Indexar `colaboradores` **e** `Nome_completo` na regra 1 (igualdade exata nas duas, antes de qualquer heurística). Tirar a regra 3 (primeiro+último token) do caminho automático: são 13 pares distintos cobrindo 3.728 leads — vira lista de revisão de 5 minutos |
| **R-09** | **`ad_campaigns.external_id` sintético colide** | Os 335 valores de `Imóvel` produzem **321 slugs**: 14 colisões, 8.816 leads. `external_id` tem unique **global** (`0067:27-28`), criado exatamente para impedir double-count. Com insert puro a carga aborta; com `do nothing` 14 campanhas somem em silêncio e os leads da variante descartada apontam para a campanha errada | Só se N-09 = sim: trocar por `'bubble:' + sha1(Imóvel bruto)[:16]`, nunca slug legível, e replicar a mesma chave em `leads.campaign_id` |
| **R-10** | **`leadfies` tem 337.879 caracteres U+FFFD** | Um de-para literal com `Não definido` / `Indicação` **não casa** — no arquivo são `N�o definido` e `Indica��o`, e a "cobertura 100%" só se sustenta pelo catch-all. E `Vasco \| Casas Regi<FFFD>o Metrop.` (2.857 leads) e a versão íntegra (606) viram duas campanhas distintas | Reexportar `leadfies` com encoding correto — é a única correção real. Sem reexport: tratar U+FFFD como coringa de uma letra e **registrar cada casamento por coringa** no relatório de carga |
| **R-11** | **O SQL de `user_roles` não implementa a regra que o próprio mapa define** | O predicado filtra só por `Funcao`, metade da regra: apaga **10** brokers, não 11. Escapa `Gerente Interino` (`Funcao=GERENTE`, zero fichas em `corretors`). `user_roles` fecha em **318** e **a consulta de aceite do próprio mapa cobra 317** — a carga correta "não fecha" e vira investigação. E o placeholder entra na listagem de corretores e no pódio (`0027:58-63` monta `visible_brokers` por `exists(role='broker')`); como é `Ativo=sim`, não há `banned_until` que o esconda | Trocar o predicado pelas duas metades: `s.funcao not in ('CORRETOR','GERENTE','DIRETOR') or not exists (select 1 from staging.bubble_corretors …)` |
| **R-12** | **O único administrador entra na roleta de leads** | O passo insere em `distribution_group_members` por `corretors.ativo` ∩ `Users.Ativo`, **sem filtro de papel**. `Douglas Gomes` (`Funcao=ADM`) passa nos dois. E `distribution_queue()` (`0074:270-330`) **não consulta `user_roles`**: basta ele bater check-in para receber lead. O número certo é **87**, não 88 | Filtrar também por "mantém `broker` depois do passo de papéis"; ajustar volume e aceite |
| **R-13** | **A carga não roda por PostgREST, e nenhum mapa diz isso** | `alter table … disable trigger a, b` é **erro de sintaxe** (DISABLE TRIGGER aceita um nome, ALL ou USER) e exige **dono da tabela**: `service_role` tem BYPASSRLS mas não é dono, e PostgREST não executa DDL. Sem as travas, `deals_default_month_base` reescreve `month_base` de 411 negócios (irreversível), `deals_add_creator_participant` insere participante espúrio em 2.370 negócios diluindo o rateio, e `deal_participants_autofill` grava gestor em ordinal 1 sobre o histórico | Declarar `psql` como `postgres` como o único caminho. Um `alter table` por gatilho |
| **R-14** | **30.915 linhas de `deal_documents` para 30.279 objetos** | `storage_path` carrega o `deal_id`, então o mesmo arquivo em dois negócios exige **dois** objetos. 636 linhas nascem sem objeto — e a reconciliação pós-carga manda "sobe o arquivo ou apaga a linha", **apagando justamente as linhas dos negócios ambíguos** que a regra existia para preservar | Trocar "30.279 objetos distintos" por "um objeto por par (negócio, arquivo)": baixar 1× do CDN, subir N vezes, uma por caminho |
| **R-15** | **673 arquivos de 82 negócios desaparecem** | Em 87 clientes o registro **mais recente** de `doc-clientes` está vazio (a caixa de anexos foi esvaziada no Bubble). A regra "pegue o snapshot corrente" pega o vazio; `pipelines.documentos` recupera 5. Os 673 não são versão anterior de nada — são os **únicos** arquivos daqueles negócios | Quando o registro corrente for vazio, cair para o registro **não-vazio** mais recente. Custo: ~2,2% de upload |
| **R-16** | **O reimport do jogo destrói a temporada de produção** | O passo 1 (`update game_seasons set closed_at=now() … where closed_at is null`) **não tem filtro de procedência** e está dentro do bloco declarado idempotente. Depois de aberta a temporada de produção, qualquer reexecução a fecha em silêncio: `award_game_points` cai no ramo de jogo parado e **o ponto não é recuperado quando a próxima temporada abrir** — os 4 gatilhos param de pontuar permanentemente, e o único sintoma é um aviso `game_paused` que o passo seguinte da própria carga manda apagar | Trocar por uma pré-condição que **aborta** se houver temporada aberta com `game_events` reais, e fechar só a de vitrine |
| **R-17** | **`zfill(11)` fabrica CPF** | Há 1 valor com 10 dígitos. `zfill` preenche à esquerda; o resultado passa no check `^[0-9]{11}$` (`0046:50-53`) e **ocupa o unique parcial `profiles_cpf_key`** (`0046:70`) com DV inválido, bloqueando o CPF verdadeiro dessa pessoa numa correção futura | `len(dígitos) != 11 → NULL + log` |
| **R-18** | **`auth.identities` sem SQL** | O passo 1 traz só um comentário. Sem essa linha, **298 contas existem e nenhuma faz login por e-mail** | Colar o insert de `seeds/010:81-96` |
| **R-19** | **Avatar em bucket privado com a URL errada** | `avatars` é `public=false` `[medido: 0012:365-369]`. O app grava **URL assinada** e renderiza com `<img src>` direto. Gravar a URL pública do storage ou a do CDN do Bubble quebra as 87 fotos — e o motivo de "baixar" era justamente não depender do Bubble | `createSignedUrl` com prazo explícito |
| **R-20** | **`staging.bubble_users` usado 3× e nunca definido** | Quem executa tem de inventar o DDL, inclusive `u.id`, o uuid que vira `auth.users.id`, depois `profiles.id` e ainda a pasta do avatar (`<profile_id>/avatar.<ext>`). Risco: `import_bubble_map.registro_id` apontar para uuid diferente do que ficou em `profiles` | Publicar o DDL e dizer de onde sai `u.id` |

**Riscos altos não bloqueantes, registrados para não se perderem:** 18 negócios nascem com rateio
inflado (um corretor com 100% onde o legado tinha dois) e com ordinal=2 sem ordinal=1 — e a
conferência `sum(share_pct)=100` **passa**, justamente porque foi inflado; 44 negócios nascem
`stage='lost'` com `outcome='open'` e o primeiro UPDATE faz `deals_guard_stage` carimbar
`closed_at := now()`, transformando a data de perda no dia em que alguém mexeu; 2.039 linhas (27%) de
`mudou_status` trazem `Sep 18, 2024`, carimbo da migração para o Bubble e não data real de fechamento.

---

## 6. Sequência de execução

**Papel:** `psql` como `postgres`. Não há caminho por API para esta carga (R-13).
**Transação:** uma por fase, não uma para tudo — uma transação única de 200 mil linhas transforma
qualquer erro de uma fase em rollback de todas.
**Regra de ouro dos aceites:** toda contagem é escopada por `import_bubble_map`. `count(*)` de tabela
mede seed + demo + import e reprova carga correta (R-02).

### Fase 0 — Inventário do destino e congelamento

Medir antes de mexer. Não escreve dado de negócio.

```sql
-- 0.1 Estado real. O plano assume seeds 010–060 aplicados; confirmar.
select 'teams' t, count(*) from public.teams
union all select 'profiles',            count(*) from public.profiles
union all select 'developers',          count(*) from public.developers
union all select 'developer_projects',  count(*) from public.developer_projects
union all select 'deals',               count(*) from public.deals
union all select 'leads',               count(*) from public.leads
union all select 'game_seasons',        count(*) from public.game_seasons
union all select 'game_season_results', count(*) from public.game_season_results
union all select 'annual_results',      count(*) from public.annual_results
union all select 'goals',               count(*) from public.goals
union all select 'useful_links',        count(*) from public.useful_links
union all select 'gold_tips',           count(*) from public.gold_tips
union all select 'important_notices',   count(*) from public.important_notices
union all select 'lead_sources',        count(*) from public.lead_sources
union all select 'notifications',       count(*) from public.notifications;
-- ACEITE: registrar a saída como LINHA DE BASE por escrito. Todo aceite seguinte é delta sobre ela.
-- Se teams = 3, a fase 060 (demo) rodou e o §2.2 deste plano vale.
```

```sql
-- 0.2 Congelar os 10 crons. `faceimob-assign-queued` roda a cada minuto.
select jobid, jobname, schedule, active from cron.job order by jobname;
select cron.unschedule(jobname) from cron.job where jobname like 'faceimob-%';
-- ACEITE: select count(*) from cron.job where jobname like 'faceimob-%';  -- esperado: 0
```

```sql
-- 0.3 Pausar a roleta. Cinto e suspensório: `assign_lead` honra a pausa (0074:132-134),
--     mas `assign_queued_leads` não a consulta e varre `status='queued'` sozinho.
update public.automation_settings set leads_paused = true where id;
-- ACEITE: select leads_paused from public.automation_settings where id;  -- esperado: t
```

**Aceite da fase:** as três consultas rodaram e a linha de base está registrada.
**Bloqueio:** N-01 (fuso) respondido antes de seguir — é a única suposição que reescreve todas as datas.

---

### Fase 1 — Pré-requisitos de schema

Uma migration. Fecha R-01 e R-05.

```sql
create table if not exists public.import_bubble_map (
  entidade    text        not null,
  bubble_id   text        not null,
  tabela      text        not null,
  registro_id uuid,                 -- NULL = decisão registrada de "não tem correspondente"
  detalhe     jsonb       not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),
  primary key (entidade, bubble_id, tabela)
);
alter table public.import_bubble_map enable row level security;
create policy import_bubble_map_admin on public.import_bubble_map
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create index if not exists import_bubble_map_alvo_idx
  on public.import_bubble_map (tabela, registro_id);

create unique index if not exists team_members_import_key
  on public.team_members (profile_id, team_id, joined_at);
```

```sql
-- ACEITE 1.1 — a tabela existe COM RLS. Sem isso `anon` grava nela via PostgREST
-- (default privilege de 0023:65-66) e validate-schema.sh:110-123 sai com código 1.
select relrowsecurity from pg_class where oid = 'public.import_bubble_map'::regclass;
-- esperado: t

-- ACEITE 1.2 — a chave de idempotência de team_members existe
select indexname from pg_indexes where indexname = 'team_members_import_key';
-- esperado: 1 linha. Se o CREATE falhou por duplicata, há dado sujo no destino: investigar antes de seguir.
```

---

### Fase 2 — Identidade

`auth.users` → `auth.identities` → `profiles` (via gatilho) → UPDATE de perfil → `user_roles` →
`teams` → `team_members` → `distribution_group_members` → avatares.

Correções obrigatórias antes de rodar: R-11 (predicado das duas metades), R-12 (87, não 88),
R-17 (`len != 11 → NULL`), R-18 (colar `auth.identities`), R-19 (`createSignedUrl`),
R-20 (DDL de `staging.bubble_users`), R-05 (`on conflict (profile_id, team_id, joined_at)`).

```sql
-- ACEITE 2.1 — volumes por procedência, imunes ao seed
select
  (select count(*) from public.import_bubble_map where entidade='user'   and tabela='profiles') as perfis,
  (select count(*) from public.import_bubble_map where entidade='equipe' and tabela='teams')    as equipes;
-- esperado: 298 | 12

-- ACEITE 2.2 — papéis: 317, não 318 (R-11)
select count(*) from public.user_roles ur
 join public.import_bubble_map m on m.registro_id = ur.profile_id and m.tabela='profiles';
-- esperado: 317

-- ACEITE 2.3 — roleta sem administrador (R-12)
select p.email from public.distribution_group_members dgm
  join public.profiles p on p.id = dgm.profile_id
 where not exists (select 1 from public.user_roles ur
                    where ur.profile_id = dgm.profile_id and ur.role = 'broker');
-- esperado: 0 linhas

-- ACEITE 2.4 — idempotência de team_members (R-05): rodar a fase 2× não muda nada
select profile_id, team_id, joined_at, count(*)
  from public.team_members group by 1,2,3 having count(*) > 1;
-- esperado: 0 linhas
select count(*) from public.team_members where left_at >= current_date;
-- esperado: 0   (se > 0, a receita de reimport fabricou desligamentos)

-- ACEITE 2.5 — login funciona (R-18)
select count(*) from auth.identities i
 join public.import_bubble_map m on m.registro_id = i.user_id and m.tabela='profiles';
-- esperado: 298

-- ACEITE 2.6 — CPF não fabricado (R-17)
select count(*) from public.profiles p
  join public.import_bubble_map m on m.registro_id = p.id and m.tabela='profiles'
 where p.cpf is not null and length(p.cpf) <> 11;
-- esperado: 0
```

---

### Fase 3 — Catálogo

`developers` → `developer_projects` → `lead_sources` → `useful_links` / `gold_tips` /
`important_notices`.

Antes: desativar o conteúdo de seed que disputa o mural (R-02). **Não apagar** as 2 construtoras nem
os 4 empreendimentos do seed — `deals.developer_id` é `on delete restrict` (`0006:30`) e `seeds/030`
cria negócios apontando para elas, então o delete é recusado pelo banco.

```sql
update public.gold_tips         set active = false where id::text like '6d%';
update public.important_notices set active = false where id::text like '6c%';
```

```sql
-- ACEITE 3.1 — volumes por procedência (nunca count(*) da tabela: R-02)
select tabela, count(*) from public.import_bubble_map
 where tabela in ('developers','developer_projects','useful_links','gold_tips','important_notices')
 group by 1 order by 1;
-- esperado: developers 41 | developer_projects 625 | gold_tips 10
--           important_notices 17 ou 18 (N-decisão) | useful_links 3

-- ACEITE 3.2 — zero órfão de construtora
select count(*) from public.developer_projects dp
 where not exists (select 1 from public.developers d where d.id = dp.developer_id);
-- esperado: 0

-- ACEITE 3.3 — nome de empreendimento aparado: a idempotência prometida depende disso
select count(*) from public.developer_projects where name <> btrim(name);
-- esperado: 0

-- ACEITE 3.4 — tripwire de N-23 na direção certa. `external` sem e-mail já é proibido pela
-- constraint developers_external_needs_email (0003:34-35), então a verificação útil é a inversa:
select count(*) from public.developers d
  join public.import_bubble_map m on m.registro_id = d.id and m.tabela='developers'
 where d.flow = 'internal' and d.submission_email is null;
-- esperado: 22 se N-23 = (A). Conferir a lista nominal das 22 `CCA Externo` à mão.

-- ACEITE 3.5 — a origem de maior volume não herda o agente de SDR do seed
select code, form_id, sdr_agent_id, welcome_template_id
  from public.lead_sources where code in ('meta_ads','portal');
-- esperado: os três campos NULL. O seed 020 os preencheu e o `on conflict (code) do nothing` NÃO limpa;
-- `meta_ads` é o destino de 94.756 leads (92,2%).
```

---

### Fase 4 — Negócios, onda 1

`deals` → `deal_clients` → `deal_participants`. Gatilhos a desligar, **um `alter table` por gatilho**
(R-13): `deals_default_month_base`, `deals_add_creator_participant`, `deal_participants_autofill`,
`deals_award_points`, `deal_documents_award_points`.

Correção obrigatória: R-03 (fallback até `Creation Date`, ou descartar a linha de teste).

```sql
-- ACEITE 4.1 — volume por procedência
select count(*) from public.import_bubble_map where entidade='pipeline' and tabela='deals';
-- esperado: 7.568 (ou 7.567, se R-03 for resolvido por descarte)

-- ACEITE 4.2 — R-03/R-13: nenhum negócio caiu no default de month_base
select count(*) from public.deals d
  join public.import_bubble_map m on m.registro_id = d.id and m.tabela='deals'
 where d.month_base = public.month_start(current_date);
-- esperado: só os negócios realmente de set/2026. Um salto para 411 é o sintoma do gatilho ligado.

-- ACEITE 4.3 — negócios sem NENHUM participante são 36, não 279
select count(*) from public.deals d
  join public.import_bubble_map m on m.registro_id = d.id and m.tabela='deals'
 where not exists (select 1 from public.deal_participants p where p.deal_id = d.id);
-- esperado: 36   (279 é o número dos SEM CORRETOR, outra pergunta; can_see_deal aceita
--                 participante de qualquer papel, então os invisíveis são 36)

-- ACEITE 4.4 — rateio inflado: 18 negócios com ordinal 2 sem ordinal 1
select count(*) from (
  select deal_id from public.deal_participants where role='broker'
   group by deal_id having min(ordinal) > 1) x;
-- esperado: 18, e esses 18 vão para a lista de curadoria.
-- A conferência sum(share_pct)=100 NÃO os pega: ela passa justamente porque o rateio foi inflado.

-- ACEITE 4.5 — VGV total ao centavo (N-24 opção a)
select round(sum(vgv_gross), 2) from public.deals d
  join public.import_bubble_map m on m.registro_id = d.id and m.tabela='deals';
-- esperado: 465211260.70

-- ACEITE 4.6 — o gatilho de participante ficou mesmo desligado
select count(*) from public.deal_participants
 where auto_added and created_at >= :inicio_carga;
-- esperado: 0
```

---

### Fase 5 — CCA

**Ordem invertida por causa de R-04.** Passo A: inserir os 1.454 casos como `under_review` (o ramo do
gatilho não dispara). Passo B: com `cca_cases_sync_esteira_label` **desligado**,
`update … set status='pending_documents'` e gravar `deals.status_detail` no mesmo bloco
(`deals_guard_esteira_label` libera `current_user in ('postgres','service_role')`, `0077:113-118`).

```sql
-- ACEITE 5.1 — volume
select count(*) from public.import_bubble_map where entidade='pipeline' and tabela='cca_cases';
-- esperado: 7.549

-- ACEITE 5.2 — R-04: nenhuma conferência documental foi revertida pela carga
select count(*) from public.deal_history
 where kind = 'document_review_returned' and created_at >= :inicio_carga;
-- esperado: 0    (1.267 é o sintoma do gatilho ligado)

-- ACEITE 5.3 — R-04: nenhuma notificação nasceu na tela do corretor
select channel, count(*) from public.notifications
 where created_at >= :inicio_carga group by 1;
-- esperado: 0 linhas (1.372 in_app é o sintoma)

-- ACEITE 5.4 — a constraint de decisão está satisfeita
select count(*) from public.cca_cases c
  join public.import_bubble_map m on m.registro_id = c.id and m.tabela='cca_cases'
 where c.status in ('approved','rejected') and c.decided_at is null;
-- esperado: 0
```

---

### Fase 6 — Documentos e storage

**Não começar sem fechar §3.4** (o número de `deal_documents` não é reproduzível) **e §3.3** (HEAD em
todas as URLs, para saber se são 4,5 ou 18,7 GB e se o CDN ainda responde).

Correções: R-14 (um objeto por par negócio×arquivo), R-15 (cair para o registro não-vazio mais
recente), N-27 (mascaramento de CPF em `stored_name`).

```sql
-- ACEITE 6.1 — reconciliação linha × objeto (R-14): zero linha sem arquivo
select count(*) from public.deal_documents dd
 where not exists (select 1 from storage.objects o
                    where o.bucket_id = 'deal-documents' and o.name = dd.storage_path);
-- esperado: 0

-- ACEITE 6.2 — R-15: nenhum negócio que tinha documento na origem ficou sem dossiê.
-- Exige que o ETL grave `tinha_documento` no detalhe do de-para; sem isso não há como provar.
select count(*) from public.import_bubble_map m
 where m.entidade='pipeline' and m.tabela='deals'
   and (m.detalhe->>'tinha_documento')::boolean
   and not exists (select 1 from public.deal_documents dd where dd.deal_id = m.registro_id);
-- esperado: 0   (82 é o sintoma da regra "snapshot corrente" pegando a caixa esvaziada)

-- ACEITE 6.3 — storage_path sem colisão
select storage_path, count(*) from public.deal_documents group by 1 having count(*) > 1;
-- esperado: 0 linhas

-- ACEITE 6.4 — o gatilho de pontuação de documento ficou desligado
select count(*) from public.game_events
 where event_code = 'incompleto_com_doc' and created_at >= :inicio_carga;
-- esperado: 0
```

---

### Fase 7 — Histórico de negócio

`deal_history` de `observacaoPipelines` (+ `historicoPipes` se N-12). **Depende de N-05.**

Se N-05 = não reexportar, o ETL **precisa** gravar
`detail = jsonb_build_object('match','ambiguo','candidatos',<n>)` nas linhas resolvidas por
heurística. Sem isso a correção fica impossível depois, porque `on conflict (id) do nothing` nunca
reescreve o `deal_id`.

```sql
-- ACEITE 7.1 — volume. Fixar antes qual coluna de data define a duplicata:
-- por `data` → 24.572; por `Creation Date` → 24.593. O mapa publica 24.551, refutado por duas passadas.
select count(*) from public.import_bubble_map where entidade='observacao' and tabela='deal_history';

-- ACEITE 7.2 — a lista de revisão existe (N-05 opção b)
select count(*) from public.deal_history where detail->>'match' = 'ambiguo';
-- esperado: 724, e essa lista vai para o dono revisar
```

---

### Fase 8 — Leads

**Não começar sem R-06, R-07, R-08 e R-10 resolvidos.** Os quatro são de dado, não de volume: R-06 faz
100% dos chunks falharem; R-07 derruba o lote por constraint; R-08 entrega lead a corretor errado e
cria perfil duplicado de funcionário ativo; R-10 faz o de-para de origem não casar.

```sql
-- ACEITE 8.1 — o INSERT rodou mesmo (R-06). Se o comando abortou com 42P10,
-- a contagem dá 0 e uma verificação só de volume não acusa a causa.
select count(*) from public.leads l
  join public.import_bubble_map m on m.registro_id = l.id and m.tabela='leads';
-- esperado: 41.367 (N-07 opção C) ou 102.799 (opção A)

-- ACEITE 8.2 — R-07: a constraint de perda satisfeita nos dois sentidos
select count(*) from public.leads
 where (status = 'lost'      and lost_at is null)
    or (status = 'discarded' and lost_at is not null);
-- esperado: 0   (se abortou, foi leads_lost_consistency: a contagem de N-02 estava errada)

-- ACEITE 8.3 — R-08: nenhum perfil duplicado de funcionário ativo
select p.full_name, count(*) from public.profiles p
 where p.status = 'active' group by 1 having count(*) > 1;
-- esperado: 0 linhas

-- ACEITE 8.4 — R-08: os casamentos por heurística estão marcados e são revisáveis
select count(*) from public.leads
 where raw_payload->>'corretor_resolvido' like '3_prim_ult%';
-- esperado: 3.728, com a lista dos 13 pares distintos indo para revisão humana

-- ACEITE 8.5 — grupos de distribuição: 48, não 47
select count(*) from public.distribution_groups dg
  join public.import_bubble_map m on m.registro_id = dg.id and m.tabela='distribution_groups';
-- esperado: 48 (46 rótulos legados + chatbot + o 50º valor de `Grupo`; `Roleta Geral` reusa fila-geral)

-- ACEITE 8.6 — nenhum lead ficou com grupo NULL pelo `returning` de um `do nothing`
select count(*) from public.leads l
  join public.import_bubble_map m on m.registro_id = l.id and m.tabela='leads'
 where l.distribution_group_id is null;
-- esperado: só os leads sem `Grupo` na origem. Um salto para 69.919 é o sintoma.

-- ACEITE 8.7 — nenhuma notificação/atribuição gerada
select count(*) from public.lead_assignments where created_at >= :inicio_carga;
-- esperado: 0 (cada linha gera 2 notificações, uma delas canal `whatsapp`)
```

---

### Fase 9 — Jogo e metas

**R-16 primeiro:** trocar o `update … where closed_at is null` sem filtro por uma pré-condição que
aborta.

```sql
do $$ begin
  if exists (select 1 from public.game_seasons s
              where s.closed_at is null
                and exists (select 1 from public.game_events e where e.season_id = s.id))
  then raise exception 'Temporada aberta com eventos reais. Feche pela RPC close_game_season antes de (re)importar.';
  end if;
end $$;
```

```sql
-- ACEITE 9.1 — volumes por procedência (R-02: as contagens do mapa somam o seed)
select tabela, count(*) from public.import_bubble_map
 where tabela in ('game_seasons','game_scoring_rules','game_season_results','goals','annual_results')
 group by 1 order by 1;
-- esperado: game_seasons 7 | game_scoring_rules 35 | game_season_results 629 | goals 191 | annual_results 66

-- ACEITE 9.2 — pódio sem buraco. `count(*) = count(distinct rank)` NUNCA detecta nada
-- quando o rank sai de row_number: a verificação certa é comparar o máximo com a cardinalidade.
select season_id from public.game_season_results group by 1 having max(rank) <> count(*);
-- esperado: 0 linhas

-- ACEITE 9.3 — todo participante do pódio tem o papel broker.
-- `visible_game_ranking` filtra por role='broker' (0060:136-146); sem isso a pessoa entra invisível.
select count(*) from public.game_season_results r
 where not exists (select 1 from public.user_roles ur
                    where ur.profile_id = r.profile_id and ur.role = 'broker');
-- esperado: 0   (na origem, 10 das 142 pessoas não são CORRETOR = 70 linhas em risco)

-- ACEITE 9.4 — as vendas fracionárias não sumiram no arredondamento
select season_id, sum(sales) from public.game_season_results group by 1;
-- conferir contra a soma de StatusVenda registrada no log da carga: 319,5 na origem × 336 gravado
-- com ROUND_HALF_UP. A diferença de +16,5 precisa estar em breakdown['vendas_fracao'].

-- ACEITE 9.5 — os 2 meses fictícios do seed em annual_results (R-02)
select year, month, sales_count, notes from public.annual_results
 where (year, month) in ((2026,8),(2026,9));
-- esperado: 0 linhas, OU 2 linhas explicitamente marcadas como demonstrativas

-- ACEITE 9.6 — nenhuma pessoa aparece mais de 7 vezes (uma por temporada)
select profile_id, count(*) from public.game_season_results group by 1 having count(*) > 7;
-- esperado: 0 linhas (>7 é o sintoma de perfil duplicado vindo da identidade)
```

---

### Fase 10 — Religar

1. Abrir a temporada de produção. Enquanto não abrir, todo movimento gera aviso `game_paused` no sino
   de cada corretor.
2. `update public.automation_settings set leads_paused = false where id;`
3. Reagendar os 10 crons.
4. Limpar as notificações geradas na janela — **por janela de tempo, não por canal**:
   `delete from public.notifications where sent_at is null and created_at >= :inicio_carga;`
   (filtrar `channel <> 'in_app'` deixa as `in_app` na tela dos corretores — o erro de R-04.)

```sql
-- ACEITE 10.1 — exatamente uma temporada aberta
select count(*) from public.game_seasons where closed_at is null;
-- esperado: 1

-- ACEITE 10.2 — os 10 crons voltaram
select count(*) from cron.job where jobname like 'faceimob-%' and active;
-- esperado: 10

-- ACEITE 10.3 — a roleta voltou e a fila não tem quem não deveria estar nela
select leads_paused from public.automation_settings where id;   -- esperado: f
select count(*) from public.distribution_group_members;         -- esperado: 87 + o que o seed já tinha

-- ACEITE 10.4 — nenhuma notificação da carga sobrou
select count(*) from public.notifications where created_at >= :inicio_carga;
-- esperado: 0

-- ACEITE 10.5 — nenhum e-mail saiu para construtora durante a carga
select status, count(*) from public.developer_submissions
 where created_at >= :inicio_carga group by 1;
-- esperado: 0 linhas
```

---

## 7. Resumo executivo

**A carga não pode começar hoje.** Seis coisas travam, e nenhuma delas é de volume:

1. **N-01 (fuso)** — 5 minutos de trabalho; reescreve todas as datas se estiver errado.
2. **R-01 (de-para)** — seis contratos incompatíveis para a mesma tabela; a fase 1 não roda até
   alguém escolher um.
3. **R-02 (destino não vazio)** — as verificações de aceite escritas nos mapas reprovam uma carga
   correta. Este plano já reescreve todas por procedência.
4. **N-02 / R-07 (lost × discarded)** — a regra contradiz o número publicado por um fator de 5, e a
   escolha errada derruba o lote de leads por constraint.
5. **R-04 (a esteira reverte a conferência)** — 1.267 negócios voltam para "documentação devolvida" e
   travam, com 1.372 notificações na tela dos corretores.
6. **§3.4 / §3.3 (documentos)** — o volume da fase mais cara não é reproduzível a partir da regra
   escrita, e ninguém sabe se são 4,5 ou 18,7 GB, nem se o CDN do Bubble ainda responde.

**O que está sólido:** os 23 CSVs estão cobertos, as contagens de origem reproduzem em três passadas
independentes (208.203 registros), a ordem de carga respeita todas as FKs verificadas, as chaves de
idempotência por UUIDv5 se sustentam, e o de-para nome→pessoa de `Users.colaboradores` é injetivo
(298 valores distintos em 298 linhas). O trabalho que falta é de **mecânica de integridade**, não de
entendimento do dado.

**Sequência mínima para destravar:** N-01 (5 min) → R-01 (1 migration) → N-02 + R-07 (1 medição) →
N-04 + R-04 (inverter a ordem da fase 5) → HEAD nas 30.279 URLs (1 script, algumas horas). Só depois
disso a fase 2 pode rodar.
