# Refutação — `mapa/catalogo.md` pela lente **integridade**

Data: 09/09/2026 · Escopo: só leitura de arquivos (nenhum comando contra o banco, nenhum arquivo de código
alterado). Todos os números saem de scripts `csv.DictReader` no scratchpad da sessão (`r1.py`…`r12.py`) e de
`grep`/`sed` nas migrations e no `src/`. Os comandos estão na §10.

**Veredito: REFUTADO.** A aritmética do mapa é boa — reproduzi 41 / 633 / 625 / 8 placeholders / 7.568 /
102.799 / 104 campanhas / 34.333 leads / os 8 `active=false` linha a linha. O que não se sustenta é a
**mecânica de integridade em três pontos**:

1. **§4.8 afirma "335 valores distintos, sem colisão" para `external_id = 'bubble:' + slugify(Imóvel)`.
   É falso: 335 nomes produzem 321 slugs — 14 colisões contra um índice `unique` global (`0067`).**
2. O arquivo `leadfies` tem **337.879 caracteres U+FFFD** (acentos destruídos no próprio export). O mapa
   documenta o NBSP de `pipelines` e **não registra essa corrupção**, embora cite valores acentuados
   (`Indicação`, `Não definido`) que **não existem byte a byte** no arquivo.
3. A linha de base da §11 é internamente contraditória: assume que o seed rodou para `lead_sources`
   (6 códigos) e que **não** rodou para `developers` (esperado 41). Com `npm run db:seed:remote` os números
   corretos são **43** e **629**.

---

## 0. O que foi confirmado (para não jogar fora o que está certo)

| afirmação do mapa | medido | resultado |
|---|---|---|
| `Construtoras` 19-37-19: 41 registros, 13 colunas | idem | ok |
| 41 `unique id`, 41 nomes, 41 slugs, 41 chaves `norm2` — zero colisão | 41/41/41/41 | ok |
| snapshot irmão 19-36-44 difere só em `agil_qtd` (2 linhas) e `Modified Date` (18) | idem | ok |
| `CCA`: 16 Faceimob / 22 Externo / 3 vazio · `Creator`: 40 + 1 `(App admin)` · `Slug` 0/41 | idem | ok |
| `pipelines`: 7.568 registros, 110 colunas | idem | ok |
| 17 sem construtora · 39 sem empreendimento · 2 com empreendimento e sem construtora | idem | ok |
| `COALESCE(CONSTRUTORA2, construtora)` + `norm2` → 7.551 resolvem, **0 órfãos**, 34 valores distintos | idem | ok |
| 633 pares `(construtora, norm(EMPREENDIMENTO))` · 90 pares com >1 grafia · 8 placeholders · **625** | idem | ok |
| agrupar pela construtora **bruta** ou pelo **developer resolvido** dá o mesmo 633 (o `norm2` não funde grupos) | 633 = 633 | ok |
| a variante mais frequente escolhida não colide em `(developer_id, name)` | 0 colisões | ok |
| `OrigemLead`: 3.601 / 2.832 / 576 / 359 (`Lead\xa0Indica\xe7\xe3o`, NBSP real) / 166 / 34 | idem | ok |
| `leadfies`: 102.799 leads, `Fonte` 14 distintos + 43 vazios; as 14 contagens somam 102.756 | idem | ok |
| `Imóvel`: 335 distintos, 94.455 leads com valor | idem | ok |
| §6.3 com fronteira de palavra: **104** campanhas / **34.333** leads / **18** construtoras | idem | ok |
| tabela de `active` da §4.1: as 8 zeradas são ADITAR, CNT, DALLASANTA, ELIOWINTER, LOTTICCI, PARADIS, RPM, SOLV | idem | ok |
| `links` 3 · `dicadeouros` 10 · `mensagemdodias` 18; `unique id` distintos; 100% das datas parseiam | idem | ok |
| as 3 URLs são distintas depois de `lower(rstrip('/'))`, e essa é a regra do front | `Links.tsx:41` | ok |
| nenhuma das 18 mensagens compartilha o mesmo minuto (o `ends_at` encadeado não vira `ends_at == starts_at`) | menor delta 1 min | ok |
| `developers_ensure_slug` é `before insert` e respeita slug explícito; `set_updated_at` é `before update` | `0003:44-71` | ok |
| `ad_campaigns.external_id` tem `unique` **global** | `0067:27-28` | ok (e é o que quebra a §4.8) |

