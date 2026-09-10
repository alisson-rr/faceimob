# Handoff J — Fechamento da demo: smoke, suíte E2E, roteiro e publicação

26/08/2026 · branch `nova` · **nada commitado**.
Rodou depois de G, H, K e **em paralelo com L**, que entregou no meio da sessão.

**Publicado: https://faceimob.vercel.app** — deployment `faceimob-9vmd4uhxa`,
target production, Ready. Bundle `assets/index-DWf46mx_.js`, **hash conferido**
contra o `dist/index.html` local, mais 8 chunks conferidos byte a byte
(`Pipeline`, `Leads`, `Checkin`, `CcaPipeline`, `DailyReport`,
`DashboardSwitcher`, `Gamification`, `importSheet`). **O build no ar inclui a
Tarefa L** — o chunk `importSheet-Dx58xdTU.js` (66 KB, `read-excel-file`) está
publicado e não há mais chunk de `xlsx`.

---

## 0. Leia isto antes de tudo — o que ainda está aberto e é seu

Três coisas. As duas primeiras impedem a demonstração de acontecer; a terceira é
segurança com a URL já pública.

1. **A conta do cliente não existe.** Conferido no banco às 19h20: 23 perfis, e a
   única conta com e-mail real é a sua (`admin` + `broker`). Não há usuário do
   Douglas. Sem ele o passo 1 do roteiro não acontece — e o `showcase` grava
   notificações, tarefas e presença **para a conta que existir quando ele roda**,
   então a ordem importa: `showcase:limpar` → `user:create -Password` →
   `showcase`. Está no topo de `docs/demo/roteiro-cliente.md`.
2. **Rode o cenário dentro da janela de um turno, pouco antes da demo.** Às 19h20
   havia **0 presenças abertas**: quem abrir o Check-in agora vê a fila vazia. E
   um `showcase` sozinho **não recria** a presença (§4.4) — precisa do
   `showcase:limpar` antes.
3. **Os 2 links de diretoria continuam sem PIN.** Conferido hoje às 19h20:
   `seed-diretoria-daniela` e `diretor-ricardo-sampaio` com `pin_hash` nulo e
   ativos. **Abri `https://faceimob.vercel.app/diretor/seed-diretoria-daniela` sem
   sessão e sem PIN e li a diretoria inteira** — 32 leads, 9 análises, 5
   aprovações, 2 vendas da semana, quebrado por equipe. O slug é derivado do nome.
   A `0034` não protege link sem PIN: não há segredo a adivinhar nem contador a
   incrementar. Admin · Diário → *Gerar PIN* nos dois.

Continua pendente também: **desligar o auto-cadastro** no painel do remoto
(Authentication → Sign In / Providers).

---

## 1. O smoke do caminho do cliente

### 1.1 O que deu para percorrer, e o que não deu

**Não entrei no app pela URL publicada.** Não há conta do cliente (§0.1), a única
conta real é a do dono do projeto, e eu não tenho — nem deveria ter — a senha
dela. Então o caminho foi partido em duas metades, cada uma provada onde dava
para provar:

| Metade | Onde foi provada | O que isso vale |
|---|---|---|
| **Superfície anônima** (login, diário público, checkpoint da diretoria, fallback de SPA, identidade do bundle) | **na URL publicada**, contra a homologação | é o produto real, no banco real |
| **Telas autenticadas** (Dashboard, Check-in, Leads, Pipeline, CCA, Gamificação, RoleSwitcher) | **stack local**, com o mesmo código publicado, sessão real cunhada pelo `global-setup` da suíte E2E e o cenário `060_demo_showcase` aplicado | o código é o mesmo do bundle no ar; o que não se prova assim é a configuração do projeto remoto (RLS já é exercitado, porque a sessão é um JWT de verdade) |

Nenhuma senha foi digitada em campo nenhum: a sessão local entra por
`storageState`, que é o mesmo caminho que a suíte E2E usa desde sempre.

### 1.2 Passo a passo, com resultado

Legenda: ✅ funcionou · ⚠️ funcionou com ressalva · ❌ quebrou.

