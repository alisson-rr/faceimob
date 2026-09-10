# Mapeamento de importação — Negócios, clientes, participantes e rateio

**Origem:** `DOCUMENTOS/DADOS_BUBBLE/export_All-pipelines-modified--_2026-09-08_19-43-56.csv`
(7.568 registros, 110 colunas) + `export_All-observacaoPipelines-modified_2026-09-08_19-43-41.csv`
(24.766) + `export_All-vendas-modified_2026-09-08_19-45-58.csv` (6) +
`export_All-financeiros_2026-09-08_19-38-25.csv` (26).
**Destino:** `public.deals`, `deal_clients`, `deal_participants`, `deal_history`,
`developers`, `developer_projects`.
**Data:** 09/09/2026 · **Fase:** somente leitura de arquivo. Nada rodou contra banco.

Todo número deste documento saiu de um script executado sobre os CSVs
(`<scratchpad>/fk.py`, `agg.py`, `cross.py`, `s2.py`, `fin.py`, `cr.py`, `vol.py`, `code.py`),
com `csv.DictReader` do Python 3.12 em streaming. Onde há hipótese, ela está marcada.

---

## 0. As seis decisões que este documento toma (e por quê)

| # | Decisão | Evidência | Consequência de fazer diferente |
|---|---|---|---|
| 1 | **A chave de junção nome→pessoa é `Users.colaboradores`, não `Users.Nome_completo`** | `CORRETOR 1` resolve **7.271/7.349 (98,94%)** por `colaboradores` e **0** por `Nome_completo`; `colaboradores` tem 298 valores distintos em 298 linhas (zero duplicata) | Casar por `Nome_completo` deixa 5.185 negócios sem corretor. O perfil `pipelines.md` §8 mediu 29% porque comparou contra a coluna errada |
| 2 | **`deals.outcome` sai de `STATUS`; `deals.status_detail` sai de `STATUS2`** | `dealCategory` (`src/components/dashboard/data.ts:450-455`) decide a categoria por `outcome`; `status_detail` só distingue DISTRATO×QUEDA e "encerra sem perda" | Trocar os dois derruba todos os indicadores |
| 3 | **`STATUS='OFF'` sem rótulo de perda vira `status_detail='OFF'`, não o rótulo do Bubble** | `encerraSemPerda` (`data.ts:428-431`) só devolve `true` para `'OFF'` e para os `LOSS_REASONS`. Com `'09. APROV. TOTAL'` no `status_detail`, **4.400 negócios OFF viram PERDA** no painel | O painel de perdas nasce com 4.400 perdas que nunca existiram. O rótulo do Bubble vai para `lost_reason` e não se perde |
| 4 | **`STATUS='DISTRATO'` vira `outcome='lost'`, não `'cancelled'`** | `dealCategory` devolve `"fora"` para `cancelled` (`data.ts:454`), e `perdaIds` (`data.ts:471-489`) só olha categoria `'perda'` | Com `cancelled`, os 158 distratos somem da conta de perdas — e a regra "distrato só conta se houve venda anterior do mesmo cliente" nunca roda |
| 5 | **Rateio não é migrado: é recalculado pelo banco (100/n entre corretores)** | `vgv_corretor_1/2` e `vgv_gerente_1/2` estão **100% vazias** (0 de 7.568); `deal_participants_resplit` sobrescreve qualquer `share_pct` enviado (`0006:229-246` → `0058:31-79`) | Não há o que preservar. Enviar `share_pct` é trabalho jogado fora |
| 6 | **Idempotência por UUIDv5 determinístico, não por tabela de-para** | `deals` **não tem** coluna `external_id` (conferido em `SCHEMA_ALVO.md:43`). `id` é `uuid` livre e aceita valor explícito | Ver §6. A de-para (`import_bubble_map`) fica só para o que **não** é computável: os 20 nomes de corretor sem correspondência |

---

## 1. Ordem de carga

Dependência estrita, de cima para baixo. Cada passo só começa depois do anterior fechar.

```
 0. PRÉ-VOO (§9)  — travar crons, leads_paused, conferir closed_months, desligar 4 triggers
 1. profiles + user_roles + teams + team_members   ← DOMÍNIO "identidade" (não é meu; é pré-requisito)
 2. developers            ← catálogo Construtoras (41) ∪ CONSTRUTORA2 (32 usadas)
 3. developer_projects    ← (developer_id, EMPREENDIMENTO normalizado): 635 pares
 4. pipeline_stages       ← JÁ EXISTE (supabase/seed.sql:11-22, 9 etapas). NÃO importar
 5. deals                 ← pipelines, 1:1
 6. deal_clients          ← pipelines, blocos ordinal 1 e 2
 7. deal_participants     ← pipelines, colunas de slot (brokers primeiro, com ordinal)
 8. deal_history          ← observacaoPipelines (kind='comment')
 9. PÓS-VOO (§9)          — religar triggers, conferências, limpar game_events/notifications
```

**Por que `deal_participants` depois de `deals` e não junto:** `deals_add_creator_participant`
(AFTER INSERT em `deals`, `0053:97-134`) insere participante sozinho quando `created_by` está
preenchido **e** `lead_id` é nulo — que é exatamente o nosso caso. Ver §9, trava T4.

**Fora do meu domínio, mas dependem de `deals` existir:** `cca_cases` (esteira),
`deal_documents` (via `doc`/`documentos`), `game_events` (via `GameCorretor1/2`),
`leads.converted_deal_id`. Entregar `deals` com a de-para `unique id → deals.id`
publicada (§6) é o que destrava esses três.

---

## 2. Mapeamento coluna a coluna — `pipelines` (110 colunas)

Convenções de transformação usadas nas regras abaixo (definidas uma vez, referenciadas por nome):

```python
# T-DATA: data en-US do Bubble → timestamptz America/Sao_Paulo
#   datetime.strptime(v, "%b %d, %Y %I:%M %p").replace(tzinfo=ZoneInfo("America/Sao_Paulo"))
#   SUPOSIÇÃO: o arquivo não declara fuso (§10, S1). 100% dos valores parseiam neste formato.

# T-MES: competência mensal → date, SEM passar por timezone
#   d = strptime(v, "%b %d, %Y %I:%M %p"); date(d.year, d.month, 1)
#   O dia varia (5: 6.650x, 1: 882x, e 12 outros dias em 36 linhas) — sempre truncar para o dia 1.

# T-MOEDA: dinheiro BR → numeric
def money(v):
    v = (v or "").strip().lower().replace("r$", "").strip().replace(" ", "")
    if v in ("", "-"): return None            # 'R$ -' = nulo: 632 casos em VGV BRUTO
    if "," in v and "." in v: v = v.replace(".", "").replace(",", ".")   # 1.234.567,89
    elif "," in v:            v = v.replace(",", ".")                    # 1234,56
    return Decimal(v)

# T-FONE: telefone → E.164. Guardar o ORIGINAL, não o normalizado.
#   d = só dígitos; se len(d)==13 e começa com 55 -> corta 1 dígito espúrio? NÃO: descartar
#   len 11 -> "+55"+d ; len 10 -> "+55"+d ; len 12 e começa 55 -> "+"+d ; len 9 -> sem DDD, ver S2
#   len<=8 -> NULL. Medido em Contato: 11 dígitos 4.860 · 10 dígitos 1.382 · 12 dígitos 81 ·
#   13 dígitos 17 · 9 dígitos 43 · <=8 dígitos 19.

# T-CPF: só dígitos; aceitar SOMENTE len==11, senão NULL.
#   Medido: 11 dígitos 5.388 de 5.428 preenchidos; 40 linhas com 1..14 dígitos viram NULL.

# T-NOME: normalização para casar FK — ver §5.
#   NFKD, remove combining, \xa0 -> espaço, colapsa espaços, .lower()

# T-SIMNAO: "SIM"/"NÃO"/"sim"/"não" -> boolean. Comparar SEM acento e em minúscula.

# T-NBSP: 3 rótulos de STATUS2 e 1 de OrigemLead trazem \xa0 no lugar do espaço
#   (262 + 359 linhas). Trocar \xa0 por espaço ANTES de qualquer comparação.
```

### 2.1 Grupo Cliente → `deal_clients` (25 colunas)

Duas linhas por negócio no máximo: bloco sem sufixo → `ordinal = 1`, bloco `_2` → `ordinal = 2`.
`unique (deal_id, ordinal)`, `check (ordinal in (1,2))` (`0006:86,114`).