O problema não é contagem nem casamento de construtora. É **chave**, **encoding** e **linha de base**.

---

## 1. ALTA — `external_id = 'bubble:' + slugify(Imóvel)` **colide**: 335 nomes viram 321 chaves

### 1.1 A afirmação

§4.8, linha de `ad_campaigns.external_id`:

> **sintético**: `'bubble:' + slugify(Imóvel)` — **335 valores distintos, sem colisão**

E `0067:27-28` cria `create unique index ad_campaigns_external_id_key on public.ad_campaigns (external_id);` —
unique **global**, escrito exatamente para impedir que um lead case com duas campanhas.

### 1.2 A medição (`r12.py`)

Aplicando o `slugify` da §2 do próprio mapa (réplica de `public.slugify`, `0001:171-182`) aos 335 valores:

```
Imovel distintos: 335        external_id distintos: 321        COLISOES: 14
linhas perdidas/abortadas: 14     leads envolvidos: 8.816
```

As 14, com os leads de cada variante:

| `external_id` gerado | variantes que colidem | leads |
|---|---|---:|
| `bubble:casa-ou-ap` | `Casa ou Ap?` (2.082) · `Casa ou AP` (2.438) | **4.520** |
| `bubble:vasco-casas-regi-o-metrop` | `Vasco \| Casas Regi<FFFD>o Metrop.` (2.810) · `… Metrop` (47) | 2.857 |
| `bubble:vasco-casas-regiao-metrop` | `Vasco \| Casas Região Metrop.` (589) · `… Metrop` (17) | 606 |
| `bubble:feir-o-faceimob-2025` | `Feir<FFFD>o Faceimob 2025` (166) · `Feir<FFFD>o \| Faceimob 2025` (379) | 545 |
| `bubble:garda` | `GARDA` (144) · `Garda` (1) | 145 |
| `bubble:lyx-zona-sul` | `Lyx \| Zona Sul` (51) · `Lyx Zona Sul` (47) | 98 |
| `bubble:apartamentos-2-dormi-canoas-ou-porto-alegre` | espaço duplo × espaço simples | 15 |
| `bubble:abaco-tecnopolis` | `Abaco \| Tecnópolis` (6) · `Abaco \| Tecnopolis` (1) | 7 |
| `bubble:240` `bubble:250` `bubble:113` `bubble:251` `bubble:164` `bubble:202` | `[NNN]` × `NNN` (6 pares) | 23 |

O `slugify` colapsa **acento, caixa, `|`, `[`, `]`, `?` e espaço repetido** no mesmo `-`. Nenhum desses 14
pares é o mesmo texto na origem; todos viram a mesma chave no destino.

### 1.3 A consequência concreta

- Com `insert` puro: a carga de `ad_campaigns` **aborta** na primeira duplicata — e a §1 manda rodar o
  domínio inteiro em **uma transação só**, então as 775 linhas de catálogo voltam atrás junto.
- Com `on conflict (external_id) do nothing`: **14 campanhas somem em silêncio**. Como a §4.8 manda a carga
  de leads gravar `leads.campaign_id = 'bubble:'+slug`, os leads da variante descartada passam a apontar para
  a campanha da **outra** variante — 4.520 leads no caso de `casa-ou-ap`. É exatamente o double-count que a
  `0067` foi escrita para impedir, entrando pela porta dos fundos.
- O item está sob D4 (default: **não importar**), então não trava a carga padrão de hoje. Mas é um **fato
  medido, afirmado no documento, que é falso** — e é o argumento de segurança que o dono do negócio vai usar
  para decidir D4. Sem "sem colisão", a chave sintética não fecha.

### 1.4 Correção

`external_id = 'bubble:' + sha1(Imóvel bruto)[:16]`, nunca um slug legível. Se o legível for requisito, o
desempate (`-2`, `-3`) precisa ser gerado por uma ordem estável e replicado idêntico na carga de leads — na
prática, pior que o hash. E antes disso: unir as variantes que são a **mesma campanha** (§2), em vez de
deixar o slug uni-las por acidente.

---

## 2. ALTA — `leadfies` está com os acentos destruídos (337.879 × U+FFFD) e o mapa não registra