| # | Passo | Onde | Resultado |
|---|---|---|---|
| 1 | **Login** — tela abre, campos E-mail/Senha, botão Entrar, alternância para "Receber código por e-mail" e volta | publicada | ✅ console limpo |
| 1b | **Senha errada** → "E-mail ou senha inválidos.", sem distinguir e-mail inexistente | publicada | ✅ |
| 1c | `/`, `/login`, `/pipeline`, `/checkin`, `/leads`, `/gamification`, `/cca`, `/diretor/<slug>` respondem **200** no F5 (fallback de SPA do `vercel.json`) | publicada | ✅ |
| 2 | **Dashboard** — régua de 6 KPIs, `Meta do mês`, funil, abas | local | ✅ |
| 3 | **Check-in** — turno no cabeçalho, janela atual, leads recebidos, janelas de trabalho | local | ✅ |
| 4 | **Leads** — lista, filtros, cartões de resumo | local | ✅ |
| 4b | **Abrir o lead pela linha** (nome do cliente é `<button>`) | local | ✅ **está no vídeo**, aos ~22 s: o clique no nome abre o `LeadDetailModal` com as 7 abas (Dados, Formulário, Comentar, Anexos, Histórico, Agenda, Rastreio) |
| 4c | **Abrir o lead pelo sino** (`?lead=<id>`) — mesmo modal | — | ⚠️ **não reexecutei**; o contrato está provado no handoff-G §7 (dois testes contra o mock: abre e consome o parâmetro da URL). Não achei regressão, mas também não é prova minha |
| 5 | **Pipeline** — tabela e kanban, 9 colunas do catálogo, régua de contadores | local | ✅ |
| 5b | **Mover no kanban pelo mouse** | local | ⚠️ o **efeito** está provado: `broker/etapas.spec.ts` dispara `dragstart` no cartão e `drop` na coluna, e cobra o banco nos dois sentidos (etapa permitida grava, etapa negada avisa e não grava). O que não está provado é o **gesto** — evento sintético não é o mouse de verdade. Nunca foi, nesta suíte |
| 5c | **Mover pelo teclado** (`Shift+←/→` no cartão focado) | — | ⚠️ **não exercitei — só li o código.** `DealCard.tsx:40-56`: o cartão é `role="button"` com `tabIndex`, Enter/Espaço abre e `Shift+←/→` chama o mesmo `onMove` do `onDrop`, com seta sozinha ignorada de propósito. Parece certo, mas **ninguém apertou a tecla** — nem eu, nem a suíte. Vale um minuto de teclado antes da demo, se você pretende mostrar |
| 5d | **Perder negócio pede confirmação** com motivo obrigatório | — | ⚠️ **não exercitei — só li o código** (`LoseDealDialog` + `Pipeline.tsx`). **A suíte E2E também não cobre**: `grep` por "perder"/"DISTRATO"/"QUEDA" em `e2e/**/*.spec.ts` não acha nenhum teste. Era um interruptor que encerrava o negócio num clique (F14) e virou diálogo com motivo obrigatório — a mudança de maior risco do Pipeline sem rede de segurança. **Candidato número 1 a teste na próxima sprint** |
| 5e | **Criar/editar pelo `DealDetailModal`** (o diálogo inline sumiu) | local | ✅ provado pela suíte: `pipeline-negocio.spec.ts` cria negócio pela tela e confere `deals`, `deal_clients` e `deal_participants` no banco |
| 6 | **CCA — o Select "Mover para…" aparece sem hover e no toque** | local | ✅ **confirmado na captura de 375 px**: o Select está visível no cartão sem passar o mouse (`smoke-j-cca-dark-375.png`) |
| 7 | **Venda → confete e som saem UMA vez** | local | ✅ **medido**: dois `game_events` de `venda` com o mesmo `ref_id` (a venda rateada entre dois corretores) → a comemoração apareceu **1×**. Era o defeito mais visível se estivesse quebrado |
| 8 | **Gamificação** — pódio, ranking completo, temporada aberta e fechada | local | ✅ |
| 9 | **RoleSwitcher → Ver como Corretor** — menu encolhe, aviso "pré-visualizando" | local | ✅ está no vídeo (§5) |
| 10 | **Diário público — PIN certo grava** ("🎯 Checkpoint concluído! +7 XP", e o funil do mês passa a mostrar o valor) | **publicada** | ✅ |
| 11 | **Diário público — link bloqueado recusa** ("Envio recusado — PIN incorreto, ou o link está bloqueado por 15 minutos…") | **publicada** | ✅ é a correção da Tarefa K, provada no build final |
| 12 | **Diário público — PIN errado** ("PIN incorreto", equipe continua fechada) | **publicada** | ✅ |
| 13 | **Checkpoint público da diretoria** abre sem sessão | **publicada** | ⚠️ funciona — **e esse é o problema**: abre sem PIN (§0.3) |