| Origem | Destino | Regra de transformação | Cobertura |
|---|---|---|---|
| `CLIENTE` | `deal_clients.full_name` (ord 1) | `strip()`. **NOT NULL** — 16 linhas vazias: usar `'(sem nome — Bubble ' \|\| unique id \|\| ')'` | 7.552 |
| `CLIENTE_2` | `deal_clients.full_name` (ord 2) | idem. Só cria a linha ord 2 se `CLIENTE_2` não vazio | 352 |
| `cpf_numero` / `cpf_numero_2` | `deal_clients.cpf` | T-CPF | 5.388 / 351 |
| `Contato` / `Contato_2` | `deal_clients.phone` | T-FONE | 6.402 / 333 |
| `email` / `email_2` | `deal_clients.email` (citext) | `strip().lower()`; descartar se sem `@` (0 casos medidos) | 4.655 / 291 |
| `estado_civil` / `estado_civil_2` | `deal_clients.marital_status` | De-para §4.4. **40 variantes** para 6 conceitos | 4.623 / 289 |
| `naturalidade` / `naturalidade_2` | `deal_clients.birthplace` | `strip()` + colapsar espaço + Title Case. **Não** deduplicar contra catálogo: `PORTO ALEGRE ` (355) e `PORTO ALEGRE` (1.295) fundem só pelo strip; `POA` (148) e `BRASILEIRO` (174) ficam como estão | 4.615 / 290 |
| `dependente` / `dependente_2` | `deal_clients.dependents` (**text**, não boolean) | Gravar `'SIM'`/`'NÃO'` literal. A coluna alvo é text livre | 4.566 / 283 |
| `data_Admissao` / `data_Admissao_2` | `deal_clients.admission_date` (**date**) | T-DATA e depois `.date()`. 100% parseável | 4.243 / 223 |
| `pis` / `pis_2` | `deal_clients.pis` | Só dígitos; gravar **apenas** `len==11` (3.621 de 4.579), resto NULL. 958 linhas com 1..36 dígitos são lixo | 3.621 / ~215 |
| `ref_cch` / `ref_cch_2` | `deal_clients.cch_reference` | `strip().upper()`. É só o nome do mês, sem ano — gravar como está | 4.227 / 217 |
| `cep_endereco` / `cep_endereco_2` | `deal_clients.postal_code` | Só dígitos; formatar `#####-###` se `len==8`, senão gravar cru | 4.533 / 278 |
| `cotista` / `cotista_2` | `deal_clients.is_shareholder` (boolean) | T-SIMNAO | 4.607 / 286 |
| `rendaInformal` | `deal_clients.has_informal_income` (ord 1) | T-SIMNAO. **NOT NULL default false** → vazio vira `false` | 483 |
| `segmentoAtividade` | `deal_clients.activity_segment` (ord 1) | `strip()`. Texto livre, 242 valores | 312 |
| `formaAtuacao` | `deal_clients.activity_form` (ord 1) | `strip().upper()`. Sujo (`AUTONOMA`/`AUTONOMO`, `PRESENCIAL `/`PRESENCIAL`) — normalizar só espaço e caixa | 311 |
| `dataInicioAtividade ` (⚠ espaço no fim do nome) | `deal_clients.activity_duration` (ord 1) | `strip()`. **Não é data** (0/306 parseiam); a coluna alvo é `text` e cabe `'2 ANOS'` tal e qual | 306 |
| `formaDivulgacao` | `deal_clients.disclosure_form` (ord 1) | `strip()`. Enum limpo: `Indicação` 214 · `Mídias Sociais` 66 · `Panfletagem` 3 | 283 |
| `declaraImpostoRenda` | `deal_clients.declares_income_tax` (ord 1) | T-SIMNAO | 4.175 (4.174 `não`) |
| `rendimentoMensal` | `deal_clients.monthly_income` (`numeric(12,2)`) | T-MOEDA | 314 |
| `ObsRenda` | `deal_clients.income_notes` (ord 1) | `strip()` | 162 |
| `compra_conjunto` | **DESCARTAR** | Redundante: a existência da linha `ordinal=2` já diz. `sim`=347 × `CLIENTE_2` preenchido=352 — a coluna é menos confiável que o fato | 1.204 |
| `cotistaCCA` | **DESCARTAR** | Segunda gravação do mesmo booleano pela CCA; concorda com `cotista` em 386/443 (87%). Manter duas fontes de verdade para "é cotista" é o bug que o schema novo eliminou | 447 |
| `RefCCHcca` | **DESCARTAR** | Idem: paralelo de `ref_cch`, 249 linhas contra 4.227, concordância 213/241 | 249 |
| `emiteNota` | **DESCARTAR** | Constante: `não` em 4.175 de 4.175. Zero informação | 4.175 |

### 2.2 Grupo Participantes → `deal_participants` (22 colunas)

`role` vem do **slot da coluna**, nunca da `Funcao` da pessoa. Medido: `GERENTE 1` aponta para
alguém cuja `Users.Funcao` é **DIRETOR em 3.392 negócios**, GERENTE em 2.365 e CORRETOR em 533.
E `CORRETOR 1` aponta para um DIRETOR em 176 e um GERENTE em 755. O papel no negócio é
posicional; a função no RH é outra coisa.

| Origem | Destino | Regra | Cobertura resolvida |
|---|---|---|---|
| `CORRETOR 1` | `deal_participants` `role='broker'`, `ordinal=1` | T-NOME → `Users.colaboradores` → `profiles.id`. `share_pct` **não enviar** (o banco recalcula). `auto_added=false` | **7.271 / 7.349 (98,94%)** |
| `CORRETOR 2` | idem, `ordinal=2` | idem. Pular se igual (normalizado) ao slot 1 | **841 / 849 (99,06%)** |
| `CORRETOR 3` | idem, `ordinal=3` | idem | **5 / 5 (100%)** |
| `GERENTE 1` | `role='manager'`, `ordinal=1` | idem | **7.375 / 7.521 (98,06%)** |
| `GERENTE2` (sem espaço) | `role='manager'`, `ordinal=2` | idem. ⚠ **`GERENTE 2` com espaço não existe no CSV** | **151 / 155** |
| `GERENTE 3` | `role='manager'`, `ordinal=3` | idem | **7 / 7 (100%)** |
| `Diretor1` | `role='director'`, `ordinal=1` | idem | **5.086 / 5.086 (100%)** |
| `diretor2` | `role='director'`, `ordinal=2` | idem | **73 / 73 (100%)** |
| `corretor`, `corretor2` | **DESCARTAR** (usar só como fallback de auditoria) | Versões legadas sujas: 222 grafias contra 210 da canônica; 192 linhas não resolvem contra 78 da canônica. Divergem da canônica em 3,8% e a divergência é apelido × nome (`Isaias Ribeiro Luca` × `Isaias Lucca`) | — |
| `gerente`, `gerente2` | **DESCARTAR** (idem) | 310 linhas não resolvem contra 146 da canônica | — |
| `diretor3` | **DESCARTAR** | 0 de 7.568 preenchidas | 0 |
| `vgv_corretor_1`, `vgv_corretor_2`, `vgv_gerente_1`, `vgv_gerente_2` | **DESCARTAR** | **0 de 7.568 preenchidas**. É a razão de o rateio não ser migrável (§0, decisão 5) | 0 |
| `cca_externo1`, `cca_externo2` | → `cca_cases.analyst_id` (**domínio CCA**, fora daqui) | E-mail, não nome: casa por `Users.email`. `cca_externo1` 376/646 (58%), `cca_externo2` 268/296 (91%) | — |
| `cca_externo3`, `cca_externo4` | **DESCARTAR** | 8 valores cada, **cópia literal** um do outro, 0/8 casam com `Users`. Contém `a@a.com`, `a@arrombado.com` | 8 |

**Nunca mais de 3 por papel.** O front apaga o 4º participante silenciosamente no primeiro
salvamento do modal (limite documentado em `newSchema.ts:979-986`). As colunas do Bubble já
respeitam esse teto: 3 slots de corretor, 3 de gerente, 2 de diretor.

**Volume:** 8.110 brokers + 7.490 managers + 5.122 directors = **20.722 linhas**.

### 2.3 Grupo Valores → `deals` + `cca_cases.analysis` (21 colunas)

| Origem | Destino | Regra | Cobertura |
|---|---|---|---|
| `VGV BRUTO` | `deals.vgv_gross` (`numeric(14,2)`) | T-MOEDA. **632 valores são o literal `R$ -` = NULL.** Fallback: quando vazio e `VGV LIQUIDO > 0`, usar `VGV LIQUIDO` | 2.148 numéricos, 2.146 > 0 |
| `PARC_DESCONTO` | `deals.discount_pct` (`numeric(5,2)`) | `round(PARC_DESCONTO / VGV_BRUTO * 100, 2)`. **NOT NULL default 0.** 1 valor negativo (−2.000) → forçar 0 | 624 ≠ 0 |
| `VGV LIQUIDO` | **DERIVADO — não inserir** | `deals.vgv_net` é `GENERATED ALWAYS AS STORED` (`0006:45-46`): **qualquer valor no INSERT dá erro**. Serve só para conferir | 7.567 |
| `PARC. DESCONTO` (com ponto) | **DESCARTAR** | 0 de 7.568 | 0 |
| `vgv_bruto`, `vgv_prentedido`, `dias` | **DESCARTAR** | 0 de 7.568 cada | 0 |
| `ValorFGTSFuturo` | **DESCARTAR** | 6 valores, todos `0` | 6 |
| `ValorAvaliacao` | `cca_cases.analysis->>'valor_avaliacao'` | T-MOEDA. ⚠ outlier `277000194` (dígito colado) = 97% da soma da coluna: rejeitar valores > 10× o `VGV BRUTO` da linha | 43 |
| `ValorCompraVenda` | `cca_cases.analysis->>'valor_compra_venda'` | T-MOEDA | 58 |
| `ValorFGTS` | `cca_cases.analysis->>'valor_fgts'` | T-MOEDA | 50 |
| `FGTS` | `cca_cases.analysis->>'usa_fgts'` (boolean) | T-SIMNAO. ⚠ **booleano, apesar do nome** | 405 |
| `FGTSFuturo` | `cca_cases.analysis->>'usa_fgts_futuro'` (boolean) | T-SIMNAO. ⚠ booleano | 413 |
| `SubsidioEstadual` / `SubsidioFederal` | `cca_cases.analysis->>'subsidio_estadual'` / `'subsidio_federal'` | T-MOEDA | 16 / 31 |
| `ParcelaAprovada` | `cca_cases.analysis->>'parcela_aprovada'` | T-MOEDA. 1 valor com vírgula E ponto — validar | 455 |
| `RendaAprovada` | `cca_cases.analysis->>'renda_aprovada'` | T-MOEDA. 2 valores com vírgula E ponto | 457 |
| `Fator` | `cca_cases.analysis->>'usa_fator'` (boolean) | T-SIMNAO. ⚠ booleano, não número | 447 |
| `Tabela` | `cca_cases.analysis->>'tabela'` | `strip().upper()`. Enum: `PRICE` 473 · `SAC` 4 | 477 |
| `Prazo` | `cca_cases.analysis->>'prazo_meses'` (int) | Inteiro. ⚠ 1 outlier `4201` (rejeitar > 480) e 1 não numérico | 445 |
| `FinanciamentoAprovado` | `cca_cases.analysis->>'financiamento_aprovado'` | T-MOEDA. ⚠ é **valor em R$**, apesar do nome sugerir booleano | 73 |

