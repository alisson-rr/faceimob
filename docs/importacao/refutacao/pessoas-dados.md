# Refutação — `mapa/pessoas.md` pela lente **dados**

Data: 09/09/2026 · Escopo: conferir contra os CSVs reais do Bubble as afirmações factuais do mapeamento
(valores de enum, formato de data, existência/preenchimento de coluna, taxa de casamento de FK).
Nada foi executado contra o banco; nenhum arquivo de código foi alterado.

**Veredito: REFUTADO em pontos localizados.** A espinha do mapeamento reproduz byte a byte — todos os
totais que a carga usa (298 / 12 / 267 / 88 / 179 / 317 / 310 / 87 / 6 grupos de CPF / os 12 slugs / a
distribuição por equipe) saíram idênticos aos meus scripts. O que não sobrevive são **6 afirmações
apresentadas como medidas**, concentradas no bloco que decide o **descarte de fichas de `corretors`**.

---

## 1. O que foi confirmado (não mexer)

| afirmação do mapa | medido | ok |
|---|---|:--:|
| 4 arquivos: 298×34, 12×14, 22×10, 365×11 | idem | OK |
| §5.1 `Funcao`: CORRETOR 275 · GERENTE 8 · DIRETOR 5 · CCA 5 · SÓCIO 2 · ADM 1 · SERVICOS GERAIS 1 · vazio 1 | idem (soma 298, nenhum outro valor) | OK |
| §5.4 `Ativo`: `sim` 94 · `não` 204 | idem | OK |
| §5.3 `habilitacao`: vazio 115 · `Não Possui (Estágio)` 77 · `CRECI` 60 · `Estágio` 46 | idem (4 valores, nenhum outro) | OK |
| §2.1 as 8 colunas de FK com 100% (`diretor` 217/217·5, `gerencia` 285/285·16, `equipe` 267/267·12, `Equipes.Diretor` 12/12·4, `Equipes.gerente` 12/12·12, `gerentes.gerente` 19/19·16, `gerentes.diretor` 18/18·6, `corretors.user` 294/294·289) | idem, valor a valor | OK |
| §2.2 `colaboradores`: 298 valores → **298 normalizados distintos**, zero colisão | idem | OK |
| §2.1 casar por `Nome_completo` quebra | `Users.diretor` por `Nome_completo`: **0/217** | OK |
| §4.1 #4 CPF: 294 preench., 288 distintos, **6 grupos** duplicados (12 linhas), 1 com 10 dígitos, **8 linhas** com DV inválido, 0 fora de `^[0-9]{11}$` após `zfill` | idem | OK |
| §10.1 datas: `%b %d, %Y %I:%M %p` parseia **298/298** em `Creation`/`Modified`, 295/295 `entrada`, 196/196 `nascimento`; `entrada` 294/295 com hora `00:00`; `nascimento` 196/196 com `00:00` | idem | OK |
| §4.1 #20 `nascimento`: 23 com ano > 2008, máx. `Mar 1, 2075`, nenhum < 1930 | idem | OK |
| §4.1 #32 e-mail: 298 preench., 298 distintos, já minúsculo, 0 inválido, 296 `@faceimob.com.br` + 2 `@gmail.com` | idem | OK |
| §4.1 #27 telefone: 260 com 11 dígitos, 30 com 10, 4 com 9, 4 vazios | idem | OK |
| §4.1 #17 `imgPerfil`: 87 fotos, 86 `.png` + 1 `.jpg`, 87/87 protocol-relative (`//…cdn.bubble.io`) | idem | OK |
| §4.2 #1 `Susana ` com espaço à direita; 12 slugs distintos na ordem listada | idem | OK |
| §4.2 #4 `gerente_gerente` = `gerente` em **12/12**, diverge de `Diretor` em **8/12** | idem | OK |
| §4.2 #5 `Equipes.corretores`: 264 itens, 264/264 resolvem, **0 item contém vírgula**, 0 nome em duas equipes | idem | OK |
| §4.5 `team_members`: 267 total · 88 abertos · 179 fechados; 2 membros sem `entrada`; **0 violações** de `left_at >= joined_at` com `greatest(entrada, Equipes."Creation Date")` | idem (simulei a regra linha a linha) | OK |
| §8 distribuição por equipe (`Victor` 53/16 … `Veronica` 1/0), 31 sem equipe, 6 ativos sem equipe | idem, valor a valor | OK |
| §4.4/§8 `distribution_group_members` = **88** (90 linhas `corretors.ativo=sim`, 94 `Users.Ativo=sim`) | idem | OK |
| §5.2 tabela final de papéis (271/11/5/4/2/1/1/1) e **317 linhas** em `user_roles`; sem papel: `JR` e `Selmira Tia` | idem, reproduzi a regra e bateu conjunto a conjunto | OK |
| §5.2 “4 `DIRETOR` e 4 `CORRETOR` atuam como gerente” | `Funcao` dos 16 managers: GERENTE 8, CORRETOR 4, DIRETOR 4 | OK |
| §5.2 base do `broker` do gatilho | `0002:363-365` insere `'broker'` para todo `auth.users` — 298 + 30 − 11 = 317 fecha | OK |
| §7.2 `Gerente Interino` (`GERENTE`, `Ativo=sim`, com e-mail, `Diretor` **e** `gerente` da `Faceimob`, outro membro `Parceiro Externo`) | idem | OK |
| §7.6 `Veronica Oliveira`→`Zona Sul`, `Alexandre Chaves`→`Archimedes` | idem | OK |
| descartes de §4.1/§4.2/§4.3/§4.4 (`corretor` 11, `gerente` 11, `divisao` 285 todos `1`, `mostrar` 146, `enviou` 283, `niver_*` 196, `Status_colab` 229, `new_Pontuacao`/`venda`/`vendas_corretor`/`null` 0, `meta`/`meta_equipe`/`Slug` 0, `qtd_batd` 2 com valor, `vgv_batd` `226500`/`189000`, `obtd` 0/22, `agil_qtd` 32 > 0, `vendas_mes`/`VGV_mes` 0 em 365) | idem, um a um | OK |
| §4.1 #26 “156 pessoas `Ativo=não` seguem `Status_colab=Ativo`” | 156 | OK |
| alvo: `app_role` tem os 8 valores citados; `profiles` tem `cpf/creci/habilitation/birth_date/address/division/indication`; check `^[0-9]{11}$`, check `habilitation in (…)`, unique parcial de `cpf` (`0046:50-70`); check `team_members_period` (`0002:179`); bucket `avatars` 5 MB + jpeg/png/webp (`0054:78-80`) | idem | OK |

