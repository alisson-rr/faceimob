# Refutação — domínio **Leads**, lente **dados**

**Alvo:** `docs/importacao/mapa/leads.md`
**Método:** parser CSV real (módulo `csv` do Python 3.12, streaming), `xxd` para bytes, `sed`/`grep` nas migrations.
**Fontes lidas:** `DOCUMENTOS/DADOS_BUBBLE/export_All-leadfies-modified--_2026-09-08_19-40-11.csv`,
`export_All-ligacoes_2026-09-08_19-41-06.csv`, `export_All-Users-modified--_2026-09-08_19-44-45.csv`,
`supabase/migrations/20260725120000_0001_foundation.sql`, `20260725120400_0005_leads.sql`.
**Nenhum arquivo do repo foi alterado além deste. Nenhuma consulta ao banco.**
**Data:** 09/09/2026.

**Veredito: REFUTADO.** O mapa erra na regra que decide `lost` × `discarded` — a mais consequente do domínio,
porque `lost` conta como perda no funil e `discarded` não. Erra também nos volumes de `Atividade` e `Grupo`.
A espinha dorsal (chaves, constraints, formato de data, telefone, resolução de corretor) resistiu à checagem.

---

## 1. Achado bloqueante — §4.1/§4.3/§9: a regra escrita e o número publicado se contradizem

**O que o mapa diz.** §4.1, nota de rodapé ¹:

> motivo de descarte = a célula contém `Lead duplicado`, `Lead Teste` ou `Contato Inválido`

e a linha da tabela `Arquivado` **com** motivo de descarte → **1.044** leads → `discarded`.
§4.3 reforça listando os três sob "Grupo A — descarte … 1.044 leads", com `Contato Inválido` = 4.063 ocorrências.

**Contradição aritmética visível no próprio documento:** 4.063 + 1.010 + 34 = **5.107 ocorrências**
não cabem em 1.044 leads. Seriam 4,9 motivos de descarte por lead, e o próprio §4.3 diz que só 2 leads
no arquivo inteiro têm 8 motivos e 32.339 têm apenas 1.

**Medição (`scratchpad/p10.py`, sobre os 36.265 leads `Arquivado`):**

| Conjunto de motivos usado | Leads |
|---|---:|
| contém `Lead duplicado` **ou** `Lead Teste` (sem `Contato Inválido`) | **1.044** |
| contém `Contato Inválido` | 4.063 |
| **contém qualquer um dos três — a regra que o §4.1 escreveu** | **5.105** |
| todos os motivos são de descarte | 4.784 |

O número 1.044 foi medido **sem** `Contato Inválido`. A regra escrita **inclui** `Contato Inválido`.
Quem implementar o documento ao pé da letra produz **5.105 `discarded`**, não 1.044.

**Efeito em cadeia — as três linhas de `Arquivado` do §4.1 estão erradas** (`p6.py`, `p11.py`).
Aplicando *as regras como estão escritas* (inclusive a de §4.3: remover o Grupo C antes; se a célula esvaziar,
cai em "Arquivado sem motivo"):

| Linha do §4.1 | Mapa | Medido | Δ |
|---|---:|---:|---:|
| `Arquivado` **com** motivo de descarte → `discarded` | 1.044 | **5.105** | +4.061 |
| `Arquivado` com outro motivo → `lost` | 34.226 | **29.250** | −4.976 |
| `Arquivado` **sem** motivo → `lost` | 995 | **1.910** | +915 |
| soma | 36.265 | 36.265 | ✓ |

Os 995 são exatamente os leads cuja célula `Motivos de perda` já vinha vazia. Faltam os **915** cuja célula
continha **só** valores do Grupo C (`Em atendimento`, `Retornar para cliente`, …) e que o §4.3 manda esvaziar.
O documento escreveu a regra e não a aplicou na contagem.

**Consequência real.** 4.061 leads mudam de lado no funil. `lost` entra em relatório de perda,
`discarded` não (§8, D6 é decidida pelo dono com base em "1.044 × 35.221" — o número verdadeiro é
"5.105 × 31.160", 5× maior). Pior: a constraint `leads_lost_consistency`
(`(status='lost') = (lost_at is not null)`, confirmada em `20260725120400_0005_leads.sql:78-79`) faz o lote
**falhar em bloco** se o script preencher `lost_at` guiado pela contagem errada. E a verificação pós-carga do
§10 vira alarme falso: quem espera 1.044 `discarded` e vê 5.105 conclui que o import quebrou.

**Correção (uma linha em cada lugar):** decidir qual regra vale.

- Se `Contato Inválido` **é** descarte (o que a lista do §4.3 afirma): trocar 1.044 → **5.105**,
  34.226 → **29.250**, 995 → **1.910**; §4.3 Grupo A passa a somar 5.107 ocorrências; §9 opção A:
  `discarded` 1.763 → **5.824**, `lost` 35.221 → **31.160**.
