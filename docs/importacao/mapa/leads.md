# Mapa de importação — domínio **Leads** (Bubble → Supabase)

**Origem:** `DOCUMENTOS/DADOS_BUBBLE/export_All-leadfies-modified--_2026-09-08_19-40-11.csv` (102.799 registros, 42 colunas)
e `DOCUMENTOS/DADOS_BUBBLE/export_All-ligacoes_2026-09-08_19-41-06.csv` (8.365 registros, 6 colunas, **sem `unique id`**).
**Destino:** `public.leads`, `public.lead_comments`, `public.lead_events`, `public.lead_sources`, `public.distribution_groups`.
**Base:** `docs/importacao/perfil/leads.md`, `docs/importacao/perfil/observacoes.md`, `docs/importacao/alvo/leads_alvo.md`,
`docs/importacao/alvo/operacao_alvo.md`, `docs/importacao/SCHEMA_ALVO.md` e as migrations citadas.
**Data:** 09/09/2026. Todo número deste documento saiu de um script Python rodado sobre os CSVs ou de um `grep`/`sed` numa migration.

---

## 0. As cinco coisas que quebram se você ignorar

| # | Fato | Consequência de ignorar | Regra |
|---|---|---|---|
| 1 | `leads.status` tem default `'queued'` (`0005_leads.sql:51`) e o cron `faceimob-assign-queued` distribui 50/min | 100 mil leads entram na roleta: 100 mil `lead_assignments`, 200 mil `notifications`, **WhatsApp real para o corretor**, por semanas | **Nunca** insira sem `status` explícito. Nenhum lead legado entra como `queued`. |
| 2 | `faceimob-mark-no-response` (5 min) move `funnel_stage='first_contact'` + status `attending/in_progress` para `no_response` **e notifica o corretor por lead** (`0043_lead_automation_rules.sql:110-134`); **não** lê `leads_paused` | 17.153 leads legados em "Primeiro contato" viram 17.153 notificações + 17.153 `lead_events('stage_changed')` na primeira varredura | Grave `funnel_stage='no_response'` direto (§4.2). A data máxima do export é 05/09/2026 — **100%** desses leads já estariam vencidos. |
| 3 | `overdue_lead_count()` conta lead vivo com `next_action_at < now()`; em 20 o corretor perde o check-in e some da fila (`0005:228-277`, `0074:316-317`) | Importar `Data atividade` em `next_action_at` paralisa a operação inteira no primeiro turno (o maior corretor tem 2.932 leads vivos) | `next_action_at` **sempre NULL**. Depois de errado, o trigger `leads_keep_next_action` impede corrigir com NULL. |
| 4 | `leads_lost_consistency`: `(status='lost') = (lost_at is not null)` (`0005:78-79`) | `discarded` com `lost_at` preenchido é recusado; `lost` sem `lost_at` também | `lost` → `lost_at` obrigatório · `discarded` → `lost_at` **NULL**, motivo em `lost_reason`. Não use a RPC `close_lead` (ela viola a própria constraint no caso `discarded`). |
| 5 | `leads_normalize` (BEFORE INSERT) faz `phone := normalize_phone(coalesce(phone, phone_raw))` (`0005:104-115`) | Mandar `phone=NULL` + `phone_raw='(51) 9…'` **não** deixa `phone` nulo — o trigger deriva de `phone_raw` | Mande **só `phone_raw`** com o texto original; o trigger produz `phone` correto. Telefone inválido: **os dois NULL** (§3, linha `Telefone`). |

**Suposição de fuso registrada:** o CSV não declara timezone. Todas as datas são interpretadas como **America/Sao_Paulo**
(`timestamp AT TIME ZONE 'America/Sao_Paulo'` no Postgres, `ZoneInfo("America/Sao_Paulo")` no Python — **não** use `-03` fixo:
há 5 registros de `Data atividade` entre 2016 e 2019, quando ainda havia horário de verão).

**Cabeçalho do CSV está limpo, o corpo não.** Verificado byte a byte: o header traz os acentos corretos
(`'Código'`, `'Data Criação'`, `'Imóvel'`, `'Mês'`, `'Observações'`, `'Preço'`, `'Tipo de Negociação'`) — use esses nomes
exatos no `DictReader`. Já o **corpo** tem **337.879 ocorrências de U+FFFD** (`EF BF BD`), confirmadas por contagem de bytes.

---

## 1. Ordem de carga

```
0. profiles + user_roles                (domínio Identidade — PRÉ-REQUISITO, sem ele assigned_to é sempre NULL)
1. lead_sources                         (6 códigos novos, on conflict (code) do nothing)
2. distribution_groups                  (47 grupos legados, active = false)
3. leads                                (lote principal, service_role, chunks de 500-1000)
4. lead_comments                        (depende de leads)
5. lead_events kind='revived'           (depende de leads)          [opcional — processo morto desde 2024]
6. lead_events kind='call'              (depende de leads; origem = export_All-ligacoes)
7. backfill leads.converted_deal_id     (DEPOIS do domínio Negócios; ver §7 lacuna L4)
```

**Não carregue** (justificativa em §7):
`lead_assignments` (a origem não tem data de atribuição nem histórico de passagem — inventar é pior que não ter),
`lead_attachments` (não há arquivo nem caminho de storage no export),
`ad_campaigns` (a origem não tem `external_id` de campanha, que é NOT NULL e único),
`remarketing_lists` / `remarketing_contacts` (`Reavivar em` é um processo abandonado em 2024, sem campanha/template/canal),
`automation_settings` (singleton — a linha já existe, só se faz UPDATE).

---

## 2. Antes do primeiro INSERT — travas obrigatórias

```sql
-- 1) Anote o estado atual (não presuma os defaults)
select leads_paused, notify_on_assign, notify_on_timeout, auto_first_contact,
       no_response_hours, overdue_block_threshold, roulette_max_rounds
  from public.automation_settings where id;

-- 2) Trava de aplicação
update public.automation_settings
   set leads_paused = true, notify_on_assign = false, notify_on_timeout = false
 where id;

-- 3) Trava de infraestrutura (leads_paused NÃO segura mark_no_response nem release_expired)
select cron.alter_job(jobid, active := false)
  from cron.job
 where jobname in ('faceimob-assign-queued','faceimob-release-expired-leads',
                   'faceimob-mark-no-response','faceimob-notify-dispatch');
```

Use **as duas**. `leads_paused` sozinho não impede `mark_no_response_leads()` (§0, risco 2) nem
`release_expired_leads()`. E o cron sozinho não impede alguém religar por engano.

`npm run db:reset` **religa** `faceimob-notify-dispatch` incondicionalmente (`0065:462-479`) — reponha a pausa
após qualquer reset (fato registrado em `docs/importacao/alvo/operacao_alvo.md`).

**Depois da carga, antes de religar**, limpe a fila de saída:

```sql
update public.notifications
   set sent_at = now(), last_error = 'descartada: carga de dados legados'
 where channel <> 'in_app' and sent_at is null and created_at >= :inicio_da_carga;
```

O import só é possível por **`service_role`** para `lead_events` (nenhuma policy de INSERT existe — `0005:677-678`).
`leads` e `lead_comments` caberiam num usuário `admin`, mas misturar caminhos não vale a pena.