### 2.1 A medição (`r6.py`, `r7.py`)

Varredura byte a byte por `EF BF BD` (U+FFFD, REPLACEMENT CHARACTER):

```
export_All-Construtoras-modified_...csv        6.294 bytes  U+FFFD=0
export_All-pipelines-modified--_...csv     9.519.500 bytes  U+FFFD=0
export_All-links_...csv                          476 bytes  U+FFFD=0
export_All-dicadeouros-modified_...csv         3.191 bytes  U+FFFD=0
export_All-mensagemdodias-modified_...csv      8.294 bytes  U+FFFD=0
export_All-leadfies-modified--_...csv     56.299.714 bytes  U+FFFD=337.879
```

Os 5 arquivos que este domínio lê diretamente estão **íntegros** — inclusive o `\xa0` e o `\xe7\xe3o` de
`Lead Indicação` em `pipelines`, que o mapa acertou. **Só `leadfies` está corrompido**, e é dele que saem
`lead_sources` (§4.3/§5.2) e `ad_campaigns` (§4.8).

### 2.2 Onde o mapa erra por causa disso

**(a) A tabela §5.2 não é verbatim.** Os valores reais de `Fonte`, com escape (`r6.py`):

```
N�o definido            51      (o mapa escreve "Não definido")
Indica��o           2      (o mapa escreve "Indicação")
```

Um de-para implementado como está escrito — `{"Indicação": "indicacao", "Não definido": "nao_informado"}` —
**não casa nenhum dos dois**. Os 51 caem no catch-all e chegam ao destino certo por acaso; os 2 de
`Indicação` vão para `nao_informado` em vez de `indicacao`. Volume ridículo (2 leads); a gravidade é a prova
de que a tabela de origem foi transcrita da tela e não do arquivo, e de que a "cobertura 100%" da §5.2 se
apoia inteiramente no catch-all.

**(b) A mesma campanha nasce como duas.** Direto da tabela da §1.2:

```
bubble:vasco-casas-regi-o-metrop   <- 'Vasco | Casas Regi<FFFD>o Metrop.'   2.810 + 47 leads
bubble:vasco-casas-regiao-metrop   <- 'Vasco | Casas Região Metrop.'          589 + 17 leads
```

É **a mesma campanha real**, 3.463 leads, partida em dois `external_id` porque parte das linhas foi exportada
com o acento destruído. Nenhuma normalização proposta no mapa junta as duas: `norm` preserva o U+FFFD, e
`norm2`/`slugify` o apagam — dá `REGIO` × `REGIAO`.

**(c) §6.3 tem perda silenciosa.** 78 dos 335 nomes de campanha (11.088 leads) contêm U+FFFD. O casamento por
segmento usa `norm2`, que **remove** o U+FFFD: um segmento `Ápice` vira `PICE` e nunca casa com `APICE` do
catálogo. Os 41 nomes de construtora são ASCII puro, então hoje o estrago é limitado — mas o algoritmo
publicado tem um modo de falha silenciosa que o documento afirma não existir ("órfãos: 0" vale para
`pipelines`, não para `leadfies`).

### 2.3 Correção

Antes de qualquer de-para sobre `leadfies`: reexportar o arquivo com encoding correto (é a saída certa — a
informação foi perdida na origem e nenhum script a recupera). Se não houver reexport, tratar U+FFFD como
coringa de uma letra na normalização e registrar cada casamento por coringa no relatório de carga. E o mapa
precisa dizer que os valores da §5.2 são a forma **exibida**, não a armazenada: o código casa byte, não o
texto do documento.

---

## 3. MÉDIA — a linha de base da §11 se contradiz: o seed já pôs 2 construtoras e 4 empreendimentos

§4.3 assume que o seed **rodou**: "o catálogo alvo já tem 6 códigos vindos de `supabase/seed.sql:120-128`" —
confirmado, `seed.sql:120-128` insere `meta_ads, whatsapp, organico, indicacao, importacao, portal`.

§11 assume que o seed **não rodou**:

```sql
select count(*) ... from public.developers;          -- esperado: 41 | 33 | 0
select count(*) from public.developer_projects;      -- esperado: 625
```

Mas `npm run db:seed:remote` → `scripts/seed-database.ps1:17-23` aplica
`supabase/seeds/020_catalog_distribution_sdr.sql`, que insere (linhas 5-21):