> **Como o passo 10-12 foi feito sem estragar dado de demo:** criei uma equipe
> inativa, um perfil descartável (banido, `@faceimob.invalid`) e um link próprio
> com PIN só para isso, percorri os três caminhos e **apaguei tudo**. Conferido
> depois: 4 links, 23 perfis, 13 corretores, 3 equipes, 7 diários, 73 leads e 31
> negócios — exatamente o estado anterior. O PIN descartável não está em arquivo
> nenhum e o link não existe mais.

### 1.3 O que o smoke encontrou

Nada bloqueou o caminho. **Não precisei corrigir nenhum bloqueio**, então não há
`<!-- J: correção de bloqueio -->` neste handoff. Os defeitos estão em §3.

---

## 2. A suíte E2E

Rodou contra o **alvo local**, não contra a homologação. A decisão e o preço
estão em §2.3.

### 2.1 O placar

**136 testes. 134 passam. 2 falham — e as duas passam quando o arquivo roda
sozinho.** Alvo local, `db reset` antes, execução serial (é como a suíte é
configurada).

```
npx supabase db reset && npx playwright test

  2 failed
    [broker] › trava-atendimento.spec.ts:63 › lead atribuído mostra contagem regressiva correndo
    [broker] › trava-atendimento.spec.ts:80 › atender trava o lead com o corretor e para o cronômetro
  134 passed (5.1m)
```

E o mesmo arquivo, isolado:

```
npx playwright test e2e/broker/trava-atendimento.spec.ts --project=broker
  3 passed (26.8s)
```

| | |
|---|---|
| Total de testes | **136** |
| Passam na execução completa | **134** |
| Falham na execução completa | **2** — e passam isoladas: são **flaky**, não regressão |
| Falham por **defeito do produto** | **0** |
| `test.skip` adicionados | **0** |
| Arquivos de `e2e/` alterados | **20** (18 specs + `helpers/negocio.ts` + `cca/esteira.ts`) |

**De onde vinha:** não consegui uma execução completa "antes" — duas tentativas
morreram no meio (uma porque a Tarefa L estava editando `src/` e deixou
`newSchema.ts` com erro de sintaxe por alguns minutos; a outra porque eu a parei
para aplicar correções). A melhor amostra que tenho é de **113 dos 136 testes
executados, com 36 falhas** — nas mesmas famílias que a §2.2 descreve.

**Por que as duas restantes são flaky, e não conserto disso:** o banco é um só e
os crons estão rodando. `release_expired_leads()` passa a cada 30 s e devolve
para a fila o lead que estourou o prazo; `trava-atendimento` cria justamente um
lead com prazo curto e conta com ele na lista do corretor. Na execução completa
há minutos entre o `beforeAll` e a asserção; isolado, segundos. O `playwright.config.ts`
já registra a causa ("`ponytail`: paralelismo só volta com um banco por worker") —
o mesmo remédio serve aqui. **Estabilizar isso é mexer no cenário do teste, não
na aplicação**, e preferi entregar o placar honesto a mascarar com `retries`.


### 2.2 O que estava quebrado, e por quê

Todos os seletores que quebraram, quebraram pela mesma causa: **as telas foram
reescritas em G/H/F e a suíte não rodava desde antes disso**. Nenhuma falha
apontou defeito de produto — mas três apontaram **mudança de comportamento
deliberada** que a suíte ainda cobrava do jeito antigo, e essas valem leitura:

| Spec | O que a suíte cobrava | O que mudou |
|---|---|---|
| `anonimo/login` | "não existe campo de senha" | a senha **voltou** por decisão de 25/08 (Tarefa A): o código depende de SMTP e a demonstração não podia depender de caixa postal. O hash vive no GoTrue, nunca em `public.profiles` — que é o que a ata de 23/07 proibia. Reescrevi para cobrar **os dois caminhos** e a troca entre eles |
| `admin/allowed-ips` | que a tela mostrasse a mensagem crua do Postgres (`invalid input syntax for type cidr`) | o A05 traduz por código: agora sai "Um dos campos está em formato inválido.". O teste passou a cobrar **as duas metades** — a frase em pt-BR aparece **e** a do Postgres não vaza |
| `admin/fechamento-mes` | escolher o mês **digitando no filtro** | desde a `0032` + Tarefa H o mês vem da **temporada aberta do game**, e o diálogo escreve qual período vai congelar antes de confirmar. O cenário passou a mover a temporada; o teste ganhou a asserção de que o período aparece escrito |

O resto foi rótulo e estrutura: `Incorporadora`→`Construtora *`,
`Corretor 1 (Obrigatório)`→`Corretor 1 *`, `Valor`→`VGV bruto`,
`Unidade`→`Bloco | unidade`, `Criar deal`→`Criar negócio`,
`Pipeline CCA`→`Esteira CCA`, botão `Filtrar negócio`→`Filtrar`, filtro de mês
de campo de texto para `<Select>`, número formatado em pt-BR (`9000`→`9.000`),
`<h3>` do cartão virando `<h2>` do `SectionCard`, e o pódio escrevendo `pts` em
vez de `pontos`.

**A correção mais rendosa foi em `e2e/helpers/negocio.ts`**: os campos do editor
de negócio voltaram a ser alcançáveis por `getByLabel`, porque a Tarefa H ligou
`<Label htmlFor>` aos ~40 campos (achado X04). O helper usava XPath justamente
porque essa associação não existia. Trocar um arquivo destravou os specs de
`admin`, `broker` e `manager` que passam pelo modal.

**Nenhum `test.skip` foi adicionado.** Suíte vermelha documentada vale mais que
placar maquiado.

### 2.3 Por que local e não `e2e:remote`

O enunciado pedia `npm run e2e:remote`. Não rodei, por dois motivos somados —
e o segundo é o que decide:

1. **`SUPABASE_SERVICE_ROLE_KEY` não está no ambiente.** A suíte a exige no alvo
   remoto para cunhar as sessões.
2. **O preparo da suíte escreve no banco da demonstração.**
   `provisionE2EUsers()` cria 10 contas `e2e.*@faceimob.test` com papéis e **duas
   equipes** (`Equipe E2E Alfa` e `Beta`), e elas **não são removidas no final**.
   Rodar isso hoje colocaria "E2E Corretor" nas listas de equipe e somaria 5
   corretores à contagem de staff que o Douglas vai ver. Pior: um dos specs
   **encerra a temporada aberta do game** e a reabre no `afterAll` — se a
   execução for interrompida no meio (foi, duas vezes hoje, por outra tarefa
   editando `src/`), a homologação fica com a temporada de agosto **fechada** e o
   pódio da demonstração desaparece.

Trocar risco de quebrar a demo por cobertura de configuração remota, no dia da
demo, é troca ruim. O alvo local exercita o **mesmo código** e o **mesmo schema**
(34 migrations aplicadas por `db reset`), com JWT real e RLS valendo. O que ele
não cobre: `.env` do projeto remoto, edge functions publicadas e dados da
homologação — e isso foi coberto pelo smoke da §1 na URL publicada.

> **Quando rodar remoto valer a pena**, o caminho honesto é limpar depois:
> hoje não existe `deprovisionE2EUsers()`. É um item para a próxima sprint.

---

## 3. Defeitos encontrados