Ou seja: **a decisão de arquitetura do mapa está certa** — `colaboradores` é mesmo a chave, `Users.equipe`
é mesmo melhor que `Equipes.corretores`, `Ativo` é mesmo a fonte de `status`, e nenhum total de carga muda.

---

## 2. O que foi refutado

### 2.1 PRINCIPAL — o bloco das fichas órfãs de `corretors` erra em 4 pontos (§2.3, §2.4, §6.1)

O mapa diz (§2.4): *“1. `norm(user)` → 294 linhas; 2. senão `norm(Nome)` → **+7 linhas**; 3. senão
descartar (**56 órfãs** + resto)”*, e (§2.3) que as descartadas são *“**56** fichas órfãs do lote
`(App admin)` de 13/05/2024 … (**5 delas são imobiliárias**: `Prime Imob`, `Melo Imob`, `Imob Prime`,
`IMOB Prime`, **`Parceiro Externo`**) **mais 8 grafias divergentes**”*.

Medido, executando exatamente a cascata descrita:

```
cascata: passo1(user)= 294   passo2(Nome)= 8   descartadas= 63
descartadas por Creator: {'(App admin)': 63}
descartadas sem user: 63   com user nao resolvido: 0
descartadas por data de criacao: [(2024-05-13, 63)]
imobiliarias na lista: ['Prime Imob', 'Melo Imob', 'Imob Prime', 'IMOB Prime']
```

| afirmação | mapa | real |
|---|---:|---:|
| passo 2 da cascata | +7 linhas | **+8 linhas** |
| linhas descartadas | 56 + 8 = 64 | **63** |
| origem das descartadas | 56 do lote `(App admin)` | **63/63 do lote `(App admin)`, todas de 13/05/2024** |
| “grafias divergentes” | 8 | **0** — nenhuma linha descartada tem `user` preenchido |
| imobiliárias entre as órfãs | 5, incluindo `Parceiro Externo` | **4**; `Parceiro Externo` **é um User real** (`Funcao=CORRETOR`, `Ativo=sim`, membro da equipe `Faceimob`), vira profile e papel `broker` — não é ficha órfã |

Por que importa, mesmo sem mudar nenhum total:

1. **§2.3 manda ABORTAR quando o número não bate** (“cobertura é 100% hoje; qualquer falha significa CSV
   diferente do perfilado”). Um loader que codifique `assert len(descartadas) == 56` ou
   `assert passo2 == 7` **para na primeira execução contra o arquivo real**.
2. **§6.1 pede “conferir no fechamento”** se algum negócio histórico apontar para essas fichas por nome —
   e dá a base errada: são **63** nomes fora do universo de pessoas, não 56. Subestima em ~12,5% a
   lacuna declarada para o domínio de negócios.
3. A própria aritmética não fecha: `294 + 7 + 56 = 357 ≠ 365`. O `82,5%` de `corretors.Nome` na tabela
   §2.1 (301/365) está certo — 301 é “linhas cujo `Nome` resolve”; a cascata resolve 302 (294+8) e
   descarta 63.

### 2.2 “Verificado: `corretors.ativo` concorda com `Users.Ativo` em **289/289**” — não concorda (§4.1 #26, §10.3)

É a evidência que o mapa usa para descartar `Status_colab` e eleger `Ativo` como fonte de
`profiles.status`. Medido:

```
pessoas distintas via corretors.user: 289
pessoas com ficha contraditoria dentro de corretors: 3  (Alexandre Chaves, Rafael Ramires, Lauren de Carvalho)
DIVERGENCIAS nivel pessoa: 1 -> ('Lauren de Carvalho', Users.Ativo='não', corretors.ativo=['não','sim'])
concordancia nivel pessoa: 288 / 289      (por linha: 291 / 294)
```