- **2 `developers`**: `Horizonte Urbanismo` e `Viva Lar Incorporadora` (esta com `flow='external'` e
  `credito@vivalar.example.invalid`);
- **4 `developer_projects`**: Parque das Flores, Reserva Paulista, Viva Centro, Jardins do Sul.

Numa base semeada os valores corretos são **43 / 35 / 0** e **629**. Do jeito que está, as verificações #1 e
#3 **falham numa carga perfeitamente correta** — e o conserto natural (apagar as linhas de seed para o número
fechar) derruba `developer_projects` por `on delete cascade` junto com qualquer demonstração pendurada nelas.
A #2 (`flow='external' and submission_email is null`) continua 0, mas **não** porque a carga é `internal`: é
porque a construtora externa do seed tem e-mail — ou seja, a tripwire de D1 não tripa nem quando deveria.

Correção: escopar as verificações pelo que a carga escreveu (`join import_bubble_map`) em vez de contar a
tabela inteira, ou declarar "base sem seed" como pré-condição explícita da §11.

---

## 4. MÉDIA — `meta_ads` já vem com `sdr_agent_id` e `form_id`; o `on conflict do nothing` não desfaz

§4.3 é enfática:

> `form_id` — **`NULL` obrigatoriamente** … Preencher com qualquer coisa desvia a distribuição
> `sdr_agent_id` — **`NULL` obrigatoriamente.** Origem com agente de SDR **desvia da roleta**

O mecanismo confere: `supabase/functions/meta-ads-webhook/index.ts:307-313` só chama `assign_lead` se
`maybeStartSdr` devolver falso. Só que `supabase/seeds/020_catalog_distribution_sdr.sql:148-161` faz:

```sql
update public.lead_sources
set form_id = ... 'seed-form-parque-flores' ...,
    sdr_agent_id = coalesce(sdr_agent_id, (select id from public.sdr_agents where id = '3600…0001'), …),
    welcome_template_id = ...
where code in ('meta_ads', 'portal');
```

A carga insere as 6 novas com `on conflict (code) do nothing` e **reaproveita** `meta_ads` — destino de
`Facebook Leads` + `Facebook` + `Facebot` = **94.756 leads (92,2%)** e de todo lead futuro da Meta. A origem
que concentra a operação fica com agente de SDR e `form_id` de demonstração. E a §11 #4 pede
"`form_id` e `sdr_agent_id` NULOS **nas 6 novas**" — foi escrita de um jeito que **não olha** para a única
linha onde o problema pode estar.

Correção: a §11 #4 tem de cobrir as 12 linhas, e a carga (ou a janela de operação) precisa zerar
`form_id`/`sdr_agent_id`/`welcome_template_id` de `meta_ads` e `portal` quando a base for a semeada.

---

## 5. MÉDIA — `developer_projects` não tem chave que sobreviva a um segundo export

§3 declara: "**não precisa** [de `import_bubble_map`]: o Bubble não tem entidade de empreendimento, o par já
é a chave". A chave é `(developer_id, name)` e `name` é, pela §4.2, "a **variante bruta mais frequente** do
grupo". Ou seja: a chave de idempotência é uma **estatística do arquivo de origem**, não um identificador.

Medido (`r4.py`), entre os 90 grupos com mais de uma grafia:

```
grupos multigrafia com margem <= 2 entre 1o e 2o lugar : 31
grupos com empate exato de frequencia                  :  7
```

Exemplos: `('VASCO','GIRASSOIS')` = `GIRASSÓIS` 7 × `GIRASSOIS` 6 · `('COUTO','SANTA CATARINA')` =
`Santa Catarina` 3 × `SANTA CATARINA` 4 · `('BALIZA','BENTO GONÇALVES')` = 2 × 2, decidido só pelo desempate
alfabético.

**Um reimport com um export mais novo de `pipelines` — o cenário real, já que o corte vai ser refeito —
duplica.** Basta um negócio novo grafado do outro jeito para o vencedor virar: o `insert` escapa do unique
`(developer_id, name)`, cria uma **segunda linha** para o mesmo empreendimento, e os `deals` já carregados
continuam apontando para a primeira. Em 31 dos 625 projetos isso está a um registro de distância.