Nenhum foi corrigido: `src/` não é meu nesta tarefa. Ordenados por quanto
aparecem na demonstração.

### 3.1 🟠 Aviso falso de "Nova versão disponível" em toda tela com rota própria

**Onde:** `src/components/UpdateNotifier.tsx:17-24` (assinatura carregada) e
`:27-35` (assinatura remota).

**Como reproduzir:** abra https://faceimob.vercel.app/daily/<qualquer-slug> — ou
qualquer rota autenticada — num build recém-publicado. Em poucos segundos
aparecem o banner "Nova versão disponível!" e o botão flutuante "Nova versão
disponível — Atualizar". Reproduzido na URL publicada, no build final, com
console limpo.

**Causa:** o detector compara dois conjuntos que nunca são iguais. O
`loadedSignature` lê **os assets presentes no DOM daquela aba**, que incluem os
chunks que a rota carregou sob demanda (`DailyReport-*.js`,
`ComparativeFunnel-*.js`, `pt-BR-*.js`, …). O `fetchRemoteSignature` lê os
assets **listados no `index.html`**, que só tem a entrada e os módulos
pré-carregados dela. Qualquer rota com chunk próprio diverge — ou seja, todas.

**Consequência na demo:** o cliente vê o app pedindo para ser atualizado o tempo
todo. Clicar em "Atualizar" só recarrega; não quebra nada.

**Correção provável (1 linha, não apliquei):** comparar só a entrada, filtrando
as duas listas por `/assets/index-`. Como é `src/`, fica para quem for dono.

### 3.2 🟠 O diário público rotula "ontem" e grava a data de hoje

**Onde:** `src/pages/DailyReport.tsx:85` — `const yesterday = new Date();`.

**Como reproduzir:** abra `/daily/<slug>`, entre com o PIN. O cartão diz
"Data (ontem)" com o campo em **hoje** (26/08 em 26/08), e o texto abaixo diz
"abrir o checkpoint de **ontem (26/08)**". O `submit` manda `todayStr`.

**Consequência:** ou o rótulo mente, ou o dia gravado está errado — e a diferença
importa, porque o gerente lança a produção do dia anterior. É decisão de produto,
não conserto óbvio: mudar a data mexe no que já está gravado.

### 3.3 🟡 Texto abaixo de 12 px em todas as telas — e vem do kit

**Onde:** `src/index.css:234` — `.text-eyebrow { font-size: 0.6875rem }` = **11 px**.
E `src/components/RoleSwitcher.tsx:45,59,74` — `text-[10px]`.

**Como reproduzir:** medido por código nas 24 combinações da varredura (§4).
Toda tela tem de **7 a 17 elementos em 11 px** e **1 em 10 px**. Exemplos: as
seções do menu lateral ("Menu principal", "Administração", "Sistema"), os rótulos
das seções do editor de negócio, `1º`/`2440 pts` do `PipelineTopRanking`, e o
"Administrador (você)" do seletor de papel — que aparece no cabeçalho de **todas**
as telas.

**Por que vale registrar:** os handoffs G e H declaram "piso de 12 px, zero
`text-[Npx]`" — e é verdade nos arquivos deles. O piso vazou pela classe do kit
que eles adotaram no lugar dos literais. Não é regressão de ninguém: é o
`.text-eyebrow` que precisa subir para `0.75rem`, ou o X07 que precisa ser
redefinido para admitir 11 px em rótulo em caixa alta.

### 3.4 🟡 A 375 px o sino e o avatar são cortados pelo cabeçalho

**Como reproduzir:** 375 px de largura, qualquer tela autenticada. No Dashboard o
sino aparece pela metade; na Esteira CCA — cujo título é mais longo — **o sino
some**. Ver `docs/design-system/smoke-j-dashboard-light-375.png` e
`smoke-j-cca-dark-375.png`.

**Causa provável:** o `SelectTrigger` do `RoleSwitcher` tem largura fixa
(`w-[150px]`) e não encolhe; o que sobra do cabeçalho é cortado.

**Consequência:** no celular não dá para chegar às notificações — que é um dos
extras do roteiro.