- Se `Contato Inválido` **não** é descarte: removê-lo do Grupo A e da nota ¹, e mover suas 4.063 ocorrências
  para o Grupo B — aí 1.044 fica de pé, mas 995 continua errado (é 1.910).

---

## 2. Demais achados (ordem de gravidade)

### 2.1 §4.2 — `Atividade`: cauda subestimada em 2,6× e a tabela não fecha com N (**alta**)

Mapa: *"12 valores cobrem 102.079 dos 102.799 (99,3%); a cauda são 175 valores … somando 360 leads"*,
e `Em Análise de Crédito` = 26.

Medido (`p5.py`, chave `canon` do próprio §5.1):

| | Mapa | Medido |
|---|---:|---:|
| 12 valores nomeados | — | **100.589** |
| 12 nomeados + vazio | 102.079 | **101.847** |
| cauda (valores distintos) | 175 | **191** |
| cauda (leads) | 360 | **952** |
| `Em Análise de Crédito` | 26 | **31** |

A tabela do §4.2 soma 101.842 + 360 = **102.202**, e não os 102.799 do arquivo: faltam **597 leads**.
As outras 11 contagens batem na unidade. Impacto: 592 leads a mais caem na regra
"cauda → `funnel_stage='new'`" — não quebra constraint, mas invalida a linha da tabela e o "99,3%".
(O 102.079 é, na verdade, quantos leads têm `Mês` coerente com `Criado em` — parece número trocado de lugar.)

### 2.2 §4.5 e §9 — `Grupo`: soma 4.898 leads a mais do que existe e conta um grupo a menos (**alta**)

Mapa: *"49 valores, incluindo vazio"*; *"os **46 restantes** … 20.406"*.

Medido (`p3.py`): **50** valores canônicos (49 + vazio). A lista entre parênteses do §4.5 tem **47** rótulos,
não 46 — e a soma real deles é **15.508**, não 20.406.
Prova pela conta que fecha: 69.919 (`Roleta Geral`) + 12.687 (vazio) + 4.685 (`ChatBot`) + **15.508** = **102.799** ✓.
Com 20.406 daria 107.697, ou seja, 4.898 leads inexistentes.
Consequência: §9 promete `distribution_groups` **+47**; o correto é **+48** (47 rótulos legados + `chatbot`,
com `Roleta Geral` reusando `fila-geral`).

### 2.3 §5.4 — o par "100.342 válidos / 2.357 inválidos" não fecha (**média**)

Medido (`p7.py`, exatamente o algoritmo do §5.4 com os 67 DDDs oficiais):
**100.342 válidos · 2.352 inválidos · 105 vazios · soma 102.799** ✓, e 100.342 + 2.352 = 102.694 = fill de `Telefone` ✓.

O mapa cita 100.342 (checagem própria) **e** 2.357 na mesma frase: 100.342 + 2.357 = 102.699, cinco a mais do que
o preenchimento da coluna. O par (100.337 / 2.357) do perfil é coerente; o par publicado mistura duas rodadas.
Baixo impacto operacional (a regra é por linha, não por contagem), mas é número que não pode ser conferido.

### 2.4 §3, linha 24 — `Mês` "bate 101.580/101.580" é meia verdade (**baixa**)

Medido (`p6.py`): das 102.798 linhas com `Mês` e `Criado em` parseáveis, **102.079 batem e 719 divergem** —
exatamente o lote Instagram, cujo `Criado em` está em formato en-US. A afirmação vale só para o subconjunto
`dd/mm/aa`; escrita como está sugere cobertura total. Não muda regra de transformação (`Mês` é descartada).

### 2.5 §9 — volumes do corte de 12 meses não reproduzem (**média, dependente de §1**)

Reproduzindo o critério declarado (`Data atividade`, fallback `Criado em`, ≥ 09/09/2025):

| | Mapa | Medido |
|---|---:|---:|
| `leads` | 41.367 | **40.852** |
| `in_progress` | 27.477 | **27.239** |
| `lost` | 13.633 | **11.898** |
| `discarded` | 247 | **1.705** |
| `converted` | 10 | **10** |

O `discarded` = 247 é impossível sob a regra escrita no §4.1 (§1 acima). Os outros deltas (≈1,2%) podem vir de
o autor ter usado outra data de referência — o documento não diz qual — e **essa omissão já é um defeito**:
o corte é a decisão D1 e não é reproduzível a partir do texto.

---

## 3. O que resistiu à checagem (não mexer)

Rodado e confirmado na unidade:

- **Forma do arquivo** (`p1.py`): 102.799 registros, 42 colunas, `unique id` com 102.799 valores distintos e
  **zero repetição** — a chave de idempotência do §6 é sólida.