> **⚠ Perda controlada e mensurada:** `vgv_net` é gerada como
> `round(vgv_gross * (1 - discount_pct/100), 2)` e `discount_pct` é `numeric(5,2)` — **2 casas**.
> O desconto do Bubble é em R$, não em %. Reconstituindo `VGV LIQUIDO` pela fórmula do banco,
> medi nos 624 negócios com desconto: **erro máximo R$ 20,20 · mediana R$ 6,00 · 604 de 624
> passam de R$ 0,01 · 564 passam de R$ 1,00**. O erro total é ~R$ 4 mil sobre R$ 465,2 mi
> (0,0008%). **Não há como preservar bruto e líquido ao mesmo tempo** — é decisão do dono (§8, D3).

### 2.4 Grupo Status e datas → `deals` (10 colunas)

| Origem | Destino | Regra | Cobertura |
|---|---|---|---|
| `STATUS` | `deals.outcome` + `deals.stage_id` | De-para §4.1 e §4.2 | 7.566 |
| `STATUS2` | `deals.status_detail` (+ `lost_reason` quando OFF) | De-para §4.3. T-NBSP obrigatório | 7.549 |
| `ENVIO` | `deals.created_at` | T-DATA. **É a data do fato**, não do registro: anterior ao `Creation Date` em 1.067 linhas e posterior em 188 | 7.567 |
| `mes` | `deals.month_base` (`date`) | **T-MES** (nunca via timezone: `2024-05-01 00:00-03` viraria `2024-04-30` em UTC). ⚠ Ver a armadilha do trigger em §9-T2 | 7.564 |
| `mudou_status` | `deals.stage_entered_at` **e** `deals.closed_at` | T-DATA. **Cobre 100% dos 7.072 negócios que precisam de `closed_at`** (`deals_closed_consistency` exige `closed_at` quando `outcome <> 'open'`). ⚠ 2.039 linhas trazem `Sep 18, 2024` — carimbo da migração do Bubble, não a data real | 7.567 |
| `statusNumero` | **DESCARTAR** | Código numérico de `STATUS2`, incompleto: 1.048 vazios cobrindo 6 rótulos criados em 2025/26. Não serve como `position` e o mapa 1:1 já sai de `STATUS2` | 6.520 |
| `status_filtro` | **DESCARTAR** | **Semanticamente quebrada**: duas gerações convivem (cópia de `STATUS` em 3.148 linhas, booleano `sim/não` em 4.416). `STATUS='VENDA'` aparece como `filtro='PROPOSTA'` em 1.027 linhas | 7.566 |
| `Off` | **DESCARTAR** | Redundante: as 4.879 `sim` são exatamente `STATUS='OFF'` | 6.942 |
| `enviar` | **DESCARTAR** | 0 de 7.568 | 0 |

### 2.5 Grupo Empreendimento → `developers` / `developer_projects` / `deals` (4 colunas)

| Origem | Destino | Regra | Cobertura |
|---|---|---|---|
| `CONSTRUTORA2` | `deals.developer_id` | `coalesce(CONSTRUTORA2, construtora)` → T-NOME → `developers.name`. **7.546/7.546 casam com o catálogo Construtoras (100%)** | 7.546 |
| `construtora` | fallback do anterior | Cobre 5 linhas em que `CONSTRUTORA2` está vazia. 6 linhas trazem `MAISLAR` = `MAIS LAR` sem espaço → regra explícita `MAISLAR → MAIS LAR` | 7.551 |
| `EMPREENDIMENTO` | `deals.project_id` via `developer_projects` | T-NOME + `.upper()`. **688 valores crus → 576 normalizados → 635 pares `(construtora, empreendimento)`.** Chave natural do destino é `unique (developer_id, name)` (`0003:77-92`) | 7.529 |
| `BL - UN` | `deals.unit` (`text`) | `strip()`. Gravar cru: 1.479 no formato `bl \| un`, 400 em `a-b`, 242 só dígitos. **NULL** para os ≥80 placeholders (`ESCOLHER` 27, `00` 27, `01` 16, `EXTERNO` 6, `0-0` 6, `0000` 6, `00-00` 8) | 2.377 |

> `developer_projects.state` é `char(2)` e **não há origem** — deixar NULL. `city` idem.
> O nome do empreendimento é texto livre sem catálogo: `GARDA` 171 × `Garda` 60 e
> `MORADA DO CAMPO` 142 × `Morada do Campo` 40 só fundem depois da normalização.
> **Gravar o nome canônico em CAIXA ALTA** (a forma mais frequente) para o `ilike` exato do
> front resolver (`newSchema.ts:884-889` busca por `ilike` sem `%`, `maybeSingle()`).

### 2.6 Grupo Origem, Documentos, Game, Observações e metadados (26 colunas)

| Origem | Destino | Regra | Cobertura |
|---|---|---|---|
| `OrigemLead` | `deals.lead_origin` (`text`) | T-NBSP (`Lead\xa0Indicação`, 359 linhas) + `strip()`. 5 valores: `Lead Próprio` 2.832 · `Leadfy` 576 · `Lead Indicação` 359 · `Lead Loja` 166 · `Lead Feirão` 34 | 3.967 |
| `Campanha`, `Canal`, `Fonte`, `Criativo Meta`, `Formulário Meta` | **DESCARTAR** | 0 de 7.568 cada. **Toda a atribuição de mídia paga não existe neste export** (§7, L1) | 0 |
| `OBSERVAÇÃO` | `deals.notes` (`text`) | `strip()`. É só a **última** observação; o histórico completo vem de `observacaoPipelines` (§3) | 4.238 |
| `obs` | **DESCARTAR** | 0 de 7.568 | 0 |
| `doc` | → `deal_documents` (**domínio CCA**) | `unique id` de verdade: **2.857/2.857 casam com `doc-clientes.unique id`**. Única FK por id que sobreviveu no export | 2.857 |
| `documentos` | → `deal_documents` (**domínio CCA**) | Lista de URLs do CDN separada por `" , "`. 29.447 URLs. **2.167 linhas só têm isto** (sem registro em `doc-clientes`) | 4.330 |
| `GameCorretor1`, `GameCorretor2` | → `game_events` (**domínio gamificação**) | `unique id`: 1.367/1.367 e 69/69 casam com `gameficacaos.unique id` | 1.367 / 69 |
| `gameEsteiraAgilPontuada` | **DESCARTAR** | Flag de idempotência interna do Bubble (`sim` 1.028 / `não` 238). O destino tem a própria (`game_events_dedupe_idx`, `0010:121-123`) | 1.266 |
| `financeiro` | **DESCARTAR na onda 1** | Lista de `unique id` de `financeiros`. Só **7 linhas de 7.568**. Ver §7-L4 | 7 |
| `Creator` | `deals.created_by` | T-NOME → `Users.colaboradores`. **6.336/7.568 (83,7%)**. Os 1.232 restantes são `(App admin)` 1.081 e `(deleted thing)` 151 → **NULL**. ⚠ Ver §9-T4 | 7.568 |
| `Creation Date` | **DESCARTAR** (usar `ENVIO`) | É o carimbo do registro, não do negócio. Guardar em `deal_history.detail` se auditoria exigir | 7.568 |
| `Modified Date` | `deals.updated_at` | T-DATA. ⚠ Nenhum registro tem valor anterior a set/2024: o Bubble reescreveu a coluna numa migração em 18-19/09/2024 | 7.568 |
| `Slug` | **DESCARTAR** | 0 de 7.568 | 0 |
| `unique id` | `deals.id` (UUIDv5) **e** `deals.code` | §6 | 7.568 |

### 2.7 Colunas do destino sem origem em `pipelines`