**288/289, não 289/289.** A decisão continua correta (a divergência é 1 pessoa, e a regra “inserir só
quem é `sim` nos dois” já a exclui da roleta — os 88 não mudam), mas a afirmação está registrada duas
vezes como fato verificado, uma delas em §10 “Suposições registradas”. Um revisor que confira o 289/289
conclui que o perfil inteiro é não-reprodutível.

### 2.3 Três erros de contagem menores

| onde | mapa | real | consequência |
|---|---:|---:|---|
| §4.1 #5 `creci` numéricos | 83 | **84** (114 preench. − 30 textuais: `Estágio` 16 · `Não possui` 9 · `Não Possui` 2 · `Estagio` 2 · `078022F` 1) | nenhuma na carga; a própria §5.3 já usa 18+11=29 textuais + `078022F`, coerente com 84 |
| §4.1 #18 `indicacao` | “só 10 de 74 casam” | **11 de 74** | nenhuma — a regra (não resolver como FK) continua certa |
| §5.2 justificativa do `broker` | “10 dos 12 gerentes … na própria lista `Equipes.corretores`” | **9 dos 12** (os 3 diretores: confere) | nenhuma; dos 16 managers, 12 aparecem em alguma lista |
| §4.1 #31 / §10.4 | “`Modified Date ≥ entrada` em **298/298**” | **295/295** — 3 linhas não têm `entrada` | nenhuma; o denominador é que está inflado |

---

## 3. Riscos que o mapa não menciona (achados novos, não refutação)

- **O CPF de 10 dígitos não é um CPF com zero à esquerda.** `zfill(11)` produz um valor com **DV
  inválido** (`075.***.***-34`, pessoa `Eva***`). Passa no check `^[0-9]{11}$` e **ocupa o índice único**
  `profiles_cpf_key`. Sugestão: gravar `NULL` + log em vez de `zfill`, ou validar DV antes.
- **3 pessoas têm fichas contraditórias dentro de `corretors`** (`Alexandre Chaves`, `Rafael Ramires`,
  `Lauren de Carvalho`: linhas `sim` e `não` para a mesma pessoa). A regra de desempate de §2.3
  (“manter `ativo='sim'`”) resolve, mas o mapa apresenta o conflito só como “duplicata de nome”.
- **`endereco` tem NBSP em 44 linhas** (§4.1 #8 cita o NBSP mas não o volume) — a regra
  `replace('\xa0',' ')` cobre.
- Linha do seed: `fila-geral` está em **`seed.sql:113`**, não `108-110` como cita §4.4.

---

## 4. Correção mínima proposta

1. §2.4 → `+8 linhas`; §2.3 e §6.1 → **63 fichas descartadas, todas do lote `(App admin)` de 13/05/2024,
   nenhuma “grafia divergente”**; remover `Parceiro Externo` da lista de imobiliárias órfãs (são 4).
2. §4.1 #26 e §10.3 → **288/289**, citando `Lauren de Carvalho` como a divergência conhecida.
3. §4.1 #5 → **84 numéricos**; §4.1 #18 → **11 de 74**; §5.2 → **9 dos 12 gerentes**;
   §4.1 #31/§10.4 → **295/295**.
4. Acrescentar em §4.1 #4: CPF com menos de 11 dígitos → `NULL` + log (o `zfill` fabrica DV inválido).

Nenhum total de carga da §8 muda com essas correções.

---

## 5. Comandos que sustentam este relatório

Todos rodados em `DOCUMENTOS/DADOS_BUBBLE/` com `python` 3.12, `csv.DictReader`,
`encoding='utf-8-sig'`, e a função `norm()` do §2.2 copiada literalmente do mapa. Nenhum valor de
`senha_temporaria` foi lido, exibido ou gravado; CPF aparece mascarado.

- contagem de linhas/colunas dos 4 arquivos via `csv.DictReader` (não `wc -l`);
- `collections.Counter` sobre `Funcao`, `Ativo`, `habilitacao`, `Status_colab`, `divisao`, `Creator`;
- taxa de FK: `norm(valor) in {norm(colaboradores)}` por coluna, com contagem de distintos e de
  distintos que resolvem;
- `datetime.strptime(v, '%b %d, %Y %I:%M %p')` sobre `entrada`, `nascimento`, `Creation Date`,
  `Modified Date`, com faixa mín./máx. e contagem de hora `00:00`;
- simulação de `team_members` (`greatest(entrada, Equipes."Creation Date")` × `Modified Date`) e do
  check `left_at >= joined_at`;
- simulação da cascata de `corretors` e do conjunto `user_roles` (união `gerencia`∪`Equipes.gerente`,
  `diretor`∪`Equipes.Diretor`, `broker` condicionado a ficha em `corretors`);
- no alvo: `sed`/`grep` em `supabase/migrations/20260725120000_0001_foundation.sql`,
  `…_0002_identity.sql`, `…_0046_profile_extra_fields.sql`, `…_0054_entrada.sql` e `supabase/seed.sql`.