---

## 3. Mapeamento coluna a coluna — `leadfies` (42 colunas, todas listadas)

Coluna do CSV → coluna do destino. `fill%` medido sobre N = 102.799.

| # | Origem (`leadfies`) | fill% | Destino | Regra de transformação |
|---|---|---:|---|---|
| 1 | `Atividade` | 98,78 | `leads.funnel_stage` **+** `raw_payload.atividade_original` | Chave canônica (§5.1) → de-para §4.2. Valor fora do vocabulário (cauda de 175 valores / 360 leads, texto de chatbot vazado) → `'new'`, original preservado em `raw_payload`. |
| 2 | `Cidade` | 49,19 | `raw_payload.cidade` | Não há coluna de cidade em `leads`. Grave cru (751 grafias para ~50 cidades; não tente normalizar). |
| 3 | `Cliente` | 99,38 | `leads.full_name` | `btrim` (o trigger repete). **635 vazios**: use `coalesce(nullif(btrim(Cliente),''), 'Lead ' || Identificador, 'Lead sem nome ' || right(unique_id, 6))` — `full_name` é NOT NULL com `check length(btrim) > 0`. |
| 4 | `correto` | 0,46 | **DESCARTAR** | 468 linhas, todas dentro do lote Instagram; concorda com `Corretor` em 409/468. Sem informação nova. |
| 5 | `Corretor` | 100,00 | `leads.assigned_to` **+** `raw_payload.corretor_original` | Resolução por nome §5.2. Cobertura **96,59%** (99.294/102.798). Não resolvido → `assigned_to = NULL` (nunca chute). |
| 6 | `Corretorszz` | 97,13 | **DESCARTAR** | Snapshot congelado; difere de `Corretor` em 5.710 linhas, com grafias piores (`Everton Silva` × `Everton Goncalves da Silva`). Serviria só para um histórico de reatribuição que não temos como datar. |
| 7 | `Criado em` | 100,00 | `leads.created_at` · `leads.assigned_at` | Parser multi-formato §5.3. É a **única** data de criação confiável (bate 101.580/101.580 com `Mês`). `assigned_at` = mesma data: a origem não guarda data de atribuição e a roleta do Bubble atribuía na criação. |
| 8 | `Criado_em` | 100,00 | **DESCARTAR** | Ano errado em 2.638 registros (delta de −366 dias); hora sempre 12:00. |
| 9 | `Código` | 0,64 | `raw_payload.codigo_tecimob` | 662 valores, id de empreendimento no TecImob. Não existe destino; não confunda com código de lead. |
| 10 | `Data atividade` | 97,93 | `leads.last_activity_at` | Parser §5.3. **NUNCA** em `next_action_at` (§0, risco 3). 49 valores no futuro (até 18/09/2026): mantenha como estão em `last_activity_at` (só um campo de leitura). Vazio (2.129) → usar `Criado em`, pois a coluna é NOT NULL. |
| 11 | `Data Criação` | 0,00 | **DESCARTAR** | 100% vazia. |
| 12 | `Data_atividade` | 0,00 | **DESCARTAR** | 100% vazia. |
| 13 | `data_criacao` | 0,00 | **DESCARTAR** | 100% vazia. |
| 14 | `Email` | 96,93 | `leads.email` (`citext`) | `lower(btrim())`. **462 valores literais `none` → NULL**; 134 com erro de digitação (`@gmail.c`, `@gmail.2019com`) também → NULL, original em `raw_payload.email_invalido`. Sem unique no destino: e-mail repetido não quebra nada. |
| 15 | `Fonte` | 99,96 | `leads.source_id` | De-para §4.4. Vazio (43) → `importacao`. |
| 16 | `Gerente` | 97,38 | `raw_payload.gerente_original` (lista) | `leads` **não tem coluna de gerente** — a gerência sai da hierarquia (`team_members` → `teams.manager_id`). Split por `', '` (vírgula+espaço, não `' , '`); 2.151 células com 2 nomes. Guarde o array resolvido (§5.2 cobre 98,46% das ocorrências) para conferência. |
| 17 | `Gerentererr` | 0,46 | **DESCARTAR** | Lote Instagram; o próprio sufixo `err` denuncia a coluna. |
| 18 | `Gerenteszz` | 95,54 | **DESCARTAR** | Snapshot; contém `Gerente Interino` (1.345), que não é pessoa. |
| 19 | `Grupo` | 87,66 | `leads.distribution_group_id` | De-para §4.5. Vazio (12.687) → NULL. |
| 20 | `Identificador` | 95,53 | `raw_payload.identificador` | **Não é chave**: 1.635 valores repetem (até 4 leads no mesmo). Serve de fallback para `full_name` (linha 3). |
| 21 | `Imóvel` | 91,88 | `leads.campaign_name` | Texto cru. É nome de campanha/anúncio, não imóvel. **Não** crie `ad_campaigns` a partir daqui (§7, L3). |
| 22 | `Mensagem` | 68,71 | `raw_payload.mensagem` | Payload bruto do formulário/chatbot (até 1.621 chars, com `\n`). 61.838 no formato `pergunta? resposta`, 7.245 `chave: valor`. Não tente estruturar; grave a string. |
| 23 | `Motivos de perda` | 34,58 | `leads.lost_reason` **+** decide `lost`/`discarded` | Split por `', '`; 9 valores são `Atividade` vazada (999 ocorrências) e devem sair da lista. De-para §4.3. `lost_reason` = itens válidos unidos por `' · '`. |
| 24 | `Mês` | 100,00 | **DESCARTAR** | Competência codificada (`MMM DD, 2001` onde DD = ano). Bate com `Criado em` em 101.580/101.580 — 100% derivável. |
| 25 | `novo` | 15,74 | **DESCARTAR** | Único valor `sim`, e só em leads criados a partir de 25/03/2026. Derivável de `created_at`. |
| 26 | `Obs. atividade` | 2,71 | `leads.notes` | `btrim`. 2.790 linhas, todas com `Observações` também preenchida. Nota curta do corretor — cabe no campo livre do lead. |
| 27 | `Observações` | 7,23 | `lead_comments.body` | 1 comentário por lead (7.432). **Não** tente quebrar em vários: 1.171 têm 2+ datas embutidas no texto, mas o formato é livre e o split erraria. `author_id` = mesmo `assigned_to` resolvido; `created_at` = `Data atividade` ou, na falta, `Criado em`. `body` tem `check length(btrim) > 0` — pule strings vazias. |
| 28 | `Preço` | 0,00 | **DESCARTAR** | 100% vazia. |
| 29 | `Reavivado em` | 4,82 | `lead_events(kind='revived').created_at` | Data `dd/mm/yy` → 00:00 America/Sao_Paulo. Opcional (§7, L5): 4.960 eventos de um processo morto desde ago/2024. |
| 30 | `Reavivado_em` | 0,00 | **DESCARTAR** | 100% vazia. |
| 31 | `Reavivar em` | 6,22 | `lead_events.detail->>'agendado_para'` | Só faz sentido junto do evento acima; coincide com `Reavivado em` em 4.958/4.960 casos. Se não importar o evento, **DESCARTAR**. |
| 32 | `Reavivar_em` | 0,00 | **DESCARTAR** | 100% vazia. |
| 33 | `Status` | 99,30 | `leads.status` (+ `lost_at`) | De-para §4.1. Vazio (719) = lote Instagram → `discarded`. |
| 34 | `Telefone` | 99,90 | `leads.phone_raw` (o trigger deriva `phone`) | **Mande só `phone_raw` com o texto original do CSV.** Validação §5.4: 100.337 normalizáveis (perfil; minha checagem independente deu 100.342 com regra marginalmente mais frouxa). Os **2.357 inválidos**: `phone` e `phone_raw` **ambos NULL**, original em `raw_payload.telefone_invalido` — senão `normalize_phone` grava o lixo tal e qual e ele entra no índice de dedupe. |
| 35 | `Tipo de Negociação` | 99,30 | **DESCARTAR** | 92,18% `Compra`, 7,12% `Indefinido`, sem terceira opção. Não há coluna destino e o campo nunca discriminou nada. |
| 36 | `Vida` | 99,30 | **DESCARTAR** | Constante `1ª` em 100% dos preenchidos. |
| 37 | `whatsapp` | 0,70 | `leads.phone_raw` (fallback) | Só existe no lote Instagram (719). Use quando `Telefone` estiver vazio; caso contrário `raw_payload.whatsapp`. |
| 38 | `Creation Date` | 100,00 | `raw_payload.bubble_creation_date` | **Não** é a data do lead: mínimo 14/05/2024 (carga inicial no Bubble) e só 191 timestamps distintos para 102.799 registros. |
| 39 | `Modified Date` | 100,00 | `leads.updated_at` | `updated_at` só é sobrescrito por trigger em **UPDATE** (`leads_set_updated_at` é BEFORE UPDATE), então o valor passado no INSERT sobrevive. |
| 40 | `Slug` | 0,00 | **DESCARTAR** | 100% vazia. |
| 41 | `Creator` | 100,00 | **DESCARTAR** | `Douglas Gomes` em 102.798 de 102.799. É o usuário técnico da integração, não o dono do lead. |
| 42 | `unique id` | 100,00 | `leads.external_id` | `'bubble:leadfy:' \|\| unique_id`. 102.799 valores distintos, zero repetição. Chave de idempotência (§6). |