| Destino | Valor proposto | Justificativa |
|---|---|---|
| `deals.lead_id` | **NULL** | `pipelines` não tem uid de lead. Só reconstruível cruzando `Contato` com `leadfies` por telefone — trabalho do domínio de leads, onda 2. Ver §7-L2 |
| `deals.document_review_status` | `'approved'` para `outcome<>'open'`; `'draft'` para os 494 abertos | Etapas `under_analysis`/`approved`/`contract`/`closed` exigem `document_review_status='approved'` para **entrar por UPDATE** (`0028:109-114`). Marcar os históricos evita travar o operador num negócio morto; marcar os 494 vivos seria afirmar que uma conferência aconteceu. Ver §8-D5 |
| `deals.document_review_*` (5 colunas de auditoria) | **NULL** | Sem origem. `deals_guard_document_review` é BEFORE **UPDATE** apenas — inserir não é problema |
| `deal_participants.share_pct` | **não enviar** | Recalculado por `deal_participants_resplit` (100/n entre brokers, gestor 0) |
| `deal_participants.auto_added` | `false` | Marca o que veio do legado. O autofill marca `true` no que ele criar |
| `visits` | **nenhuma linha** | `pipelines` não tem data de visita. `STATUS2` não tem rótulo de visita. Ver §7-L3 |
| `developer_submissions` | **nenhuma linha** | Sem origem, e o INSERT dispara `developer_submissions_advance_case` (`0077:350-352`) |

---

## 3. `observacaoPipelines` (24.766) → `deal_history`

| Origem | Destino | Regra |
|---|---|---|
| `observacao` | `deal_history.to_value` | `strip()`. **É onde o texto mora**: `add_deal_comment` grava exatamente assim (`0020:319-320`) e `DealCommentsPanel` lê `to_value` filtrando `kind='comment'` (`DealCommentsPanel.tsx:28-33`). Máx. 1.285 chars, sem risco de limite |
| — | `deal_history.kind` | Constante `'comment'`. É a única chave do catálogo do front (`DealHistoryPanel.tsx:8-20`) que aparece no painel de comentários |
| `pipeline` | `deal_history.deal_id` | T-NOME → `pipelines.CLIENTE` → `deals.id`. **4.611/4.611 nomes casam (100%)**, mas **101 nomes são ambíguos** (mesmo `CLIENTE` em 2+ negócios) → desempate §5.3 |
| `Creator` | `deal_history.actor_id` | T-NOME → `Users.colaboradores`. 24 de 118 autores não existem em `Users` → 1.786 linhas com `actor_id` NULL (a coluna aceita) |
| `Creation Date` | `deal_history.created_at` | T-DATA. Faixa 13/11/2024 → 08/09/2026 |
| `data` | **DESCARTAR** | Cópia (às vezes truncada para meia-noite) de `Creation Date`: **mesmo dia em 24.766/24.766**. Manter criaria segunda fonte de verdade |
| `Modified Date` | **DESCARTAR** | Igual a `Creation Date` nas 24.766 linhas — registro append-only |
| `Slug` | **DESCARTAR** | 0% preenchida |
| `unique id` | `deal_history.id` (UUIDv5) | §6 |

**Descartar antes de inserir:** 172 linhas com `observacao` vazia (`kind` é NOT NULL mas
`to_value` vazio é comentário fantasma) e 43 duplicatas exatas `(pipeline, texto, data)`.
**Volume final: 24.766 − 172 − 43 = 24.551 linhas.**

> **Simplificação deliberada, com teto conhecido:** 4.561 observações (18,4%) começam com
> `STATUS: <código>` e 97,4% dos códigos casam com o vocabulário de `STATUS2` — dariam
> `kind='cca_status_changed'` + `to_value=<código>`. **Não estruturar na carga.**
> Motivo: `DealCommentsPanel` só mostra `kind='comment'`, então estruturar **esconderia o
> texto** da única tela que a operação lê. A estruturação continua derivável do texto por
> prefixo, a qualquer momento, sem reimportar.
> `ponytail: tudo entra como 'comment'; evoluir para 'cca_status_changed' quando existir uma
> tela que leia esse kind e mostre o corpo junto.`

---

## 4. De-para de valores

### 4.1 `STATUS` → `deals.outcome`

| Bubble `STATUS` | n | `deals.outcome` | `closed_at` |
|---|---:|---|---|
| `VENDA` | 1.829 | **`won`** | `mudou_status` |
| `PARCEIRO` | 8 | **`won`** | `mudou_status` |
| `PROPOSTA` | 494 | **`open`** | **NULL** |
| `OFF` | 5.077 | **`lost`** | `mudou_status` |
| `DISTRATO` | 158 | **`lost`** (não `cancelled` — §0, decisão 4) | `mudou_status` |
| *(vazio)* | 2 | **`open`** + etapa `incomplete` | NULL |
| **valor desconhecido** | — | **abortar a linha e listar no relatório de carga.** `STATUS` tem 5 valores medidos e fechados; um sexto valor significa export novo, não dado sujo | — |

`deals_closed_consistency` (`0006:59-60`) rejeita `outcome<>'open'` sem `closed_at`.
`mudou_status` cobre **7.072/7.072** dos casos necessários — zero fallback preciso.

### 4.2 `STATUS`+`STATUS2` → `pipeline_stages.code`

Regra em cascata, primeira que casa vence (espelha `dealStageCodeFor`, `newSchema.ts:816-821`):

```
1. STATUS in ('VENDA','PARCEIRO')                       -> 'closed'   (1.837)
2. STATUS in ('OFF','DISTRATO')                         -> 'lost'     (5.235)
3. STATUS = 'PROPOSTA' -> pela família do STATUS2:
     INCOMPLETO, (vazio)                                -> 'incomplete'
     PENDENTE, PENDENTE C/ RESTRIÇÃO, RESTRIÇÃO, BACEN,
     EM PROCESSAMENTO, AG. RET. AGENCIA, ANÁLISE EXTERNA,
     ESTEIRA AGIL, RET. ESTEIRA AGIL,
     ANÁLISE P/ VIRAR NEGÓCIO, PENDENTE P/ VIRAR NEGÓCIO -> 'under_analysis'
     APROV. TOTAL, APROV. COND., APROVADO POTENCIAL,
     APROV. TOT. RESTRIÇÃO, APROV. COND. RESTRIÇÃO,
     APROV. AG. CONT., RP APROVADO, ENVIO DE RP,
     RC EMITIDA, VIROU NEGÓCIO, INTERNALIZADO            -> 'approved'
     EM CONTRATO, ASSINADO, ASS. BANCO                   -> 'contract'
     REPROVADO, QUEDA, DISTRATO                          -> 'lost'
4. STATUS2 desconhecido em PROPOSTA                      -> 'incomplete' + registrar no log
```

Resolver o `stage_id` **por `code`**, nunca por UUID fixo
(`join public.pipeline_stages s on s.code = ...`, padrão de `seeds/030:211`).
`outcome` e `stage.outcome` ficam coerentes por construção nas regras 1–2; na regra 3 ambos
são `open` exceto os que caem em `'lost'` — **essa é a única inconsistência tolerada** e
não há constraint que a proíba (`deals_guard_stage` é BEFORE UPDATE, `0006:435-437`).

### 4.3 `STATUS2` → `deals.status_detail` e `deals.lost_reason`

Destino: o catálogo de 32 rótulos de `src/components/pipeline/statuses.ts:19-53`
(o que o Select da tela oferece). **28 dos 29 valores do Bubble casam** apenas acrescentando
o prefixo numerado; o casamento é por rótulo já sem NBSP.