### 3.5 🟡 O cenário de demonstração só cria a presença do check-in uma vez

**Onde:** `supabase/seeds/060_demo_showcase.sql:982`.

**Como reproduzir:** rode `showcase` com um turno aberto (cria 5 presenças).
Espere o turno fechar. Rode `showcase` de novo: **nada é criado**, e o Check-in
segue com a fila vazia.

**Causa:** o `insert into public.checkins` usa UUID **fixo**
(`8f000000-…-0000000005NN`) com `on conflict do nothing`. Depois da primeira
criação a linha existe (com `checked_out_at` preenchido pelo cron) e o insert é
ignorado. Só o `showcase:limpar` (que apaga `checkins` da faixa `8f000000-%`)
devolve o cenário.

**Consequência:** é a diferença entre o Douglas ver a fila com colegas e ver uma
fila vazia. Está escrito no topo do roteiro; a correção seria derivar o id da
data.

### 3.6 🟢 `scripts/demo.mjs showcase` não rodava no alvo local — **corrigido**

Este eu consertei, porque `scripts/demo.mjs` é arquivo desta tarefa e o roteiro
promete que os comandos funcionam localmente.

`supabase db query --local` manda o arquivo como **prepared statement**, e o
Postgres recusa mais de um comando por statement ("cannot insert multiple
commands into a prepared statement"). Os seeds têm centenas. O `--linked` nunca
sofreu porque a Management API executa em modo simples.

Agora, no alvo local, o SQL vai pelo `psql` de dentro do contêiner do banco — o
mesmo binário que o `supabase db reset` usa para os seeds. Verificado: o cenário
aplica localmente e imprime o resumo (60 leads, 25 negócios, 7 vendas, 5
presenças).

### 3.7 🟢 Acabamento

- **`game_seasons.label` = "July 2026"** na homologação: rótulo em inglês numa
  tela em pt-BR, herdado do fechamento automático. Só o rótulo; período e placar
  estão certos.
- **Botão sem nome acessível** no cartão de XP do diário público
  (`DailyReport.tsx`, o `<button>` ao lado de "XP do mês").
- **`src/pages/Login.tsx`** usa `text-[11px]` no divisor "ou" — mesma classe do
  §3.3.

---

## 4. Varredura de 375 px e tema claro

Cinco telas do enunciado mais Gamificação, nos dois temas e nas duas larguras =
**24 combinações**, todas com sessão real de admin contra o banco local com o
cenário aplicado. Medição por código na página, não a olho.

### 4.1 O resultado, em uma linha

**Nenhuma tela tem barra de rolagem horizontal.** `scrollWidth === clientWidth`
nas 24 combinações, e **zero erro de console** em todas.

### 4.2 O transbordo do `AppLayout` (handoff-H §10.5) — não acontece mais

O handoff-H aponta que o `main` do `AppLayout` deixa transbordo horizontal
escapar para o documento, e que na Esteira CCA isso dava **735 px de rolagem a
375 px**. **Conferido hoje: não reproduz.** A CCA a 375 px mede 375/375, e as
colunas do kanban rolam dentro do próprio contêiner (é o `contain: paint` que a
Tarefa H comentou no `CcaBoard.tsx`).

A ressalva do H continua de pé como **dívida**: a correção é caso a caso, não no
shell. Uma tela nova com faixa rolável vai precisar do mesmo remendo.

### 4.3 O que está quebrado

| Achado | Onde | Gravidade |
|---|---|---|
| Sino e avatar cortados no cabeçalho a 375 px | todas as telas autenticadas | 🟡 §3.4 |
| 7 a 17 elementos em 11 px e 1 em 10 px por tela | todas | 🟡 §3.3 |
| Pódio do `PipelineTopRanking` apertado a 375 px — os três degraus encostam nas bordas e o 3º fica rente ao limite do cartão | Pipeline | 🟢 cosmético |
| `<h1>` ausente numa medição da CCA em tema escuro a 1280 px | CCA | 🟢 artefato de tempo: as outras três medições da mesma tela leram "Esteira CCA". Se reproduzir, é carregamento lento, não estrutura |

**Contraste:** não medi na varredura. O repositório tem
`src/lib/theme-contrast.test.ts`, que lê `index.css` e reprova par de cor abaixo
do mínimo — está verde no `npx vitest run`.

### 4.4 Capturas

12 arquivos novos em `docs/design-system/`, prefixo **`smoke-j-`** (as 6 telas ×
2 temas, a 375 px). Prefixo próprio de propósito: as capturas de G e H têm os
mesmos nomes-base e vieram de **fixtures sintéticos**; estas vieram de **banco
real com RLS valendo**. Nada foi sobrescrito.

---

## 5. Vídeo de backup

`docs/demo/caminho-da-demo.mp4` — 1,0 MB, H.264, 1280×720, **65 s**, sem áudio
(o roteiro é a narração).

Percorre: tela de login (as duas formas de entrar) → Dashboard → Check-in →
Leads (abre o lead pela linha) → Pipeline (tabela e kanban) → Esteira CCA →
Gamificação → **RoleSwitcher em "Ver como Corretor"**, com o menu encolhido e o
aviso "pré-visualizando".

**Duas ressalvas honestas:**

1. **O login aparece, mas não acontece na frente da câmera.** A gravação mostra a
   tela e a alternância senha ↔ código; a sessão entra depois, por `storageState`.
   Foi de propósito: era o único jeito de garantir que **nenhuma credencial**
   aparece no vídeo. Na demonstração ao vivo o login é o passo 1 do roteiro.
2. **Os números do vídeo são do banco local**, com o mesmo cenário
   `060_demo_showcase` mais o seed base — então eles **não batem** com os do
   roteiro (o vídeo mostra 99 leads e R$ 3.554.395 de VGV; a homologação tem 73 e
   R$ 3.081.520). O vídeo prova que o caminho funciona, não quanto vale a
   operação. Para um backup com os números exatos, seria preciso gravar logado na
   homologação — que é justamente o que falta a conta do cliente para permitir.

Conferido antes de salvar: sem senha digitada, sem token na tela, sem e-mail
pessoal (o cabeçalho mostra "E2E Admin", nome de exibição de conta de teste).

---

## 6. Roteiro do cliente

`docs/demo/roteiro-cliente.md` foi **reescrito**. O anterior era de 25/08 e
mentia em vários pontos depois de G, H e K.

**Números conferidos no banco às 19h20 de 26/08** (SQL no próprio roteiro), não
estimados. O que mudou em relação à versão antiga:

- **A régua de KPIs do Dashboard é outra.** Era "Negócios do mês / Vendas do mês
  / VGV / Meta / Leads / Corretores"; hoje é **Leads 73 · Produção 17 ·
  Resultado 7 · Perdas 1 · Negócios 24 · VGV R$ 3.081.520,00**, e a meta virou
  cartão próprio (7 de 14). O "Negócios" caiu de 25 para 24 porque agora é
  `vendas + propostas` — o negócio perdido do mês não entra.
- **A tabela de leads por situação estava toda errada.** Era 4 na fila / 18 em
  atendimento…; hoje é **10 na fila · 20 em atendimento · 19 em negociação · 14
  convertidos · 6 perdidos · 4 descartados**. E o roteiro agora **avisa que esses
  seis números mudam sozinhos** — a roleta distribui e o prazo devolve.
- **O Pipeline não mostra VGV por coluna.** O kanban tem rótulo e contagem; a
  tabela antiga do roteiro prometia uma coluna de VGV que não existe. As
  contagens novas são as de **todos os 31 negócios** (o kanban abre sem filtro de
  mês), não as 25 do cenário.
- **Entrou o que G e H fizeram:** abrir o lead pela linha e pelo sino, mover no
  kanban por teclado, a confirmação com motivo obrigatório ao perder, o Select
  "Mover para…" sempre visível na CCA.
- **Entrou uma seção de preparo obrigatório** (§0 deste handoff) e a nota do som
  (o navegador só libera áudio depois de um clique — clique uma vez antes do
  passo da venda).
- **"O que ainda não está pronto" ganhou os defeitos da §3** — melhor o Douglas
  ler do que descobrir clicando.
- **O comando de publicar mudou** — ver §7.

---

## 7. Publicação

**Publicado, e não foi direto.** Registro do que atrapalhou, porque vai
atrapalhar de novo:

1. `npx vercel deploy --prod --yes` responde **"Not authorized"**. A CLI está
   logada (`vercel whoami` → `devalissonrosa-6549`), mas o projeto vive no time
   `alissons-projects-b1faee75` e o deploy não assume o time sozinho. **Precisa
   de `--scope alissons-projects-b1faee75`.**
2. Com o escopo certo, três tentativas seguidas morreram no meio do envio com
   `fetch failed` / "This operation was aborted" — o mesmo sintoma que o
   handoff-G descreve. **`--archive=tgz` resolveu de primeira**: manda um pacote
   só em vez de arquivo por arquivo.

O comando que funciona, e que está no roteiro:

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

**Conferência do que está no ar** (feita depois do deploy):

- `curl` do `index.html` publicado → `assets/index-DWf46mx_.js`, **igual** ao
  `dist/index.html` local;
- 8 chunks conferidos por tamanho, todos idênticos ao `dist/` local;
- `importSheet-Dx58xdTU.js` (66 KB) responde 200 — a troca do `xlsx` da Tarefa L
  está publicada;
- o smoke da §1 foi **refeito contra este build**: login, mensagem de erro,
  fallback de SPA, e os três caminhos do diário público (PIN certo grava, PIN
  errado recusa, link travado recusa), com console limpo em cada um.

**Se a Tarefa L publicar depois de mim**, o build dela sai deste mesmo working
tree e leva tudo junto — basta conferir o hash com o `curl` acima.

---

## 8. Validação

```bash
npm run typecheck   # ✅ os 3 projects (app, node, e2e)
npm run lint        # ✅ 0 erros · 7 avisos pré-existentes (react-refresh em ui/*, AuthContext, ComparativeFunnel, UpdateNotifier)
npx vitest run      # ✅ 183 testes em 12 arquivos
npm run build       # ✅ 9,7 s
```

```bash
npx supabase db reset && npx playwright test   # ⚠️ 134/136 — as 2 são flaky (§2.1)
```

`npx eslint e2e --quiet` também limpo — a suíte E2E entra no `npm run lint` e no
`npm run typecheck` (via `tsconfig.e2e.json`).

---

## 9. Arquivos

**Editados**
`docs/demo/roteiro-cliente.md` (reescrito) · `docs/sprints/sprint-demo.md`
(placar final, pendências com dono, "Próxima sprint") · `PLANEJAMENTO.md`
(afirmações desatualizadas) · `supabase/README.md` (a lista "O que ainda falta"
mentia em 3 dos 4 itens) · `scripts/demo.mjs` (§3.6) ·
`e2e/helpers/negocio.ts` · `e2e/anonimo/login.anonimo.spec.ts` ·
`e2e/admin/{allowed-ips,dashboard-meta,fechamento-mes,gamificacao,pipeline-negocio,rotas-positivas}.spec.ts` ·
`e2e/broker/negocio-participantes.spec.ts` · `e2e/sdr/remarketing.spec.ts`

**Criados**
`docs/demo/caminho-da-demo.mp4` · `docs/design-system/smoke-j-*.png` (12) ·
este handoff.

**Nada em `src/`.** **Nada commitado.**

---

## 10. Para quem pegar isto amanhã

1. **Faça os três itens da §0** — sem eles não há demonstração.
2. **A suíte E2E não está verde.** O placar da §2.1 diz onde. Nenhuma falha
   restante é defeito de produto; são telas que mudaram e testes que ainda não
   sabem disso.
3. **`e2e:remote` precisa de faxina antes de voltar a ser usado** (§2.3): os 10
   usuários e as 2 equipes que ele cria ficam no banco.
4. A lista do que sobrou aberto, com dono, está em `docs/sprints/sprint-demo.md`,
   junto com a seção "Próxima sprint".