### 3.1 Colunas do destino preenchidas por regra (sem coluna equivalente na origem)

| Destino | Valor | Motivo |
|---|---|---|
| `leads.status` | §4.1 | NOT NULL, default `'queued'` — **jamais** deixar o default agir. |
| `leads.funnel_stage` | §4.2 | NOT NULL, default `'new'`. |
| `leads.attend_deadline` | **NULL** | Com `status='assigned'` e prazo no passado, o cron de 30 s devolve o lead à fila. Como usamos `in_progress`, é irrelevante — mande NULL de qualquer forma. |
| `leads.next_action_at` | **NULL** | §0, risco 3. |
| `leads.first_contact_at` | **NULL** | A origem não tem essa data. `mark_no_response` usa `coalesce(first_contact_at, last_activity_at)` e nós já resolvemos isso em §4.2. |
| `leads.roulette_misses` | `0` (default) | Sem `lead_assignments` importadas, não há o que contar. Não rode o backfill de `0074:86-95`. |
| `leads.document` | NULL | Não há CPF em `leadfies`. |
| `leads.form_id`, `campaign_id`, `adset_*`, `ad_*`, `utm_*`, `landing_page` | NULL | Não existem no export do Bubble (§7, L1). |
| `leads.raw_payload` | jsonb montado | Ver §3.2. |
| `leads.converted_at` | `Data atividade` só nos 59 `Negócio fechado` | Ver §4.1. |
| `leads.sdr_qualified_at`, `converted_deal_id` | NULL na carga 1 | `converted_deal_id` vem no passo 7 (§7, L4). |

### 3.2 `raw_payload` — o que grava (é o que impede perda de dado)

```json
{
  "bubble_id": "1715658950499x132032603743673650",
  "bubble_creation_date": "2024-05-14T00:55:00-03:00",
  "identificador": "sdrtwp",
  "cidade": "porto_alegre",
  "mensagem": "Você quer morar em porto alegre? sim,_na_zona_leste",
  "atividade_original": "Em atendimento",
  "grupo_original": "Roleta Geral",
  "fonte_original": "Facebook Leads",
  "corretor_original": "Rudinei Teixeira de Souza",
  "corretor_resolvido": "1_exato",
  "gerente_original": ["Archimedes Boff"],
  "motivos_perda": ["Cliente sem interesse", "Demora no retorno"],
  "codigo_tecimob": null,
  "telefone_invalido": null,
  "email_invalido": null,
  "whatsapp": null
}
```

Regra: campo nulo/vazio **não entra** no JSON (evita 100 mil chaves nulas). `corretor_resolvido` guarda qual
regra da escada (§5.2) casou — é o que permite auditar depois quantos leads têm dono chutado.

---

## 4. De-para de valores

### 4.1 `Status` → `leads.status` + `lost_at` + `converted_at`

Contagens medidas com chave tolerante a mojibake (§5.1), portanto já consolidadas.

| `Status` (Bubble) | Registros | `leads.status` | `lost_at` | Demais campos |
|---|---:|---|---|---|
| `Em negociação` | **64.885** | `in_progress` | NULL | `assigned_to` resolvido (63.564) ou NULL (2.192) |
| `Arquivado` **com** motivo de descarte¹ | **1.044** | `discarded` | **NULL** (constraint!) | `lost_reason` = motivos |
| `Arquivado` com outro motivo | **34.226** | `lost` | `Data atividade` ou `Criado em` | `lost_reason` = motivos unidos por `' · '` |
| `Arquivado` **sem** motivo | **995** | `lost` | idem | `lost_reason = 'Arquivado no Bubble sem motivo registrado'` |
| `Novo` | **871** | `in_progress` | NULL | — |
| `Negócio fechado` | **59** | `converted` | NULL | `converted_at` = `Data atividade`; `converted_deal_id` no passo 7 |
| *(vazio — lote Instagram nov/2024)* | **719** | `discarded` | NULL | `lost_reason = 'Lote Instagram nov/2024 — sem dado de funil na origem'` |

¹ motivo de descarte = a célula contém `Lead duplicado`, `Lead Teste` ou `Contato Inválido`.

**Por que `in_progress` e não `assigned`/`attending`/`queued`:**
`queued` entra na roleta (§0, risco 1). `assigned` é varrido por `release_expired_leads()` a cada 30 s.
`in_progress` não é varrido por nenhum cron de fila e aceita `assigned_to` NULL — a constraint
`leads_assigned_consistency` só cobre `assigned` e `attending` (`0005:76-77`).

**Valor desconhecido de `Status`:** não existe (o domínio é fechado em 4 valores + vazio, confirmado por contagem).
Se aparecer um num export futuro: `discarded` + `lost_reason = 'Status desconhecido na origem: <valor>'` e **falhe o lote com log**,
não adivinhe.

### 4.2 `Atividade` → `leads.funnel_stage`