| Bubble `STATUS2` (T-NBSP aplicado) | n | `status_detail` quando `STATUS<>'OFF'` | `lost_reason` quando `STATUS='OFF'` |
|---|---:|---|---|
| `APROV. TOTAL` | 1.172 | `09. APROV. TOTAL` | `09. APROV. TOTAL` |
| `ASSINADO` | 718 | `03. ASSINADO` | `03. ASSINADO` |
| `ASS. BANCO` | 699 | `02. ASS. BANCO` | `02. ASS. BANCO` |
| `PENDENTE` | 668 | `16. PENDENTE` | `16. PENDENTE` |
| `APROV. COND.` | 663 | `10. APROV. COND.` | `10. APROV. COND.` |
| `REPROVADO` | 590 | `19. REPROVADO` | `19. REPROVADO` |
| `INCOMPLETO` | 551 | `INCOMPLETO` | `INCOMPLETO` |
| `BACEN` | 465 | `20. BACEN` | `20. BACEN` |
| `EM CONTRATO` | 423 | `04. EM CONTRATO` | `04. EM CONTRATO` |
| `ESTEIRA AGIL` | 361 | `13. ESTEIRA AGIL` ⚠ trava §9-T5 | `13. ESTEIRA AGIL` |
| `RESTRIÇÃO` | 201 | `21. RESTRIÇÃO` | `21. RESTRIÇÃO` |
| `PENDENTE C/ RESTRIÇÃO` | 186 | `PENDENTE C/ RESTRIÇÃO` | idem |
| `DISTRATO` | 170 | `17. DISTRATO` | `17. DISTRATO` |
| `QUEDA` | 120 | `18. QUEDA` | `18. QUEDA` |
| `APROVADO POTENCIAL` | 96 | `APROVADO POTENCIAL` | idem |
| `ANÁLISE EXTERNA` | 86 | `ANÁLISE EXTERNA` | idem |
| `VIROU NEGÓCIO` | 81 | `08. VIROU NEGÓCIO` | idem |
| `APROV. TOT. RESTRIÇÃO` | 69 | `APROV. TOT. RESTRIÇÃO` | idem |
| `ANÁLISE P/ VIRAR NEGÓCIO` | 68 | `15. ANÁLISE P/ VIRAR NEGÓCIO` | idem |
| `INTERNALIZADO` | 44 | `15. INTERNALIZADO` | idem |
| `PENDENTE P/ VIRAR NEGÓCIO` | 36 | `14. PENDENTE P/ VIRAR NEGÓCIO` | idem |
| `APROV. COND. RESTRIÇÃO` | 36 | `APROV. COND. RESTRIÇÃO` | idem |
| `APROV. AG. CONT.` | 20 | `07. APROV. AG. CONT.` | idem |
| `RET. ESTEIRA AGIL` | 13 | `RET. ESTEIRA AGIL` ⚠ trava §9-T5 | idem |
| `AG. RET. AGENCIA` | 8 | `11. AG. RET. AGENCIA` | idem |
| `EM PROCESSAMENTO` | 2 | `12. EM PROCESSAMENTO` | idem |
| `RP APROVADO` | 1 | `05. RP APROVADO` | idem |
| `ENVIO DE RP` | 1 | `06. ENVIO DE RP` | idem |
| **`RC EMITIDA`** | 1 | **`RC EMITIDA`** (não existe no catálogo do front) | idem |
| *(vazio)* | 19 | **NULL** | NULL |
| **desconhecido** | — | **gravar cru + logar.** `statusChoices()` (`statuses.ts:79-84`) já garante que um rótulo fora do catálogo aparece no Select em vez de abrir em branco | — |

**A regra do OFF (a mais importante deste documento):**

```
se STATUS = 'OFF':
    se STATUS2 in ('QUEDA','DISTRATO','REPROVADO'):   # 677 negócios
        status_detail = rótulo numerado da tabela acima
        lost_reason   = mesmo rótulo
    senão:                                             # 4.400 negócios
        status_detail = 'OFF'          # <- obrigatório
        lost_reason   = rótulo numerado (preserva a etapa de crédito onde morreu)
```

Sem isso, `encerraSemPerda` (`data.ts:428-431`) devolve `false` e **4.400 negócios OFF entram
no painel como PERDA**. Com isso: `normalizeStatus('OFF') === 'OFF'` → categoria `"fora"`,
que é a semântica do Bubble ("OFF = ignorado", `dealStatus.ts:8`).

Os 3 rótulos de perda ficam com `status_detail` próprio de propósito:
`'18. QUEDA'` e `'17. DISTRATO'` **devem** contar como perda, e `'19. REPROVADO'` é
reconhecido por `isLossStatus` mas devolve `null` em `normalizeStatus` → cai em `"fora"`,
que é o comportamento documentado no próprio código.

### 4.4 `estado_civil` → `deal_clients.marital_status`

40 variantes crus para 6 conceitos. Normalizar (sem acento, maiúscula, sem pontuação) e mapear:

| Alvo | Origens que caem nele | n aprox. |
|---|---|---|
| `SOLTEIRO(A)` | `SOLTEIRO` 2.116 · `SOLTEIRA` 2.004 · `SOLTEIRO(A)` 117 · `SOLTIRO` · `SOLTERIO` · `SOLEIRO` · `SOLTERIRA` · `SOREIRA` · `SOLTGEIRA` · `SOLTEIRA161` | 4.245 |
| `CASADO(A)` | `CASADO` 117 · `CASADA` 51 · `CASADOS` · `CASADO/RS` | 170 |
| `DIVORCIADO(A)` | `DIVORCIADA` 98 · `DIVORCIADO` 51 · `DIVORDICADO` | 150 |
| `UNIÃO ESTÁVEL` | `UNIAO ESTAVEL` 13 · `UNIÃO ESTÁVEL` 5 | 18 |
| `VIÚVO(A)` | `VIUVA` 10 · `VIUVO` 3 | 13 |
| `SEPARADO(A)` | `SEPARADA` 6 · `SEPARADO` 2 | 8 |
| **NULL** | `RS` 2 e qualquer valor não reconhecido | ~2 |

**Gênero é descartado de propósito:** o destino é um campo de estado civil, não de gênero, e
`SOLTEIRO`/`SOLTEIRA` são o mesmo estado. Quem precisar do gênero tem `full_name`.
**Valor desconhecido → NULL + log**, nunca gravar cru: são 40 variantes hoje e viram 60 na
próxima carga se ninguém fechar o vocabulário.

### 4.5 `Funcao` (Users) → `app_role` — *não é deste domínio, mas o rateio depende*

`deal_participants.role` é `text` com `check (role in ('broker','manager','director'))`
(`0006:130`) — **não é o enum `app_role`**. Ele vem do **slot da coluna**, não da `Funcao`:

| Coluna do Bubble | `deal_participants.role` | Ignora a `Funcao` da pessoa? |
|---|---|---|
| `CORRETOR 1/2/3` | `broker` | **Sim** — 176 são DIRETOR e 755 são GERENTE no RH |
| `GERENTE 1`/`GERENTE2`/`GERENTE 3` | `manager` | **Sim** — 3.392 são DIRETOR no RH |
| `Diretor1`/`diretor2` | `director` | 5.086/5.086 são DIRETOR no RH (o único slot coerente) |

A mesma pessoa **pode** ocupar dois papéis no mesmo negócio (duas linhas): o
`unique (deal_id, profile_id, role)` (`0006:136`) permite. Acontece quando `GERENTE 1` e
`Diretor1` são a mesma pessoa. Não deduplicar entre papéis; deduplicar **dentro** do papel.

### 4.6 `Status de lead` → `lead_status` + `lead_funnel_stage`

**Não se aplica a este domínio.** `pipelines` não tem coluna de status de lead — o único
vestígio de lead é `OrigemLead` (5 categorias grossas, 52% preenchida), que vai para
`deals.lead_origin` como texto. A de-para de `lead_status`/`lead_funnel_stage` pertence ao
mapeamento de `leadfies` (`docs/importacao/alvo/leads_alvo.md`).

---

## 5. Resolução de FK por nome de exibição

### 5.1 A função de normalização (uma só, usada em todos os lados)

```python
def T_NOME(s):
    s = (s or "").replace("\xa0", " ")                       # NBSP -> espaço
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))  # remove acento
    return " ".join(s.split()).lower()                       # colapsa espaço, minúscula
```

### 5.2 Pessoa (corretor / gerente / diretor / Creator)

```
1. T_NOME(valor) == T_NOME(Users.colaboradores)   -> profiles.id      # ÚNICO passo automático
2. não achou -> consultar import_bubble_map (de-para curada à mão, §6.3)
3. ainda não achou -> deixar o participante DE FORA e registrar a linha no relatório de carga
```

**Por que só um passo:** `Users.colaboradores` tem **298 valores distintos em 298 linhas —
zero duplicata**, então o casamento é determinístico e não existe desempate a fazer.
Ambiguidade é impossível por construção. Isso é o oposto de `corretors.Nome`, que tem
**12 nomes duplicados** em 365 linhas, e de `Users.Nome_completo`, que resolve 0% de
`CORRETOR 1`.

**Não usar** `corretors` nem `gerentes` como intermediários: eles casam 100% com as colunas
canônicas, mas **não resolvem para `Users` por nome exato** (só 82 de 365 por `Nome_completo`),
então adicionam um salto que só perde informação. Vá direto de `pipelines` para `Users`.

**Cobertura medida (script `fk.py`, 7.568 linhas):**

| Coluna | Preenchida | Resolve | % | Não resolve (linhas / nomes) |
|---|---:|---:|---:|---|
| `CORRETOR 1` | 7.349 | **7.271** | **98,94%** | 78 / 20 |
| `CORRETOR 2` | 849 | 841 | 99,06% | 8 / 5 |
| `CORRETOR 3` | 5 | 5 | 100% | 0 |
| `GERENTE 1` | 7.521 | 7.375 | 98,06% | 146 / **1** (`Zona Sul`) |
| `GERENTE2` | 155 | 151 | 97,42% | 4 / 1 (`Zona Sul`) |
| `GERENTE 3` | 7 | 7 | 100% | 0 |
| `Diretor1` | 5.086 | **5.086** | **100%** | 0 |
| `diretor2` | 73 | 73 | 100% | 0 |
| `Creator` | 7.568 | 6.336 | 83,72% | 1.232 / 2 |

**Negócios sem nenhum corretor resolvível: 279 de 7.568 (3,69%)** — 204 não têm corretor
nenhum no CSV e 75 têm um nome que não resolve.

**Achados que mudam o plano:**
- `Parceiro Externo` **existe** em `Users.colaboradores` com `Funcao=CORRETOR` → resolve
  normalmente, não precisa de perfil sintético.
- `Gerente Interino` **existe** com `Funcao=GERENTE` → idem.
- `Zona Sul` **não existe** — é nome de célula, não de pessoa. 150 linhas (146 + 4).
- `(App admin)` (1.081) e `(deleted thing)` (151) são sentinelas do Bubble → `created_by = NULL`.