Correção: gravar uma linha de `import_bubble_map` por projeto com
`bubble_id = norm2(construtora) + '|' + norm(EMPREENDIMENTO)` — a mesma chave que o mapa já usa em memória
para resolver `deals.project_id` — e reimportar por ela, não pelo `name`. Custa 625 linhas e devolve ao
`name` o papel de rótulo editável, que é o que ele é.

---

## 6. BAIXA/MÉDIA — quatro incoerências internas da §7 (idempotência)

**(a) O total de 72 não bate com o default de D3.** §7 fecha em "41 + 10 + 18 + 3". O default de D3 é **17**
mensagens (descartando a #15). Com o default o mapa tem 71 linhas e o subtotal da §10 é 773, não 775. Se
alguém gravar 18 linhas de mapa e importar 17 mensagens, sobra uma linha com `target_id` apontando para nada
— e `import_bubble_map.target_id` é `not null` **sem FK**, então o banco aceita o lixo calado.

**(b) §7 manda gravar o mapa de `developer_projects`, e não existe `bubble_id` para isso.** "Para
`developers` e `developer_projects` o mapa é redundante mas barato de manter — grave também".
`developer_projects` não vem de linha nenhuma do Bubble (é `distinct` sobre `pipelines`), não tem
`unique id`, e o total de 72 não reserva espaço para as 625. A instrução é inexecutável como está escrita —
a §5 acima mostra qual chave usar.

**(c) O `UPDATE` do algoritmo não checa linhas afetadas.** `GamificationAdmin.tsx:51`
(`delete().eq("id", id)`) apaga dica de ouro pela tela. Se o admin apagar uma dica e a carga for rodada de
novo — que é literalmente o modo de recuperar —, o mapa ainda tem a linha, o `UPDATE` casa **0 registros** e
a dica **não volta**, sem erro nenhum. Todo `UPDATE` precisa de `if rowcount = 0 then INSERT + regravar o mapa`.

**(d) Nenhuma cláusula `on conflict` é dada para `developers` e `developer_projects`.** §7 diz que estão
"protegidas pelos seus uniques nativos" — um unique protege contra duplicata **abortando**, e a §1 manda
rodar tudo numa transação só. Sem `on conflict` explícito, a segunda execução derruba o lote inteiro.

---

## 7. BAIXA — número errado na §4.2: variantes brutas são 743, não 686

> variantes brutas distintas de `EMPREENDIMENTO` (com construtora): **686** → a normalização funde **53**

Medido (`r3.py`), com o `norm()` do próprio documento:

```
(construtora bruta, EMPREENDIMENTO bruto) distintos : 743
(developer resolvido, EMPREENDIMENTO bruto)         : 743
(developer, EMPREENDIMENTO.upper()) — so caixa      : 675
grupos normalizados                                  : 633
fusoes reais (743 - 633)                             : 110
```

Não há corte de dados que produza 686. Os outros números da mesma lista (633, 90, 8, 330, 158, 54) batem
todos — este está isolado. Não muda o volume final (625), mas é o número que mede **quanto** a normalização
mexe no dado; publicado pela metade, subestima o risco descrito na §5.

---

## 8. Detalhes confirmados que não pedem correção

- **2 empreendimentos morrem** com a regra atual: `VIVANZE` e `Empreendimento Teste Integracao` aparecem em
  linhas sem construtora nenhuma (`r4.py`). `developer_projects.developer_id` é `not null`, então não há para
  onde levá-los. O mapa cita o "2" na contagem mas não diz que eles somem — vale uma linha no relatório de carga.
- **12 negócios** caem nos 8 grupos placeholder descartados (`r8.py`: AVULSO `.` 3, TENDA `?` 2,
  AVULSO `AVULSO` 2, AVULSO `?` 1, VASCO `AVULSO` 1, CYRELA `AVULSO` 1, TENDA `0` 1, TENDA `.` 1).
  `deals.project_id` é nullable (`0006:31`), então ficam com `NULL`. Correto.
- A **ordem de carga respeita as FKs**: `import_bubble_map` não tem FK; `developer_projects → developers`
  (`0003:76`), `gold_tips/important_notices → profiles` (nullable, `0011:295,308`) e
  `ad_campaigns → developers, lead_sources` vêm todas depois de suas referências. `deals.developer_id` é
  `on delete restrict` e `project_id` é `on delete set null` (`0006:30-31`) — a §1 acerta ao exigir catálogo
  antes de negócios.
- `useful_links`: as 3 URLs continuam distintas depois de `value.trim().replace(/\/+$/,"").toLowerCase()`,
  que é literalmente o `normalizeUrl` de `Links.tsx:41`. A chave de idempotência proposta é válida.
- Nenhuma das 18 mensagens compartilha minuto com outra (menor delta: 1 minuto), então o `ends_at` encadeado
  nunca produz `ends_at == starts_at`. Não há CHECK no banco (`0011:287-298`), mas também não haveria violação.

---

## 9. O que precisa mudar antes de escrever código

| # | Onde | Correção mínima |
|---|---|---|
| 1 | §4.8 | Trocar `external_id` por hash do nome bruto. "Sem colisão" está errado: 335 → 321, 14 colisões, 8.816 leads |
| 2 | §5.2 / §6.3 | Registrar a corrupção de `leadfies` (337.879 × U+FFFD), reexportar o arquivo, casar por byte e não pelo texto do documento |
| 3 | §11 #1 e #3 | 43 e 629 numa base com `db:seed:remote`, ou declarar "base sem seed" como pré-condição |
| 4 | §11 #4 | Verificar `form_id`/`sdr_agent_id` nas **12** origens; `meta_ads` já vem preenchida por `seeds/020:148-161` |
| 5 | §3 / §4.2 | `developer_projects` precisa de linha em `import_bubble_map` com chave `(norm2(construtora), norm(nome))` — `name` por frequência não é chave |
| 6 | §7 | `UPDATE` com guarda de `rowcount = 0`; `on conflict` explícito em `developers`/`developer_projects`; total 71/72 coerente com D3 |
| 7 | §4.2 | 743 variantes, 110 fusões (não 686/53) |

---

## 10. Comandos executados

```
sed -n docs/importacao/mapa/catalogo.md                                    # leitura integral (923 linhas)
ls supabase/migrations | wc -l                                             # 86
sed -n supabase/migrations/20260725120200_0003_catalog.sql                 # developers, developer_projects, lead_sources
grep -n -A40 "create table public.(gold_tips|important_notices|useful_links)" .../0011_marketing_workspace.sql
grep -rn "alter table public.(useful_links|gold_tips|important_notices|lead_sources|developers|developer_projects)" supabase/migrations/
sed -n supabase/migrations/20260903630000_0063_marketing_dados.sql         # useful_links_url_absolute
sed -n supabase/migrations/20260725120700_0008_sdr.sql                     # sdr_agent_id, welcome_template_id
grep -n -B3 -A8 external_id .../0067_ad_campaigns_external_id_unico.sql    # unique GLOBAL
grep -n "developer_id|project_id|lead_origin" .../0006_deals.sql
sed -n supabase/seed.sql (110-135) · supabase/seeds/020_catalog_distribution_sdr.sql (1-40, 130-165)
grep -n "seeds/" scripts/seed-database.ps1
sed -n src/pages/Links.tsx (15-50) · src/components/PipelineTopRanking.tsx (55-75)
grep -rn gold_tips src/ · sed -n supabase/functions/meta-ads-webhook/index.ts (295-320)

python r1.py    # Construtoras: 41 registros; colisões de nome/slug/norm2/unique id
python r2.py    # pipelines: pares por construtora bruta × por developer resolvido; órfãos
python r3.py    # variantes brutas (743/675/633), 90 multigrafia, 8 placeholders, colisão de (dev,name)
python r4.py    # 34 valores de construtora, empreendimento sem construtora, margem de desempate (31)
python r5.py r6.py  # leadfies streaming: Fonte 14 distintos + 43 vazios, com escape ascii
python r7.py    # varredura de U+FFFD nos 6 arquivos (só leadfies: 337.879)
python r8.py    # negócios nos placeholders (12); OrigemLead com NBSP
python r9.py    # links/dicas/mensagens: contagem, unique id, datas, CCA, diff dos snapshots
python r10.py   # Imóvel: 335 distintos, colisão de slug, reprodução do 104/34.333/18
python r11.py   # uso por construtora (deals/projetos/leads/metas) → as 8 inativas
python r12.py   # detalhamento das 14 colisões de external_id (8.816 leads)
```

Nenhum comando tocou o banco. Nenhum arquivo do repositório foi alterado além deste relatório.