Vocabulário real: 12 valores cobrem 102.079 dos 102.799 (99,3%); a cauda são 175 valores de texto de chatbot
gravado no campo errado, somando 360 leads.

| `Atividade` (canônica) | Registros | `funnel_stage` | Observação |
|---|---:|---|---|
| `Em atendimento` | 36.181 | `warm` | — |
| `Primeiro contato` | 29.199 | **`no_response`** se `status='in_progress'` (17.153 leads); `first_contact` nos demais | §0, risco 2. A data máxima do export é 05/09/2026 e `no_response_hours` = 24 (`0004:207`): **100%** desses leads seriam varridos na primeira rodada do cron. Gravar `no_response` direto evita 17.153 notificações e 17.153 `lead_events`. |
| `Retornar para cliente` | 22.758 | `warm` | — |
| `Ver mensagem do interessado` | 7.409 | `new` | Mensagem do lead ainda não lida — o corretor não agiu. |
| `Cobrar cliente` | 4.031 | `warm` | — |
| *(vazio)* | 1.258 | `new` | — |
| `Em negociação` | 494 | `hot` | — |
| `Em Proposta` | 133 | `hot` | — |
| `Aguardando Documentação` | 122 | `gathering_docs` | — |
| `Visita Agendada` | 119 | `scheduled_visit` | Não gera linha em `visits` (não há data nem resultado na origem). |
| `Enviar Fotos/Vídeos` | 60 | `warm` | — |
| `Sem resposta` | 52 | `no_response` | — |
| `Em Análise de Crédito` | 26 | `gathering_docs` | O CCA legado mora em `pipelines`, não aqui. |
| **cauda (175 valores, 360 leads)** | 360 | `new` | Texto de pergunta de chatbot. Original preservado em `raw_payload.atividade_original`. |

**Valor desconhecido:** `'new'` + original em `raw_payload`. Nunca falhe o lote por causa de `Atividade` —
o campo já vem sujo por natureza.

### 4.3 `Motivos de perda` → `leads.lost_reason` (24 valores, todos listados)

A célula é multivalorada (separador `', '`). 39.541 ocorrências em 35.550 leads (32.339 com 1 motivo, até 8 no máximo).

**Grupo A — descarte** (`status = 'discarded'`, `lost_at` NULL): 1.044 leads

| Motivo | Ocorrências |
|---|---:|
| `Contato Inválido` | 4.063 |
| `Lead duplicado` | 1.010 |
| `Lead Teste` | 34 |

**Grupo B — perda real** (`status = 'lost'`, `lost_at` preenchido) — copiar o rótulo como está:

| Motivo | Ocorr. | | Motivo | Ocorr. |
|---|---:|---|---|---:|
| `Cliente sem interesse` | 12.048 | | `Produto não agradou` | 781 |
| `Demora no retorno` | 7.903 | | `Já foi vendido` | 291 |
| `Apenas pesquisando` | 4.463 | | `Já comprou` | 286 |
| `Cliente sem perfil` | 3.804 | | `Desempregado` | 231 |
| `Possui Restrição` | 2.291 | | `Reprovado` | 93 |
| `Bloqueado pelo Cliente` | 1.029 | | | |

**Grupo C — descartar o item** (é valor de `Atividade` vazado para o campo errado, 999 ocorrências):
`Em atendimento` (422), `Retornar para cliente` (271), `Em outro Atendimento` (215), `Ver mensagem do interessado` (158),
`Primeiro contato` (97), `Cobrar cliente` (44), `Visita Agendada` (3), `Em negociação` (2), `Documentação Pendente` (1),
`Em Proposta` (1). Remova da lista **antes** de montar `lost_reason`. Se a célula ficar vazia depois disso, cai na
regra "Arquivado sem motivo" (§4.1).

`lost_reason` é `text` livre, sem constraint: grave os itens do grupo B unidos por `' · '`, com o acento **reconstruído
pelo dicionário canônico** (§5.1) — nunca a string mojibake do CSV.

**Valor desconhecido:** copie para `lost_reason` como veio (após reconciliação) e registre no log. Não descarte silenciosamente.

### 4.4 `Fonte` → `lead_sources.code` (14 valores, todos listados)

Catálogo existente em `supabase/seed.sql:120-128`: `meta_ads`, `whatsapp`, `organico`, `indicacao`, `importacao`, `portal`.
`channel` tem CHECK em `('meta','whatsapp','organic','indication','import','portal','other')` (`0003:192-193`).

| `Fonte` | Registros | `lead_sources.code` | Ação |
|---|---:|---|---|
| `Facebook Leads` | 94.421 | `meta_ads` | já existe |
| `Chatbot Leadfy` | 3.703 | `chatbot_leadfy` | **criar** (`label='Chatbot Leadfy'`, `channel='other'`) |
| `WhatsApp` | 1.792 | `whatsapp` | já existe |
| `Importados da planilha` | 813 | `importacao` | já existe |
| `TecImob 2` | 742 | `tecimob` | **criar** (`label='TecImob'`, `channel='portal'`) |
| `BotConversa` | 464 | `botconversa` | **criar** (`channel='other'`) |
| `Instagram` | 409 | `instagram` | **criar** (`channel='meta'`) |
| `Facebook` | 267 | `meta_ads` | nomenclatura antiga do mesmo canal |
| `Facebot` | 68 | `facebot` | **criar** (`channel='other'`) |
| `Não definido` | 51 | `importacao` | — |
| `Site Faceimob` | 22 | `organico` | já existe |
| `Indicação` | 2 | `indicacao` | já existe |
| `VivaReal` | 1 | `portal` | já existe |
| `Integracao Leadfy` | 1 | `chatbot_leadfy` | mesma origem, grafia diferente |
| *(vazio)* | 43 | `importacao` | — |

```sql
insert into public.lead_sources (code, label, channel) values
  ('chatbot_leadfy','Chatbot Leadfy','other'),
  ('tecimob','TecImob','portal'),
  ('botconversa','BotConversa','other'),
  ('instagram','Instagram','meta'),
  ('facebot','Facebot','other')
on conflict (code) do nothing;
```

**Deixe `sdr_agent_id` NULL** nas origens novas: origem com agente SDR desvia da roleta e inicia conversa
(`meta-ads-webhook/index.ts:307-313`). E **não** preencha `form_id` (unique parcial; um formulário por origem).

**Valor desconhecido:** `importacao` + original em `raw_payload.fonte_original`.

### 4.5 `Grupo` → `distribution_groups` (49 valores, incluindo vazio)

Três semânticas no mesmo campo: fila de roleta, direcionamento por produto/construtora e direcionamento nominal.