**Os 20 nomes de `CORRETOR 1` que não resolvem** (78 linhas), para a curadoria:
`Henrique de Vargas Pacheco` 25 · `Jose Neres da Silva Junior` 12 · `Jessica Fontela da Silva` 8 ·
`Rafael da Silva Porto` 6 · `Prime Imob` 4 · `Melo Imob` 4 · `Alessandro Bueno` 3 ·
`Carla Carvalho` 2 · `Paulo Roberto Antunes de Freitas` 2 · `Larissa Macedo` 2 · e 10 nomes
com 1 linha cada (`Magalhaes`, `stefane`, `CAROL`, `Juca Echer`, `Imob Prime`, …).
Todos constam de `corretors` mas **nenhum virou `User`** — são as 56 fichas órfãs do lote
`(App admin)` de mai/2024 (`perfil/hierarquia.md`, seção (a)).

### 5.3 Negócio (`pipeline` → `deals.id`) — o join mais frágil

`observacaoPipelines.pipeline`, `doc-clientes.pipeline`, `historicoPipes.pipeline`,
`financeiros.pipeline` e `vendas.pipeline` trazem o **nome do cliente**, não o `unique id`:
o export `-modified` renderizou a FK como texto de exibição.

```
1. T_NOME(pipeline) -> índice T_NOME(pipelines.CLIENTE) -> lista de candidatos
2. len(candidatos) == 1  -> resolvido                                    (~97,8% das linhas)
3. len(candidatos)  > 1  -> desempate por janela temporal:
      escolher o negócio cujo intervalo [ENVIO, coalesce(mudou_status, hoje)]
      contém o Creation Date da observação;
      empate persistente -> o negócio com ENVIO mais próximo e ANTERIOR à observação
4. len(candidatos) == 0  -> descartar a linha e logar (0 casos medidos em observacaoPipelines)
```

**Ambiguidade medida:** `pipelines` tem **144 valores de `CLIENTE` repetidos, cobrindo 305
linhas**. Desses, **101 nomes** são citados por observações. Os 4.611 nomes distintos de
`observacaoPipelines` casam **100%** — o problema nunca é "não achou", é "achou dois".

> **Recomendação forte:** pedir novo export de `observacaoPipelines`, `doc-clientes` e
> `historicoPipes` **sem** o sufixo `-modified` (com `unique id` na FK) antes da onda de
> histórico. O desempate por janela temporal é heurística, não fato — e não há como validá-lo
> a partir dos arquivos.

### 5.4 Construtora e empreendimento

```
developer_id: T_NOME(coalesce(CONSTRUTORA2, construtora)) == T_NOME(developers.name)
              regra explícita: 'MAISLAR' -> 'MAIS LAR'   (6 linhas)
              não achou -> NULL + log  (0 casos esperados: 7.546/7.546 casam)

project_id:   (developer_id, T_NOME(EMPREENDIMENTO)) == (developer_id, T_NOME(name))
              não achou -> criar o developer_project (é catálogo derivado, não curado)
              developer_id nulo -> project_id NULL obrigatoriamente (FK escopada)
```

⚠ `developers.name` é `unique` e o `slug` é gerado **só no INSERT** (`0003:42-72`):
renomear a construtora depois **não** regenera o slug. Normalize o nome **antes** da carga.

---

## 6. Idempotência — chave natural por tabela destino

### 6.1 O mecanismo: UUIDv5 determinístico calculado no ETL

`deals` **não tem coluna `external_id`** (conferido em `SCHEMA_ALVO.md:43`; quem tem é
`leads` e `ad_campaigns`). Em vez de criar coluna ou tabela de-para para o que é computável,
derive o próprio `id`:

```python
NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://faceimob.com.br/import/bubble")

def det(entidade: str, *partes: str) -> uuid.UUID:
    return uuid.uuid5(NS, entidade + ":" + ":".join(partes))
```

Zero extensão de banco (`uuid_generate_v5` não é necessária), zero coluna nova, zero lookup,
e a reimportação é `on conflict (id) do nothing` — pura e estável entre execuções.

| Tabela destino | `id` determinístico | Chave natural equivalente | Idempotência |
|---|---|---|---|
| `deals` | `det("pipelines", unique_id)` | `code` (também unique) | `on conflict (id) do nothing` |
| `deal_clients` | `det("deal_clients", unique_id, str(ordinal))` | `unique (deal_id, ordinal)` (`0006:114`) | `on conflict (deal_id, ordinal) do nothing` |
| `deal_participants` | `det("deal_participants", unique_id, role, str(ordinal))` | `unique (deal_id, profile_id, role)` (`0006:136`) | `on conflict (deal_id, profile_id, role) do nothing` |
| `deal_history` | `det("observacaoPipelines", unique_id)` | — (não há unique de negócio) | `on conflict (id) do nothing` — **por isso o id determinístico é obrigatório aqui** |
| `developers` | `det("Construtoras", unique_id)` | `name` **e** `slug`, ambos unique (`0003:20-72`) | `on conflict (name) do nothing` |
| `developer_projects` | `det("empreendimento", developer_slug, nome_normalizado)` | `unique (developer_id, name)` (`0003:92`) | `on conflict (developer_id, name) do nothing` |

### 6.2 `deals.code` — o campo que carrega o rastro visível

```sql
code = 'BUB-' || <unique id do Bubble>     -- ex.: 'BUB-1715462324608x711409717943992300'
```

- `code` é `text not null unique` **sem check de formato** (`0006:27`) — aceita.
- O prefixo `BUB-` **nunca colide** com o `NEG-` da sequence, então **não é preciso rodar
  `setval('public.deal_code_seq', ...)`** depois da carga, e fica auditável o que veio do legado.
- **Não usar prefixo de 13 dígitos do uid:** medi **30 colisões** nos 7.568 registros
  (7.538 prefixos distintos). Tem de ser o uid inteiro.
- **Consequência cosmética:** `code` aparece no assunto do e-mail à construtora
  (`0028:334`: `format('[%s] Documentação - %s', v_deal.code, …)`) e no título das
  notificações (`0028:444,517,544`). Só afeta os 494 negócios abertos — os 7.072 fechados
  não voltam a ser enviados. Alternativa em §8-D6.

### 6.3 `import_bubble_map` — só para o que **não** é computável

O id→id é derivável (§6.1), então a tabela de-para não precisa existir para isso. O que
precisa de memória persistente é a **curadoria humana** de nome→pessoa, que é decisão, não cálculo:

```sql
create table if not exists public.import_bubble_map (
  entity      text not null,        -- 'corretor' | 'gerente' | 'construtora' | 'empreendimento'
  bubble_key  text not null,        -- o nome de exibição cru, ex.: 'Zona Sul'
  target_table text not null,       -- 'profiles' | 'developers'
  target_id   uuid,                 -- NULL = decidido que NÃO tem correspondente
  note        text,
  primary key (entity, bubble_key)
);
```

Popular com as 26 entradas conhecidas: 20 nomes de `CORRETOR 1` + 5 de `CORRETOR 2` +
`Zona Sul`. `target_id = NULL` com `note` é uma decisão registrada ("não é pessoa"), não uma
pendência — e faz a reimportação parar de perguntar a mesma coisa.

---

## 7. Lacunas

### 7.1 Dado da origem sem destino no schema novo

| # | Origem | Volume | Por que não tem destino | Proposta |
|---|---|---|---|---|
| L1 | `Campanha`, `Canal`, `Fonte`, `Criativo Meta`, `Formulário Meta` | 0 preenchidas | Estão vazias no export. `ad_campaigns` existe no destino, mas **não há dado de origem** | Nada a fazer. O vínculo negócio↔campanha só é reconstruível cruzando `leadfies` por telefone (onda 2) |
| L2 | Vínculo negócio → lead | — | `pipelines` não tem uid nem telefone de lead como FK. `deals.lead_id` fica NULL nos 7.568 | Onda 2: casar `pipelines.Contato` (6.402) com `leadfies.Telefone` pelos últimos 8 dígitos. **Teto de 78%** e risco de colisão entre DDDs (medido em `perfil/observacoes.md` §2.4) |
| L3 | Visitas | — | Nenhuma coluna de `pipelines` registra visita. A etapa `visit_scheduled` existe no destino e nasce vazia | `visits` fica sem linha. Não inventar |
| L4 | `financeiros` (plano de pagamento) | 26 linhas / **7 negócios** | **Não existe tabela de plano de pagamento no destino**. `deals` só tem `vgv_gross`/`discount_pct` | Não importar na onda 1. 7 de 7.568 negócios (0,09%). Se o dono quiser, cabe em `deal_history.detail` como jsonb — mas nenhuma tela lê |
| L5 | `vendas` | 6 linhas | Tabela abandonada em 48 h; 5 linhas são cópia degradada de `pipelines` (1 com erro de R$ 140) e 1 é órfã. As 7 colunas de rateio estão 100% vazias | **Descartar integralmente.** Zero perda |
| L6 | Rateio de VGV por participante | 0 preenchidas | As 4 colunas `vgv_corretor_*`/`vgv_gerente_*` estão vazias | O banco calcula 100/n. **Não é lacuna de importação, é lacuna da origem** — não havia rateio desigual a preservar |
| L7 | Diferença bruto × líquido exata | 604 negócios | `discount_pct numeric(5,2)` não representa desconto em R$ | Erro mediano R$ 6,00, máx R$ 20,20. Ver §8-D3 |
| L8 | `statusNumero`, `status_filtro`, `Off`, `compra_conjunto`, `cotistaCCA`, `RefCCHcca`, `gameEsteiraAgilPontuada`, `emiteNota` | 6.520 / 7.566 / 6.942 / 1.204 / 447 / 249 / 1.266 / 4.175 | Redundantes, quebrados ou constantes | **DESCARTAR** com justificativa em §2. Nenhum tem destino porque nenhum tem informação que outra coluna não dê melhor |