- **Todos os 42 `fill%` do §3** batem na segunda casa decimal, incluindo as colunas 100% vazias
  (`Data Criação`, `Data_atividade`, `data_criacao`, `Preço`, `Reavivado_em`, `Reavivar_em`, `Slug`).
- **Encoding** (`xxd` + `p2.py`): o header é UTF-8 válido (`43 c3 b3 64 69 67 6f` = `Código`) com **0** U+FFFD;
  o corpo tem **337.879** U+FFFD — o número publicado, exato. O arquivo decodifica em UTF-8 estrito.
- **§4.1 `Status`** (`p5.py`): 4 valores canônicos + vazio, todas as contagens exatas
  (64.885 · 36.265 · 871 · 59 · 719); 6 valores brutos não vazios → 4 canônicos ✓;
  `Negócio fechado` = 43 correto + 16 mojibake = 59 ✓; `Em negociação` = 63.788 mojibake + 1.097 correto ✓.
- **§4.4 `Fonte`** (`p3.py`): 14 valores + vazio, **as 15 contagens batem na unidade**.
- **§4.3 volumetria** (`p3.py`): 39.541 ocorrências em 35.550 leads, 24 valores distintos,
  32.339 células com 1 motivo, máximo 8 — tudo exato, inclusive as 24 contagens individuais.
  (O defeito do §1 é de *classificação*, não de contagem de motivo.)
- **§0 risco 2** (`p6.py`): `Primeiro contato` com status vivo = **17.153**, o número publicado. O risco é real.
- **§5.3 datas** (`p6.py`): `Criado em` = 101.580 em `dd/mm/aa HH:MM` + 719 en-US + 499 em `aaaa/mm/dd HH:MM`
  + **1 vazio** (o "1 não parseável" do mapa) ✓; `Data atividade` = 100.670 em `dd/mm/aa HH:MM:SS`,
  **2.129 vazias**, **0 falhas** ✓; máxima = **18/09/2026 11:30**, coerente com "49 no futuro até 18/09/2026".
- **§5.2 escada de nomes** (`p8.py`, contra os 298 registros de `Users`): regra 1 (igualdade exata contra
  `colaboradores`) = **95.287** leads — o número publicado, exato. `Nome_completo` casa 46.390 (mapa: 46.374;
  diferença de 16 por variação de normalização, irrelevante para a conclusão). `Corretor` vazio = **1**,
  o que valida o denominador 102.798. Restam 7.511 leads em 42 nomes após a regra 1, e a escada declara recuperar
  4.007 nas regras 2-4, deixando 3.504 — a lista nominal de 22 chaves do §5.2 soma exatamente 3.504.
- **§5.5 `ligacoes`** (`p9.py`): 8.365 linhas, 6 colunas, **sem `unique id`**, `Slug` 100% vazia,
  `Modified Date` idêntica a `Creation Date` em **8.365/8.365**, **40** creators distintos — todos os fatos do §5.5.
- **Migrations citadas** (`sed` em `20260725120400_0005_leads.sql` e `20260725120000_0001_foundation.sql`):
  `status lead_status not null default 'queued'` ✓ · `leads_lost_consistency check ((status='lost') = (lost_at is not null))` ✓ ·
  `leads_assigned_consistency` cobre só `assigned`/`attending` (por isso `in_progress` aceita `assigned_to` NULL) ✓ ·
  `leads_normalize` faz `new.phone := normalize_phone(coalesce(new.phone, new.phone_raw))` ✓ ·
  `normalize_phone` devolve o lixo cru no `else` ✓ · `leads_external_id_idx` unique parcial ✓.

---

## 4. O que ainda não foi provado

- As regras 2 e 3 da escada do §5.2 (regex de mojibake e primeiro/último token) **não foram reimplementadas**.
  A cobertura de 96,59% é internamente coerente (95.287 + 279 + 3.728 = 99.294; 7.511 − 4.007 = 3.504),
  mas depende de código que não está no documento. Nomes de alto volume que sobram da regra 1 e que a regra 3
  precisa capturar sem ambiguidade: `everton goncalves da silva` (1.642), `fabiano rodrigues vieira` (918),
  `isaias ribeiro luca` (403), `roberto santos mendes` (322). Note que `roberto santos mendes` e
  `melissa santos mendes` (1 lead, na lista de "não encontrados") compartilham o último token — é onde a
  regra 3 pode gerar a ambiguidade que o mapa afirma não existir ("zero ambiguidades reais").
- A cobertura de 76,8% do §5.5 (`ligacoes` → lead por últimos 8 dígitos) não foi recalculada.
- Os 14.005 telefones duplicados do §8/D2 não foram recontados.

---

*Dados pessoais não aparecem neste relatório: só contagens e chaves normalizadas de nome já públicas no mapa.
A coluna `senha_temporaria` de `Users` foi lida apenas como nome de coluna; nenhum valor foi acessado,
exibido ou copiado.*