| `Grupo` | Registros | Destino | Ação |
|---|---:|---|---|
| `Roleta Geral` | 69.919 | grupo existente `fila-geral` | reusar (`kind='general'`, já criado em `seed.sql:111`) |
| *(vazio)* | 12.687 | NULL | — |
| `ChatBot` | 4.685 | novo `chatbot` | criar `kind='specific'`, **`active=false`** |
| os **46 restantes** (`ELITE` 3.034 · `Zona Norte (Distribuição)` 1.806 · `Abaco` 1.788 · `WhatsApp` 1.553 · `MC3 PONTAL` 1.480 · `Sul` 654 · `Leads Equipe Mauricio` 629 · `Canoas` 578 · `Novos Negócios` 549 · `TENDA` 479 · `Lead Qualificado` 431 · `Leads Equipe Leone` 292 · `Isadora` 223 · `Lots` 184 · `Zona Sul (Distribuição)` 179 · `Gerente Victor` 161 · `Hierarquia Sul` 156 · `Gerente Susana` 116 · `Esperanza` 113 · `Caroline Farias` 110 · `BotConversa` 104 · `Alisson` 102 · `MORANA` 98 · `Gerente Veronica` 77 · `Direcionado MC3` 66 · `MRV Monaco` 66 · `Gerente José` 64 · `MRV` 62 · `LYX` 53 · `AP Olavio` 53 · `Leads Equipe Zona Sul` 48 · `Site Faceimob` 45 · `Gerente Leonardo` 24 · `Gerente Alisson` 24 · `Diretor Mauricio` 22 · `OPEN` 21 · `Cascata Diretor Fabio` 15 · `Equipe Canoas GRUPO` 14 · `Gerente Daiane` 11 · `Hierarquia Archimedes` 6 · `Hierarquia Mauricio` 6 · `Gerente Alexandre` 5 · `Gerente Mauricio` 3 · `Repique Norte` 1 · `Hierarquia Canoas` 1 · `Hierarquia Lots` 1 · `API` 1) | 20.406 | novos grupos | criar `kind='specific'`, **`active=false`** |

**Por que `active=false`:** `assign_lead`/`distribution_queue` filtram por `g.active` (`0074:307-309`). Grupo inativo
preserva o rótulo histórico sem entrar na distribuição de hoje. Não crie `distribution_group_members`.

`slug`: `lower` + sem acento + não-alfanumérico → `-` + colapso de `-` (existe trigger `distribution_groups_ensure_slug`,
mas mande o slug explícito para o import ser determinístico). `slug` é UNIQUE — **colisão real**: `WhatsApp` (grupo)
não colide com nada em `distribution_groups`, mas confira `fila-geral`/`triagem-sdr-ia` antes de inserir
(`on conflict (slug) do nothing`).

**Valor desconhecido:** cria o grupo inativo automaticamente — a regra já é genérica.

### 4.6 Fora do meu domínio (referências)

- `Funcao` → `app_role` e `Status_colab` → `profile_status`: domínio **Identidade** (`docs/importacao/alvo/identidade.md`).
  Aqui só consumo o resultado: `profiles` já precisa existir quando `leads` for carregado.
- `pipelines.STATUS` → `pipeline_stages.code` + `deals.outcome`: domínio **Negócios**
  (`docs/importacao/alvo/negocios_alvo.md`). O único elo com o meu domínio é o passo 7 (§7, L4).

---

## 5. Resolução de FK e normalização

### 5.1 Chave canônica para vocabulário fechado (mojibake)

O corpo do CSV tem 337.879 U+FFFD: **cada letra acentuada virou 1 caractere perdido, irreversível byte a byte**.
`Em negociação` aparece como `Em negocia<FFFD><FFFD>o` em 63.788 linhas e correto em 1.097.

Para `Status`, `Atividade`, `Motivos de perda`, `Fonte` e `Grupo` (domínios fechados), a reconciliação é determinística:

```python
def canon(s: str) -> str:
    """Chave que iguala 'Em negociação' e 'Em negocia<FFFD><FFFD>o'."""
    s = "".join(c for c in (s or "") if ord(c) < 128)   # descarta acentuado E U+FFFD
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s.lower()).split())
```

`canon('Em negociação') == canon('Em negocia<FFFD><FFFD>o') == 'em negociao'`. Validado: reduz `Status` de 6 valores
brutos para 4 (`arquivado` 36.265 · `em negociao` 64.885 · `novo` 871 · `negcio fechado` 59) e `Negócio fechado`
de 43+16 para 59. **Sempre grave no destino o rótulo canônico limpo, nunca a string do CSV.**

Para texto livre (`Cliente`, `Observações`, `Mensagem`, `Cidade`) **não há reconstrução possível** — grave como veio.

### 5.2 `Corretor` / `Gerente` → `profiles.id`: escada de resolução

**Ponto de partida:** o alvo do nome é `Users.colaboradores` (o apelido curto do Bubble), **não** `Users.Nome_completo`.
Medido: `Corretor` casa com `colaboradores` em 95.287 leads e com `Nome_completo` em só 46.374. `profiles.full_name`
deve vir de `colaboradores` (decisão do domínio Identidade); se vier de `Nome_completo`, esta escada precisa de uma
tabela auxiliar `colaboradores → profile_id`.

Normalização base:

```python
def nkey(s):                                   # NFD, remove diacrítico, remove U+FFFD,
    s = unicodedata.normalize("NFD", s or "")  # minúsculas, só [a-z0-9 ], espaços colapsados
    s = "".join(c for c in s if unicodedata.category(c) != "Mn" and c != "\ufffd")   # U+FFFD
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s.lower()).split())
```

Escada, **aplicada em ordem, parando no primeiro acerto**:

| # | Regra | Leads `Corretor` | Ocorr. `Gerente` |
|---|---|---:|---:|
| 1 | `nkey(valor) == nkey(colaboradores)` — igualdade exata | **95.287** (92,69%) | **96.759** (94,63%) |
| 2 | **regex de mojibake**: cada corrida de `U+FFFD` vira `.{0,n}`, resto escapado, âncora `^…$`; aceita só se **1** candidato casar | **279** | **526** |
| 3 | `(primeiro token, último token)` iguais e **único** candidato | **3.728** | **3.394** |
| 4 | conjunto de tokens do valor ⊆ tokens do candidato, **único** candidato | 0 | 0 |
| 5 | **tabela de alias manual** (abaixo) | +321 se aplicada | 0 |
| — | **não resolvido** | **3.504** (3,41%) | **1.573** (1,54%) |
| — | **cobertura sem alias** | **99.294 / 102.798 = 96,59%** | **100.679 / 102.252 = 98,46%** |

A regra 2 é o que recupera `Maur<FFFD><FFFD>cio Vieira` → `Mauricio Vieira` (o candidato **não** tem acento, então a
simples remoção de não-ASCII dos dois lados falha) e `Patr<FFFD><FFFD>cia Cardoso` → `Patricia Cardoso`.

**Ambiguidade:** se mais de um candidato casar em qualquer regra, o resultado é `assigned_to = NULL` +
`raw_payload.corretor_resolvido = "9_ambiguo"`. Nunca escolha por ordem alfabética ou por "mais ativo".
Medido: **zero** ambiguidades reais neste arquivo — todas as falhas são "não encontrado".

**Não encontrados de `Corretor` — lista completa (22 nomes, 3.504 leads):**