### 7.2 Coluna NOT NULL do destino sem origem

| Tabela | Coluna NOT NULL | Origem? | Default proposto |
|---|---|---|---|
| `deals` | `stage_id` (**o único NOT NULL sem default**) | derivado de `STATUS`+`STATUS2` | §4.2. Nunca deixar cair no `incomplete` sem log |
| `deals` | `code` | tem default de sequence | `'BUB-' \|\| unique id` (§6.2) |
| `deals` | `month_base` | `mes` (7.564 de 7.568) | 4 nulos → `month_start(ENVIO)`. ⚠ §9-T2 |
| `deals` | `discount_pct` | `PARC_DESCONTO` (624) | **0** nos 6.944 sem desconto |
| `deals` | `outcome` | `STATUS` | `'open'` nos 2 vazios |
| `deals` | `stage_entered_at` | `mudou_status` (7.567) | 1 nulo → `ENVIO` |
| `deals` | `document_review_status` | — | `'approved'` se `outcome<>'open'`, `'draft'` nos 494 abertos (§8-D5) |
| `deal_clients` | `full_name` | `CLIENTE` (7.552) | 16 nulos → `'(sem nome — Bubble ' \|\| unique id \|\| ')'` |
| `deal_clients` | `has_informal_income` | `rendaInformal` (483) | **false** nos 7.085 restantes |
| `deal_clients` | `ordinal` | posição do bloco | 1 ou 2, sempre explícito |
| `deal_participants` | `role` | slot da coluna | sempre explícito |
| `deal_participants` | `ordinal` | slot da coluna | **1/2/3 sempre explícito.** O default é 1 e **não há unique em `(deal_id, role, ordinal)`** — três brokers sem ordinal reintroduzem o bug que a `0025` consertou |
| `deal_participants` | `share_pct` | — | **não enviar** (default 0, sobrescrito pelo recalc) |
| `deal_history` | `kind` | — | `'comment'` constante |
| `developers` | `name` | catálogo Construtoras | — |
| `developers` | `slug` | — | **gerado por trigger** `developers_ensure_slug` (`0003:70-72`). Não enviar |
| `developer_projects` | `name` | `EMPREENDIMENTO` | normalizado, CAIXA ALTA |

---

## 8. Decisões que só o dono do negócio pode tomar

| # | Pergunta | Opções e consequências | Recomendação |
|---|---|---|---|
| **D1** | **Importar os 7.568 negócios ou só os que têm valor?** | **(a) Tudo (7.568):** histórico completo, base do painel de perdas e do esforço por corretor. **(b) Só com VGV > 0 + abertos (2.146 + 494 = 2.640):** 65% menos linhas, mas perde 4.928 negócios OFF — some o denominador de toda taxa de conversão. **Não há histórico antigo a cortar:** a base inteira cabe em 28 meses (mai/2024 a set/2026) | **(a).** 7.568 linhas é volume trivial e o corte não economiza risco nenhum |
| **D2** | **`DISTRATO` conta como perda no painel?** | **(a) `outcome='lost'` + `status_detail='17. DISTRATO'`:** os 158 distratos entram em `perdaIds` e a regra "só conta se houve venda anterior do mesmo cliente" (`data.ts:471-489`) roda. **(b) `outcome='cancelled'`:** `dealCategory` devolve `"fora"` e os 158 somem de todos os indicadores | **(a)** — é o que o código do painel claramente espera |
| **D3** | **Preservar o VGV bruto ou o líquido?** (não dá os dois) | **(a) bruto + `discount_pct` calculado:** líquido erra até R$ 20,20 (mediana R$ 6,00) em 604 negócios; R$ 4 mil sobre R$ 465,2 mi. **(b) `vgv_gross = VGV LIQUIDO`, `discount_pct = 0`:** líquido exato, **o desconto de R$ 12,6 mi desaparece** e o bruto vira o líquido. **(c) bruto com `discount_pct = 0`:** infla o VGV em R$ 12,6 mi | **(a).** O bruto é o número auditado; 0,0008% de deriva no líquido é menos grave que perder o desconto |
| **D4** | **Os 4.400 negócios OFF viram `status_detail='OFF'`, perdendo o rótulo de crédito no Select?** | **(a) `status_detail='OFF'` + rótulo em `lost_reason`:** painel correto, rótulo preservado mas fora do Select. **(b) rótulo no `status_detail`:** o Select mostra a etapa de crédito e **o painel ganha 4.400 perdas falsas** | **(a)** |
| **D5** | **Marcar `document_review_status='approved'` sem conferência ter existido?** | **(a) `approved` só nos 7.072 fechados, `draft` nos 494 abertos:** afirma conferência inexistente só onde ninguém mais vai mexer; nos vivos o gerente faz a conferência de verdade antes de avançar. **(b) `approved` em tudo:** operação flui no dia 1, mas 494 negócios entram com uma conferência que não aconteceu. **(c) `draft` em tudo:** honesto, mas 7.072 negócios históricos travam no primeiro UPDATE de etapa | **(a)** |
| **D6** | **`deals.code` fica `BUB-<uid>` (36 chars) ou vira `BUB-000001` sequencial?** | **(a) `BUB-<uid>`:** idempotente sem lookup, auditável, **feio no assunto do e-mail à construtora** dos 494 negócios abertos. **(b) sequencial:** bonito, mas a reimportação precisa ler o código já gravado para não renumerar | **(a)**, e se incomodar, renomear só os 494 abertos depois da carga |
| **D7** | **Fechar a temporada do jogo antes da carga ou limpar `game_events` depois?** | Ver §9-T1. **(a) desligar os triggers de pontuação:** cirúrgico, exige dono da tabela. **(b) fechar a temporada antes:** congela `game_season_results` e **grava uma notificação `game_paused` por corretor**. **(c) deixar pontuar e limpar:** 1.837 vendas × 600 pontos entram na temporada de hoje e cada `INSERT` em `game_events` **toca a fanfarra em toda tela aberta** (realtime, `EngagementLayer.tsx:272-300`) | **(a)** |
| **D8** | **Reexportar do Bubble sem `-modified` antes da onda de histórico?** | **(a) reexportar:** as FKs voltam como `unique id` e as **101 ambiguidades de nome somem**. **(b) importar por nome com desempate temporal:** heurística não validável; até 305 linhas podem ir para o negócio errado | **(a)** para `observacaoPipelines`, `doc-clientes` e `historicoPipes`. A onda 1 (deals/clients/participants) **não depende disso** e pode ir agora |
| **D9** | **Fuso horário: `America/Sao_Paulo` ou UTC?** | O arquivo não declara. Se o Bubble exportou em UTC, todos os horários estão 3 h adiantados e **~4% dos registros mudam de dia** (e de mês, na virada). Confirmável em 5 minutos: abrir um negócio conhecido no Bubble e comparar o `Creation Date` com o CSV | **Confirmar antes de rodar.** É a única suposição deste documento que não dá para verificar nos arquivos |

---

## 9. Travas operacionais da carga (checklist executável)

Ordem literal. Cada item cita a evidência.

**T0 — Antes de tudo**
```sql
-- 1. Travar a operação (as DUAS travas, não uma só)
select cron.alter_job(jobid, active := false) from cron.job where jobname like 'faceimob-%';
update public.automation_settings set leads_paused = true;
-- 2. Conferir que nenhum mês da carga está fechado
select period from public.closed_months order by 1;   -- esperado: vazio em banco novo
```

**T1 — Gamificação (a mais cara).** `deals_award_points` dispara em **INSERT** desde a 0060
(`0060:296-311,341-343`) e `deal_participants_award_points` em cada broker de negócio `won`
(`0060:348-376`). Sem desligar: **1.837 vendas × 600 pontos** entram na temporada aberta hoje,
com `occurred_at = now()`, e cada INSERT em `game_events` (que está na publication realtime,
`0020:47`) dispara a animação de venda em toda tela aberta.

**T2 — `month_base` é sobrescrito.** `deals_default_month_base` (`0032:60-70`) troca o valor
quando ele é NULL **ou igual a `month_start(current_date)`**. Medido: **411 negócios têm
`mes` = 2026-09**, que é o mês corrente — todos seriam reescritos com o mês da temporada
aberta. Também há **186 negócios com `mes` no futuro** (2026-10: 150 · 2026-11: 28 ·
2026-12: 7 · 2027-02: 1, esta última erro de digitação). Desligar o trigger durante a carga
é a única forma de o `month_base` do legado sobreviver.