| Chave normalizada | Leads | Tratamento |
|---|---:|---|
| `usurio repique` (530) + `usuario repique` (24) | 554 | **Não é pessoa** — placeholder de sistema. `assigned_to = NULL`. |
| `em espera` | 497 | **Não é pessoa** — placeholder. `assigned_to = NULL`. |
| `contingncia` (76) + `contingencia` (16) | 92 | **Não é pessoa** — placeholder. `assigned_to = NULL`. |
| `caroline farias` | 618 | Pessoa ausente do export de `Users`. Decisão do dono (§8, D3). |
| `janaina silva de fraga maciel` | 543 | idem |
| `sonia mara castro viana` | 484 | idem |
| `thabata nobre` | 155 | **Alias seguro** → `Tabhata Nobre` (existe, `Ativo=sim`). Erro de digitação no Bubble. |
| `kelvin viana` | 144 | idem `kelvin albuquerque castro viana` (37) — provável mesma pessoa, ausente de `Users`. |
| `jose neres da silva junior` | 93 | ausente de `Users` |
| `alessandro bueno` | 82 | ausente de `Users` |
| `andre da silva` | 79 | ausente de `Users` (o "parecido" `Jackson da Silva` **não** é a mesma pessoa) |
| `henrique de vargas pacheco` | 76 | ausente de `Users` |
| `kelvin albuquerque castro viana` | 37 | ausente de `Users` |
| `maria luiza castro viana` | 26 | **Alias provável** → `Maria Luiza Viana` (`Ativo=não`) — confirmar com o dono |
| `paulo roberto antunes de freitas` | 9 | ausente |
| `calebe goncalves de oliveira` | 6 | ausente |
| `matheus espindola de souza` | 4 | ausente |
| `rodrigo espindola` | 2 | ausente |
| `fatima gomes` | 2 | ausente |
| `melissa santos mendes` | 1 | ausente |

Placeholders somam **1.143 leads sem dono real**; pessoas ausentes do export, **2.361 leads em 17 nomes**.

**Não encontrados de `Gerente`:** um só valor — `faceimob` (1.573 ocorrências), que **não é pessoa**. Ignore.

**Alias manual sugerido** (aplicar só o que o dono confirmar — §8, D3):

```python
ALIAS = {
  "thabata nobre": "Tabhata Nobre",              # +155 leads, alta confiança (erro de digitação)
  "maria luiza castro viana": "Maria Luiza Viana",  # +26,  média confiança
  # 'caroline farias', 'janaina silva de fraga maciel', 'sonia mara castro viana',
  # 'kelvin viana' -> sem candidato em Users; exigem decisão do dono
}
```

**Consequência de errar aqui:** o lead vai para o corretor errado, que passa a vê-lo por RLS
(`leads_select`: `assigned_to in (auth_visible_profiles())`, `0044:106-112`). É o erro mais caro do domínio —
por isso a política é "não encontrado → NULL", nunca "melhor palpite".

**Consequência de `assigned_to = NULL`:** o lead só aparece para quem tem a permissão `leads.view_queue`
(director, manager, marketing, admin — `0044:87-88`). O corretor **não** vê a fila, de propósito
(`0005:623-624`). Os 3.504 + 2.192 vivos sem dono ficam num limbo visível só à gestão — o que é o comportamento correto.

### 5.3 Datas

Quatro formatos convivem no mesmo arquivo. Ordem de tentativa (a primeira que casar vence):

```python
FORMATOS = ["%d/%m/%y %H:%M:%S",   # Data atividade  -> 15/01/24 17:28:00
            "%d/%m/%y %H:%M",      # Criado em       -> 02/01/24 18:37
            "%Y/%m/%d %H:%M",      # Criado em, 499 linhas reimportadas em 11/02/2026
            "%b %d, %Y %I:%M %p",  # Creation/Modified Date (en-US) -> May 11, 2024 6:18 pm
            "%d/%m/%y"]            # Reavivar em / Reavivado em
```

- Ano de 2 dígitos → `20xx` (validado contra `Mês`: 101.580/101.580).
- `%b` exige **locale C/en_US**; no Python use `datetime.strptime` (independente de locale para `%b` em inglês) ou
  um dicionário `{'Jan':1, ...}` explícito. Não use `dateutil` (não está instalado).
- Depois de parsear (naive), aplique `America/Sao_Paulo`. Medido: **1** valor de `Criado em` não parseável
  (registro com a coluna vazia) e **0** de `Data atividade`.
- Fallback: `Criado em` vazio/não parseável → `Creation Date`; `Data atividade` vazia (2.129) → `Criado em`.

### 5.4 Telefone

O destino normaliza sozinho (`normalize_phone`: só dígitos; 10/11 → prefixa `55`; 12/13 começando com `55` → como está;
**qualquer outra coisa passa como está**, `0001:125-141`). Por isso o import precisa validar **antes**:

```
d = só dígitos
se d começa com '55' e len(d) in (12,13): d = d[2:]
válido  ⟺  len(d) in (10,11)  E  d[:2] ∈ {67 DDDs oficiais}  E  (len(d)==10 ou d[2]=='9')
```

Válidos: **100.337** (perfil) / 100.342 (minha checagem, regra marginalmente mais frouxa em 13 dígitos).
Inválidos: **2.357** — padrões dominantes: `+# (##) #### ####` 784 (DDI estrangeiro), `(###) ##### ####` 413 (DDD de 3 dígitos),
`##### ####` 408 (sem DDD).

- **Válido:** mande **só `phone_raw`** com o texto original (com máscara). O trigger deriva `phone` = `55` + 10/11 dígitos.
- **Inválido ou vazio:** `phone = NULL` **e** `phone_raw = NULL`; original em `raw_payload.telefone_invalido`.
- **Não deduplique por telefone.** Não há unique em `phone` (decisão explícita, `0056:479-485`) e 14.005 telefones
  aparecem em 2+ leads (36.751 leads). Deduplicar aqui apagaria histórico real de re-entrada. Ver §8, D2.

### 5.5 `ligacoes` → `lead_events(kind='call')`

O arquivo **não tem `unique id`** e não tem coluna de relação com lead: a única ponte é o telefone.

| Coluna (`ligacoes`) | Destino | Regra |
|---|---|---|
| `numerocliente` | resolve `lead_events.lead_id` | Chave = **últimos 8 dígitos** após remover `55` de números com 12+ dígitos. É a única chave possível: o campo tem 16 tamanhos distintos (de 2 a 104 dígitos). |
| `Creation Date` | `lead_events.created_at` | `%b %d, %Y %I:%M %p` + America/Sao_Paulo. Faixa: 09/01/2026 → 07/09/2026 (só 2026). |
| `Creator` | `lead_events.actor_id` | Mesma escada da §5.2. 31 dos 40 nomes casam em `Users`, cobrindo 6.188 das 8.365 linhas; **todos os que casam têm `Funcao=CORRETOR`**. Não resolvido → `actor_id = NULL` (a coluna é nulável). |
| `nomecliente` | `lead_events.detail->>'nome_informado'` | Reforço de auditoria. **Não** use como chave: 2.006 dos 3.766 nomes distintos são só o primeiro nome. |
| `Modified Date` | **DESCARTAR** | Idêntica a `Creation Date` nas 8.365 linhas (tabela append-only). |
| `Slug` | **DESCARTAR** | 100% vazia. |

**Desempate quando o telefone bate em vários leads:** escolha o lead com `created_at <= data da ligação` **mais recente**;
sem nenhum anterior, o mais antigo posterior. Grave sempre `detail = {"origem":"bubble:ligacoes","chave_telefone":"########"}`.

**Cobertura medida:** 6.421 das 8.365 linhas (76,8%) casam com algum lead do `leadfies`; 5.051 casam com lead dentro
do corte de 12 meses. As 1.944 restantes: 86 com número inaproveitável (<8 dígitos) e o resto sem lead correspondente.
**Aviso do perfil:** a chave de 8 dígitos ignora o DDD, então 76,4% é um **teto**, não um número exato.

`kind` é texto livre, sem CHECK (`0005`, vocabulário em uso: `assigned`, `claimed`, `released`, `reassigned`, `converted`,
`closed`, `unattended`, `stage_changed`, `status_changed`, `sdr_qualified`). `'call'` é novo e não colide com nada.

---

## 6. Idempotência — chave natural por tabela destino

| Tabela | Chave | Como reimportar sem duplicar |
|---|---|---|
| **`leads`** | `external_id = 'bubble:leadfy:' \|\| unique_id` | Índice **UNIQUE parcial** já existe (`leads_external_id_idx`, `0005:83-84`). Use `insert … on conflict (external_id) do nothing` (ou `do update` se quiser reprocessar). **É a única unique disponível** — não há unique em `phone` nem em `email`. Prefixe com `bubble:leadfy:` para não colidir com o namespace do `leadgen_id` da Meta, que é o uso original do campo. |
| **`lead_sources`** | `code` (unique de coluna) | `on conflict (code) do nothing`. |
| **`distribution_groups`** | `slug` (unique de coluna) | `on conflict (slug) do nothing`. |
| **`lead_comments`** | `(lead_id, created_at, md5(body))` — **não há campo livre nem unique** | `insert … select … where not exists (select 1 from lead_comments c where c.lead_id = :lead and c.created_at = :ts and c.body = :body)`. Como é 1 comentário por lead vindo de `Observações`, a alternativa mais simples é: `delete from lead_comments where lead_id = any(:lote) and author_id is not distinct from :corretor` antes de reinserir. |
| **`lead_events`** | `detail->>'bubble_ref'` | `detail` é `jsonb` e serve de porta-chave. `revived` → `{"bubble_ref": "revived:<unique id>"}`; `call` → `{"bubble_ref":"call:<epoch>:<chave_telefone>:<creator>"}` (o CSV de ligações não tem PK). Dedupe: `where not exists (select 1 from lead_events e where e.lead_id = :lead and e.kind = :kind and e.detail->>'bubble_ref' = :ref)`. Sem índice, isso é seq-scan — rode o dedupe uma vez por lote, não por linha. |

**Alternativa recomendada se o dono aceitar uma migration nova:** tabela `import_bubble_map`

```sql
create table public.import_bubble_map (
  bubble_table text not null,      -- 'leadfies' | 'ligacoes' | 'observacaoPipelines' | …
  bubble_id    text not null,      -- unique id do Bubble, ou chave sintética quando não há PK
  target_table text not null,      -- 'leads' | 'lead_comments' | 'lead_events' | …
  target_id    uuid not null,
  imported_at  timestamptz not null default now(),
  primary key (bubble_table, bubble_id, target_table)
);
```

**Consequência de criar:** +1 migration, +1 tabela sem RLS a definir (precisa de policy ou fica só para `service_role`),
mas resolve idempotência **de todos os domínios** (Negócios, CCA, Documentos têm o mesmo problema) e permite
re-executar qualquer etapa sem apagar nada. **Consequência de não criar:** `leads` fica idempotente de graça pelo
`external_id`, e os satélites dependem de chave natural com `where not exists` — funciona, mas é mais lento e frágil
se você alterar a regra de transformação entre execuções.

---

## 7. Lacunas

### Dado da origem sem destino no schema novo

| # | Origem | Destino que faltaria | Contorno adotado |
|---|---|---|---|
| L1 | `Cidade` (50.565), `Mensagem` (70.636), `Identificador` (98.206), `Código` (662), `Tipo de Negociação`, `whatsapp` | nenhuma coluna em `leads` | `raw_payload` (jsonb, sem constraint). Nada se perde, mas nada disso fica indexado ou filtrável na UI. |
| L2 | `Gerente` (100.101 leads, 2.151 com 2 nomes) | `leads` não tem coluna de gerente | `raw_payload.gerente_original`. A gerência real do CRM novo é derivada: `assigned_to` → `team_members` → `teams.manager_id`. **Consequência:** um lead cujo corretor mudou de equipe passa a "pertencer" ao gerente atual, não ao da época. Não há como preservar o gerente histórico sem coluna nova. |
| L3 | `Imóvel` (94.455) contém o nome da construtora como substring (34.336 casamentos com 19 das 41 construtoras) | `ad_campaigns` | **Não crie `ad_campaigns`**: `external_id` é NOT NULL e globalmente único (`0067:27-28`) e a origem não tem id de campanha da Meta. O texto vai para `leads.campaign_name`, que os relatórios de marketing já leem. |
| L4 | Ligação lead ↔ negócio | `leads.converted_deal_id` / `deals.lead_id` | **Não existe FK na origem.** Os 59 `Negócio fechado` entram como `converted` com `converted_deal_id` NULL. Passo 7: depois do domínio Negócios, casar por telefone normalizado (`pipelines.Contato`) — o perfil de ligações mediu que `pipelines` tem 6.447 telefones distintos. Enquanto não rodar, `status='converted'` com `converted_deal_id` NULL é aceito pelo banco mas some dos relatórios de conversão (`0081:70`). |
| L5 | `Reavivar em` (6.395) / `Reavivado em` (4.960) | `remarketing_lists` / `remarketing_contacts` | Sem campanha, template, canal, resultado ou tentativa na origem. Processo abandonado (nenhum registro após 06/09/2024). Só cabe `lead_events(kind='revived')` — e **zero** deles está no corte de 12 meses. |
| L6 | LGPD | não existe consentimento/opt-out em lugar nenhum | Não há campo de consentimento nem na origem nem no destino. 100 mil telefones entram no escopo de LGPD sem base documentada. **Decisão do dono** (§8, D1). |
| L7 | Texto acentuado em campo livre | — | 337.879 U+FFFD. `Cliente` (61.518 valores), `Observações`, `Mensagem` e `Cidade` **perdem acento definitivamente**. Reconstrução impossível: `Mar<FFFD>a` pode ser `María` ou `Marça`. |

### Coluna NOT NULL do destino sem origem