**T3 — `deals_guard_closed_month`.** BEFORE INSERT **e** UPDATE (`0010:51-53`), e a única
saída é `is_admin()`, que lê `auth.uid()` — **`service_role` não fura trigger**. Em banco
com mês fechado, use `set_config('request.jwt.claims', ...)` como em
`tests/02_business_rules.sql:432-434`.

**T4 — `deals_add_creator_participant` cria participante que você não pediu.**
`coalesce(new.created_by, auth.uid())` (`0053:104`), retorna cedo só quando `lead_id` não é
nulo — e o nosso `lead_id` é sempre NULL. Medido: **`Creator` difere de `CORRETOR 1` em
2.935 negócios, e em 522 deles o `Creator` tem `Funcao=CORRETOR`** → 522 corretores espúrios
entrariam no rateio, mudando o 100/n de cada um desses negócios.

**T5 — `deals_guard_esteira_label`.** Recusa `13. ESTEIRA AGIL` e `RET. ESTEIRA AGIL` no
INSERT (`0037:40-70`) — **374 negócios**. Escapam `postgres` e `service_role` por
`current_user`, então a carga por psql **ou** por PostgREST com service_role passa. **Não**
tornar o trigger `security definer` para contornar (`0051:22-27` explica que isso mata a trava).

**T6 — `deal_participants_autofill` (`0058:81-117`).** Inserir um `broker` puxa
`manager_id`/`director_id` da equipe **atual** do corretor e insere duas linhas com
`ordinal` default **1**. Como já vamos inserir o gerente histórico em `ordinal=1`, o
resultado é **dois managers no ordinal 1** — exatamente o bug que a `0025` consertou.

```sql
begin;

alter table public.deals             disable trigger deals_award_points;
alter table public.deals             disable trigger deals_default_month_base;   -- T2
alter table public.deals             disable trigger deals_add_creator_participant; -- T4
alter table public.deal_participants disable trigger deal_participants_award_points;
alter table public.deal_participants disable trigger deal_participants_autofill;  -- T6
-- MANTER LIGADO: deal_participants_resplit (é ele que calcula o 100/n que queremos)

--  ... carga na ordem do §1 ...

alter table public.deal_participants enable trigger deal_participants_autofill;
alter table public.deal_participants enable trigger deal_participants_award_points;
alter table public.deals             enable trigger deals_add_creator_participant;
alter table public.deals             enable trigger deals_default_month_base;
alter table public.deals             enable trigger deals_award_points;

commit;
```
`disable trigger` exige ser **dono** da tabela: funciona por psql/migration como `postgres`,
**não** por PostgREST com `service_role`. Se a carga for por API, a saída é limpar
`game_events` depois (`delete from public.game_events where ref_type='deal' and ref_id in (...)`).

**Conferências obrigatórias pós-carga:**
```sql
-- 1. rateio fecha 100 em todo negócio com corretor
select deal_id, sum(share_pct) from public.deal_participants
 where role='broker' group by 1 having sum(share_pct) <> 100;              -- esperado: 0 linhas

-- 2. nenhum negócio invisível (sem participante ninguém enxerga, exceto admin/diretor/CCA)
select count(*) from public.deals d
 where not exists (select 1 from public.deal_participants p where p.deal_id = d.id);
                                                                           -- esperado: 279

-- 3. ordinal duplicado dentro do mesmo papel (o bug da 0025)
select deal_id, role, ordinal, count(*) from public.deal_participants
 group by 1,2,3 having count(*) > 1;                                       -- esperado: 0 linhas

-- 4. month_base sobreviveu ao trigger
select count(*) from public.deals where code like 'BUB-%' and month_base = date_trunc('month', current_date);
                                                                           -- esperado: 411

-- 5. nenhum ponto de jogo nasceu da carga
select count(*) from public.game_events where occurred_at::date = current_date;  -- esperado: 0

-- 6. VGV total confere com a origem
select round(sum(vgv_gross),2) from public.deals where code like 'BUB-%';  -- esperado: 465211260.70
select round(sum(vgv_gross),2) from public.deals where code like 'BUB-%' and outcome='won';
                                                                           -- esperado: 398105909.06
```

**Limpeza obrigatória antes de religar os crons** (`operacao_alvo.md`):
```sql
update public.notifications set sent_at = now(), last_error = 'descartada: carga de dados legados'
 where channel <> 'in_app' and sent_at is null and created_at >= :inicio_da_carga;
```
E lembrar: `npm run db:reset` **religa** `faceimob-notify-dispatch` incondicionalmente
(`0065:462-479`) — repor a pausa depois de qualquer reset.

---

## 10. Volume estimado por tabela destino

| Tabela destino | Linhas (onda 1 completa) | Origem | Como cheguei |
|---|---:|---|---|
| `developers` | **41** (32 realmente usadas) | catálogo Construtoras | 41 registros; 11 nunca aparecem em negócio |
| `developer_projects` | **635** | `(CONSTRUTORA2, EMPREENDIMENTO)` | pares distintos após T-NOME (745 sem normalizar, 635 com) |
| `deals` | **7.568** | `pipelines` | 1:1, `unique id` sem duplicata |
| `deal_clients` | **7.904** | `pipelines` | 7.552 `ordinal=1` + 352 `ordinal=2` |
| `deal_participants` | **20.722** | `pipelines` | 8.110 broker + 7.490 manager + 5.122 director (só nomes resolvidos) |
| `deal_history` | **24.551** | `observacaoPipelines` | 24.766 − 172 vazias − 43 duplicatas exatas |
| `pipeline_stages` | **0** | — | já semeadas (9), `supabase/seed.sql:11-22` |
| `visits` | **0** | — | sem origem (L3) |
| `developer_submissions` | **0** | — | sem origem |
| `closed_months` / `month_reopenings` | **0** | — | fechamento é decisão operacional, não dado migrado |
| **TOTAL do domínio** | **~61.421 linhas** | | |

**Se o dono escolher a onda enxuta (D1-b):** `deals` 2.640 · `deal_clients` ~2.750 ·
`deal_participants` ~7.200 · `deal_history` ~12.542 (as observações de negócios
`VENDA`/`PROPOSTA`/`DISTRATO`) ≈ **25.100 linhas**.

Fora do meu domínio, mas dependem desta carga: `cca_cases` (~7.500, um por negócio com
esteira), `deal_documents` (via `doc` 2.857 + `documentos` 4.330 → até 29.447 arquivos),
`game_events` (1.436 vínculos).

---

## 11. Suposições que mudam o resultado

| # | Suposição | Impacto se estiver errada | Como confirmar |
|---|---|---|---|
| S1 | **Fuso `America/Sao_Paulo`** nas datas do Bubble | Se for UTC, todos os horários deslocam 3 h e ~4% dos registros mudam de dia — inclusive `mudou_status`, que vira `closed_at` | Abrir um negócio conhecido no Bubble e comparar com o CSV. **5 minutos, e não dá para decidir pelos arquivos** |
| S2 | Telefone de 9 dígitos (43 linhas) é **celular sem DDD** → prefixar `51` | 43 telefones errados em `deal_clients.phone`. Alternativa conservadora: gravar NULL | Amostragem manual |
| S3 | As 17 colunas 100% vazias **estão vazias no Bubble**, não foram suprimidas pelo export | Se foram suprimidas, o rateio real (`vgv_corretor_*`) existe e a decisão 5 do §0 muda | Só existe o export `-modified`, sem contraparte crua para comparar. **Perguntar ao Bubble** |
| S4 | `Users.colaboradores` é a chave de exibição de **todos** os campos de pessoa | Já validado: 5 colunas de 7 resolvem ≥98% e `Diretor1` resolve 100%. Risco residual baixo | Medido em `fk.py` |
| S5 | Desempate temporal para os 101 nomes ambíguos de negócio | Até 305 linhas de observação podem ir para o negócio errado | Só resolve com reexport sem `-modified` (D8) |
| S6 | `mudou_status` é data válida de fechamento | **2.039 linhas (27%) trazem `Sep 18, 2024`** — carimbo da migração do Bubble, não a data real. Nesses casos `closed_at` é ficção plausível, não fato | Não há como recuperar a data verdadeira a partir do export |

---

## 12. O que não consegui responder

1. **A regra de rateio do legado.** As 4 colunas de rateio estão 100% vazias. Não dá para
   saber se o Bubble dividia igualmente entre dois corretores ou de outro jeito. O banco novo
   impõe 100/n — se a regra antiga era outra, o histórico fica reescrito e ninguém consegue
   provar por qual número.
2. **Se as 143 `CLIENTE` repetidas são recompra ou lançamento duplicado.** 25 pares repetem
   também empreendimento e unidade — esses são suspeitos de duplicidade real, mas só o
   operador sabe.
3. **A quem pertencem os 279 negócios sem corretor resolvível.** 204 não têm corretor no CSV;
   75 apontam para nomes que nunca viraram usuário. Sem participante, ficam **invisíveis para
   quem não é admin/diretor/sócio/CCA** (`can_see_deal`, `0006:578-591`).
4. **Se `Zona Sul` (150 negócios) deve virar perfil sintético ou ficar sem gerente.** É nome
   de célula, não de pessoa, e não existe em `Users`.