| Tabela.coluna | NOT NULL | Origem | Default proposto |
|---|---|---|---|
| `leads.full_name` | sim, `check length(btrim) > 0` | `Cliente` (635 vazios) | `'Lead ' \|\| Identificador`, senão `'Lead sem nome ' \|\| right(unique_id, 6)` |
| `leads.status` | sim (default `'queued'` — **perigoso**) | `Status` | sempre explícito (§4.1) |
| `leads.funnel_stage` | sim (default `'new'`) | `Atividade` | `'new'` para vazio e cauda (§4.2) |
| `leads.last_activity_at` | sim (default `now()` — **perigoso**) | `Data atividade` (2.129 vazias) | `Criado em`. Deixar o default carimba a data do import e `assign_queued_leads` passa a ler tudo como "lead de hoje". |
| `leads.created_at` | sim (default `now()`) | `Criado em` | `Creation Date` no único registro sem valor |
| `leads.roulette_misses` | sim (default 0) | — | `0` |
| `lead_comments.body` | sim, `check length(btrim) > 0` | `Observações` | pule a linha se vazio |
| `lead_events.kind` | sim, texto livre | — | `'call'` / `'revived'` |
| `lead_sources.code`, `.label` | sim | `Fonte` | §4.4 |
| `distribution_groups.name`, `.slug` | sim | `Grupo` | §4.5 |
| `lead_assignments.deadline` | sim, **sem default** | — | não aplicável: não importamos a tabela |

---

## 8. Decisões que só o dono do negócio pode tomar

| # | Decisão | Opções e consequências |
|---|---|---|
| **D1** | **Quanto histórico importar** | **A — tudo (102.799):** preserva relatório multi-ano; custo: 60% da base nasce morta, 22,6% de duplicidade de cliente, 100 mil telefones no escopo de LGPD sem consentimento documentado. **B — só ativos recentes (27.477):** CRM nasce limpo; custo: relatório de 2024/2025 fica sem base e "reavivar lead antigo" some da UI. **C — 12 meses (41.367):** equilíbrio; é a recomendação do perfil e o corte que uso nos volumes de §9. |
| **D2** | **Deduplicar por telefone?** | 14.005 telefones aparecem em 2+ leads (36.751 leads envolvidos, 10.846 já atendidos por mais de um corretor). **Não deduplicar:** fiel ao histórico, mas dois corretores podem trabalhar o mesmo número. **Deduplicar (manter o mais recente):** base limpa, mas apaga 22.746 registros e o histórico de re-entrada. O banco novo **não** tem unique em telefone, de propósito (`0056:479-485`) — a escolha é de negócio, não técnica. |
| **D3** | **Os 17 nomes de corretor ausentes do export de `Users`** (2.361 leads) | São pessoas desligadas que não vieram no export, ou grafias divergentes? **Criar perfil `terminated`** para elas preserva o dono do lead histórico; **deixar NULL** joga 2.361 leads para a bandeja da gestão. Também precisa confirmar os aliases `thabata nobre → Tabhata Nobre` (155 leads) e `maria luiza castro viana → Maria Luiza Viana` (26). |
| **D4** | **Os 59 `Negócio fechado`** | Importar como `converted` sem negócio (rápido, relatório de conversão fica torto) ou esperar o domínio Negócios e casar por telefone (correto, exige uma segunda passada). |
| **D5** | **O lote Instagram de nov/2024 (719 leads)** | Layout próprio, sem status/atividade/grupo/motivo. Importar como `discarded` (mantém rastro) ou não importar (0,70% do arquivo). |
| **D6** | **`Arquivado` vira `lost` ou `discarded`?** | Adotei: `discarded` só para `Contato Inválido`/`Lead duplicado`/`Lead Teste` (1.044); todo o resto é `lost` (35.221). A diferença é de relatório: `lost` conta como perda no funil, `discarded` não. |
| **D7** | **Fuso do Bubble** | Se o app Bubble exportou em UTC (e não em horário local), todas as datas deslocam 3 h. Só o dono do app resolve. Impacto: leads de 21h–00h migram de dia. |

---

## 9. Volume estimado por tabela destino

**Corte recomendado (D1, opção C — atividade nos últimos 12 meses, ≥ 09/09/2025):**

| Tabela | Linhas | Quebra |
|---|---:|---|
| `lead_sources` | **+5** | `chatbot_leadfy`, `tecimob`, `botconversa`, `instagram`, `facebot` |
| `distribution_groups` | **+47** | 46 rótulos legados + `chatbot`, todos `active=false` (`Roleta Geral` reusa `fila-geral`) |
| **`leads`** | **41.367** | `in_progress` 27.477 · `lost` 13.633 · `discarded` 247 · `converted` 10 |
| `lead_comments` | **2.970** | `Observações` preenchida nos leads do corte |
| `leads.notes` (UPDATE no próprio insert) | 1.616 | `Obs. atividade` |
| `lead_events` kind=`call` | **5.051** | ligações cujo telefone casa com lead do corte |
| `lead_events` kind=`revived` | **0** | todo o `Reavivar em` é de 2024 — nenhum entra no corte |
| `lead_assignments` | **0** | não importamos (§1) |
| `notifications` geradas | **0** | com as travas de §2 e sem `lead_assignments` |

**Se o dono escolher a opção A (tudo):**

| Tabela | Linhas | Quebra |
|---|---:|---|
| **`leads`** | **102.799** | `in_progress` 65.756 · `lost` 35.221 · `discarded` 1.763 (1.044 + 719 do lote Instagram) · `converted` 59 |
| `lead_comments` | **7.432** | |
| `leads.notes` | 2.790 | |
| `lead_events` kind=`call` | **6.421** | |
| `lead_events` kind=`revived` | **4.960** | opcional |
| `lead_sources` / `distribution_groups` | +5 / +47 | igual |

Distribuição do dono (opção A): **99.294 leads com `assigned_to` resolvido** e **3.504 + 1 sem `Corretor` = 3.505 com NULL**,
dos quais 2.192 estão vivos (`in_progress`) e ficam visíveis só a quem tem `leads.view_queue`.

---

## 10. Verificação pós-carga (rode antes de religar os crons)

```sql
-- 1. Nada pode ter ficado na roleta.
select status, count(*) from public.leads group by 1 order by 2 desc;
--    esperado: zero linhas com status = 'queued'.

-- 2. Nenhum corretor pode bater o teto de atrasados (senão perde o check-in).
select assigned_to, count(*) from public.leads
 where status in ('assigned','attending','in_progress') and next_action_at < now()
 group by 1 having count(*) >= 20;
--    esperado: zero linhas (importamos next_action_at NULL).

-- 3. Coerência das constraints de desfecho.
select count(*) from public.leads where status = 'lost'      and lost_at is null;      -- 0
select count(*) from public.leads where status = 'discarded' and lost_at is not null;  -- 0

-- 4. Idempotência: conte pelo lote, não por count(*) da tabela.
select count(*) from public.leads where external_id like 'bubble:leadfy:%';

-- 5. Telefone: o trigger normalizou o que devia.
select count(*) from public.leads
 where external_id like 'bubble:leadfy:%' and phone is not null and phone !~ '^55[0-9]{10,11}$';
--    esperado: 0 (se der >0, entrou telefone inválido que normalize_phone deixou passar cru).

-- 6. Nenhuma notificação nova.
select count(*) from public.notifications where created_at >= :inicio_da_carga;  -- 0

-- 7. Depois de religar, espere 1 minuto e confira de novo o item 6.
```

---

*Todo número deste documento veio de script Python sobre os CSVs (streaming, módulo `csv` do Python 3.12) ou de leitura
das migrations citadas. Nenhum arquivo do repositório fora deste foi alterado e nenhuma consulta foi feita ao banco.
Dados pessoais aparecem apenas mascarados ou como contagem.*
