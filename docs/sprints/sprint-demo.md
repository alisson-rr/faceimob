# Sprint Demo — 21 a 26/08/2026

**Objetivo:** o cliente (Douglas) entra sozinho numa URL e navega pelo app com dados
convincentes, visual novo (escuro, paleta da marca) e celebrações (som + confete).
Não precisa estar 100% — precisa mostrar progresso sem quebrar no caminho dele.

**Caminho da demo:** Login (senha ou código) → Dashboard → Check-in → Leads (atender)
→ Pipeline (mover negócio; venda → confete) → Gamificação (pódio) → visão de corretor
(RoleSwitcher).

Prompts em `docs/prompts/D1-*.md` · handoffs em `docs/prompts/handoff-*.md` ·
auditoria em `docs/auditoria-2026-08-21.md`. Cada agente roda em sessão própria com
contexto limpo e lista de arquivos-dono; validação mínima: `npm run typecheck` ·
`npm run lint` · `npx vitest run` · `npm run build`.

## Tarefas dos agentes

| # | Tarefa | Prompt | Status |
|---|---|---|---|
| A | Fundação visual: tokens, shell, Login (senha + código), kit `shared/`, varredura de cores | `D1-A-fundacao-visual.md` | ✅ entregue 21/08 — ver `handoff-A.md` |
| B | Engajamento: áudio único, confete, `useCelebration`, pódio, correção do fechamento do game | `D1-B-engajamento.md` | ✅ entregue e revisado 25/08 — ver `handoff-B.md` |
| C | Dados de demo na homologação + usuário do cliente com senha + roteiro + **deploy Vercel** | `D1-C-dados-demo.md` | ✅ entregue 25/08 — ver `handoff-C.md`. URL: https://faceimob.vercel.app · falta criar o usuário do cliente (ordem no handoff §4) |
| D | Correções do caminho do corretor (404 da notificação, DISTRATO/QUEDA, CSV, contadores, erros pt-BR, senha em Configurações) + republicar Vercel | `D1-D-correcoes-caminho-corretor.md` | ✅ entregue 26/08 — ver `handoff-D.md`. Republicado em https://faceimob.vercel.app · falta a migration de 1 linha do link da notificação (vai na Tarefa E) e o teste manual do CSV/senha contra o banco |
| E | Migration 0032 — mês-base segue o ciclo do game; um só ponto de fechamento; link da notificação; signup off | `D1-E-ciclo-do-game.md` | ✅ entregue 26/08 — ver `handoff-E.md`. `0032` aplicada na homologação: trigger `deals_default_month_base`, `current_season_month()`, `close_game_season` sem efeito de mês, link do sino corrigido na origem, signup off no `config.toml` · pendência: histórico de migrations do remoto impede `db push` (vai na Tarefa K) |
| F | Tela: Dashboard (kit, gráficos `chart-1..5`, `useQuery`) + republicar Vercel | `D3-F-dashboard.md` | ✅ entregue 26/08 — ver `handoff-F.md`. `Dashboard.tsx` 918 → 228 linhas, 10 blocos em `components/dashboard/`, `lib/{tone,metrics}.ts`, P06 no painel do diretor. Republicado em https://faceimob.vercel.app · 12 capturas em `docs/design-system/dashboard-*.png` (dados da homologação servidos por despejo, não por RLS — §6 do handoff) |
| G | Telas: Check-in + Leads (decompor `Leads.tsx`, abrir lead pela linha, `useQuery`, F12/P14/a11y) | `D3-G-checkin-leads.md` | ✅ entregue 26/08 — ver `handoff-G.md`. `Leads.tsx` 932 → 247 linhas, 16 blocos em `components/leads/`; nome do cliente abre o lead (X06); Check-in acompanha `checkins` por realtime (F12); dropzone de importação funciona (P14); X03/X04/X07/X08/T13/A05 fechados nestes arquivos. Republicado em https://faceimob.vercel.app (`8g15rlext`, bundle `index-PRU1c-di.js`, hash conferido) · 11 capturas em `docs/design-system/{leads,checkin}-*.png` (fixtures **sintéticos**, não a homologação — §7 do handoff) · **pendências:** S06 (`xlsx` com CVE) só registrado, e o `ConvertLeadDialog` está pronto para o H adotar (§5) |
| H | Telas: Pipeline + modal de negócio + CCA (decompor `Pipeline.tsx`, um editor só, etapa com fonte única, participante por id, teclado) | `D4-H-pipeline.md` | ✅ entregue 26/08 — ver `handoff-H.md`. `Pipeline.tsx` 1375 → 281 linhas (44 → 9 `useState`), `CcaPipeline.tsx` 408 → 120, `DealDetailModal.tsx` 577 → 207, 24 arquivos novos em `components/pipeline/`. Fonte única de etapa = `pipeline_stages` (A01, A02, A06, F02, F06, F09, F10, F11, F14, P09, P10, T05, T14, X01–X04, X07, X08). Republicado em https://faceimob.vercel.app · 16 capturas em `docs/design-system/{pipeline,cca}-*.png` (dados sintéticos, não despejo — §15 do handoff) · **pendência para o K: 1 `UPDATE` de limpeza do `cca_stages.color`, SQL no §7 do handoff — não bloqueia, a tela já lê os dois formatos** |
| I | Endurecimento pré-URL (auth no `sdr-agent-chat`, PIN/slug/lockout dos links públicos, signup off, migration 0033) | `D4-I-endurecimento.md` | ✅ entregue 26/08 — ver `handoff-I.md`. 0033 aplicada na homologação, 3 functions redeployadas (401 provado), 3 aposentadas removidas do remoto · **falta você desligar o signup no painel** (Authentication → Sign In / Providers) e clicar em *Gerar PIN* nos 2 links de diretor que estão sem PIN · ⚠️ um buraco confirmado ficou aberto por escopo (`public_daily_submit` não alimenta o lockout — handoff §7.5b, correção de 2 linhas que toca `DailyReport.tsx`) |
| K | Migration 0034 — lockout também no envio do diário (`public_daily_submit`) + `DailyReport.tsx` + histórico de migrations | `D4-K-lockout-submit.md` | ✅ entregue 26/08 — ver `handoff-K.md`. `0034` aplicada e registrada na homologação: recusa vira `NULL` no caminho de escrita, o lockout passa a disparar por `public_daily_submit` (provado por `curl`: 5 chutes travam, a 6ª com o PIN certo é recusada) e `DailyReport.tsx` trata `data === null` como falha. Histórico de migrations **reparado** (25 `applied` + 7 `reverted`): `db push --dry-run` responde "up to date" — destravado para todo mundo · pendem os 2 links de diretor sem PIN (handoff-I §5) |
| L | Dívida residual: trocar o `xlsx` (S06, CVE) e terminar o `describeError` (A05) | `D5-L-divida-residual.md` | ✅ entregue 26/08 — ver `handoff-L.md`. `xlsx@0.18.5` (2 CVEs) → **`read-excel-file@9.3.10`**, com fixture `.xlsx` de verdade e teste que o abre; `describeError` em 64 relances + 73 pontos de tela; `supabase/README.md` e `decisoes.md` atualizados. Não publicou de propósito — o build da J leva as mudanças dela junto (§7 do handoff-L) · **regressão declarada: `.xls` (Excel 97-2003) deixou de ser lido**, com mensagem em pt-BR dizendo o que fazer |
| J | Fechamento: smoke na URL publicada, suíte E2E, roteiro com números reais, vídeo backup, varredura 375 px/claro | `D5-J-fechamento-demo.md` | ✅ entregue 26/08 — ver `handoff-J.md`. **Publicado por último** em https://faceimob.vercel.app (`faceimob-9vmd4uhxa`, bundle `index-DWf46mx_.js`, hash e 8 chunks conferidos — inclui a Tarefa L). Roteiro reescrito com números do banco; vídeo de backup em `docs/demo/caminho-da-demo.mp4` (65 s); varredura das 6 telas × 2 temas × 2 larguras **sem transbordo horizontal e sem erro de console**; comemoração de venda medida saindo **1×** para venda rateada; diário público (PIN certo grava / errado e travado recusam) provado **na URL publicada** · **não entrei logado no app publicado: a conta do cliente não existe** (§1.1 do handoff) |
| M | Defeitos de comportamento do smoke: aviso falso de versão, data do diário, link da notificação | `D6-M-defeitos-smoke.md` | ✅ entregue 27/08 — ver `handoff-M.md`. Detector de versão compara só a entrada (provado nos dois sentidos, servido pelo IP da LAN porque o hook sai cedo em `localhost`); o diário parou de sobrescrever hoje (**medido**: a chamada zerou 7 leads/3 análises/1 venda da linha de hoje sem criar linha para 20/08), rótulos passaram a falar de hoje e Salvar desliga em dia anterior; `resolveLink` virou lista branca com 4 testes. Rolagem horizontal de 463→375 px no diário, de quebra · ⚠️ **causou a perda do `Gamification.tsx`** — `git checkout --` num arquivo nunca commitado (Tarefa Q) |
| N | Piso tipográfico (X07) e cabeçalho a 375 px | `D6-N-tipografia-cabecalho.md` | ✅ entregue 27/08 — ver `handoff-N.md`. Piso decidido: **12 px com uma exceção escrita** (11 px só em rótulo curto CAIXA ALTA com `tracking >= 0.1em` = `.text-eyebrow`); **142 literais saíram de 24 arquivos**; `Badge` ganhou `size="sm"` no lugar de 11 remendos; `src/lib/type-scale.test.ts` cobra a regra e **foi provado que reprova**. Cabeçalho a 375 px: causa raiz era `shrink-0` anulando o `truncate` no título do `AppLayout`, não o `w-[150px]` — **sino cortado 8/16 → 0/16, avatar 16/16 → 0/16**; o aviso de pré-visualização encurtou em vez de sumir. 18 capturas `smoke-n-*` · ⚠️ **§7: apagou e restaurou o `src/index.css`** por `git checkout --` (reconciliado com 4 fontes, `theme-contrast.test.ts` verde) |
| O | Dependências: `react-router` com 4 avisos *high*, resto do `npm audit`, rótulo da temporada | `D6-O-dependencias.md` | ✅ entregue 27/08 — ver `handoff-O.md`. `npm audit --omit=dev` de **10 achados (9 high) → 2 moderate**; `react-router-dom` 6.30.1→6.30.6 sem uma linha de `src/` (conferiu a correção **no código** do `@remix-run/router`, não no rótulo do audit); as 2 que sobram não alcançam este app. **Achado que muda a leitura: 6 dos 7 restantes eram build disfarçado de produção** — entram por `tailwindcss-animate` estar em `dependencies` e puxar o Tailwind pelo peer; o único real era `lodash` (via `recharts`), fechado. Rótulo `July 2026` → `Julho 2026` na homologação; a origem é `to_char(..., 'TMMonth')` numa migration (sem dono). **Publicou** `index-oQLdfviq.js`, hash conferido no ar |
| P | Rede de segurança E2E: perder negócio, teclado, faxina do `e2e:remote` | `D6-P-rede-e2e.md` | ✅ entregue 27/08 — ver `handoff-P.md`. **136 → 147 testes, 142 passam**; as 5 falhas são todas a Gamificação fora do kit (Tarefa Q), e as 2 flaky da J passaram. **Corrigiu a premissa do meu enunciado com medição**: `trava-atendimento` não perdia o lead por causa do cron — perdia a *página*, porque o modal do `NewLeadNotifier` deixa 14 nós `aria-hidden`. `deprovisionE2EUsers()` entregue e provado (14/2/14 antes e depois); **descobriu que o teardown do Playwright NÃO roda no Ctrl+C** e fechou o buraco onde dói: `fechamento-mes` não roda no alvo remoto. Arrastar com mouse ficou coberto (15/15 com `--repeat-each=3`) · 4 defeitos de produto achados e **nenhum corrigido**, como pedido |
| Q | 🔴 Restaurar a tela de Gamificação (perdida por `git checkout --`) e republicar | `D7-Q-restaurar-gamificacao.md` | ✅ entregue 27/08 — ver `handoff-Q.md`. A tela voltou: o arquivo da B **compilou sem um único ajuste** contra a árvore de hoje. **E achou o que eu tinha pedido:** a Tarefa L (26/08) também tinha editado este arquivo e perdeu junto — recuperou as 4 substituições de `describeError` do transcript da L e aplicou. Os 5 testes da P ficaram verdes; suíte completa **147/147**. Varreu o repo por 5 ângulos com controle negativo e provou que **só este arquivo** se perdeu. Publicou `index-B7h7QudJ.js` |
| R | Perda de negócio: "19. REPROVADO" escapa da confirmação e o motivo vem pré-escolhido | `D7-R-perda-negocio.md` | ✅ entregue 27/08 — ver `handoff-R.md`. **Refutou a opção que eu recomendava**, chamador por chamador: pôr `REPROVADO` em `Status1` não consertaria nada (o `if` lista constantes soltas) e só armaria o `isPerda`, que é código morto — "mudança de número que a diretoria vê sem aviso, só que diferida". Criou `LOSS_REASONS` + `isLossStatus` em `dealStatus.ts`, uma lista onde havia quatro. Achou um **segundo buraco no mesmo rótulo** (o preset do diálogo trocava o motivo escolhido pelo mais forte). Corrigiu também dois números meus: o catálogo tem 32 rótulos, não 19, e 3 viram `Status1`, não 5. +7 unitários, +1 E2E |
| S | Terminar a varredura: restos do `NotificationBell`, transbordo de 137 px no Checkpoint | `D7-S-restos-varredura.md` | ✅ entregue 27/08 — ver `handoff-S.md`. `PENDENTE_DE_OUTRA_TAREFA` **vazia**, `grep` de literal volta vazio; `resolveLink` mudou para `src/lib/notificationLink.ts`; Checkpoint de **137 px → 0** nos dois temas — e corrigiu a N: era **uma** causa, o `BrandMotif` era falso positivo (estava clipado); `bg-black/40` → `bg-muted` com o par **entrando** no teste de contraste · 🔴 **achou o popover do sino invisível** (cortado pelo `overflow-hidden` do `<header>`), diagnosticou, mediu a correção em 18 combinações e **não consertou** porque o arquivo não era dela (Tarefa T) |
| T | O popover do sino não aparece; o pódio escreve número sem formatar | `D8-T-sino-e-podio.md` | 🟡 **item 1 (sino) feito pelo copiloto em 27/08 e publicado** (`index-D14OuzYD.js`) — sobra só o item 2, o `num()` do pódio |
| U | Esteira Ágil: o rótulo permite pular a conferência; a demo não mostra o passo; `August 2026` | `D8-U-esteira-agil.md` | ⏳ pronta — roda em paralelo com T |

## Tarefas do usuário (só você tem credencial)

- [x] ~~`SUPABASE_SERVICE_ROLE_KEY` no ambiente da sessão do C~~ — não foi preciso: o `showcase` aplica SQL por `supabase db query --linked` (Management API), sem service role key nem senha de banco
- [x] ~~Vercel: `npx vercel login` **ou** `VERCEL_TOKEN`~~ — a CLI já estava logada; publicado em https://faceimob.vercel.app
- [x] ~~Decidir a Tarefa E~~ — aprovada em 25/08: mês-base segue o ciclo aberto
- [x] ~~**Publicar o build pendente**~~ — resolvido: as Tarefas G/H/K publicaram; o hash servido pela Vercel bate com o do `dist/` local (conferido 26/08)
- [ ] 🔴 **Desligar o auto-cadastro no painel do remoto** (Authentication → Sign In / Providers → "Allow new users to sign up"). O `config.toml` só vale para o stack local — é o item mais urgente com a URL pública (handoff-I §5)
- [x] ~~🔴 **Gerar PIN nos 2 links de diretor sem PIN**~~ — **feito pelo copiloto em 27/08.** Os **4** links agora têm PIN (`links_sem_pin = 0`, reconferido 01/09): `seed-daily-paulista` 112233 · `seed-daily-sul` 445566 · `seed-diretoria-daniela` 246810 · `diretor-ricardo-sampaio` 135790. Os três principais foram provados por HTTP (200 com dado real)
- [x] ~~🔴 **Criar o usuário do cliente e testar o login real**~~ — **feito pelo copiloto em 27/08.** `controle@faceimob.com.br` existe com os 4 papéis (`admin, broker, director, manager`) e o login por senha foi exercitado de verdade (a medição do sino entrou logada com ela)
- [ ] 🔴 **Rodar o cenário dentro da janela de um turno, pouco antes da demo.** Às 19h20 havia **0 presenças abertas** — o Check-in abre com a fila vazia. E `showcase` sozinho **não recria** a presença: os check-ins têm UUID fixo com `on conflict do nothing`, então precisa de `showcase:limpar` antes (handoff-J §3.5)
- [ ] Pedir `logo-faceimob-dark.png` à marca (hoje o logo claro é a arte branca sobre placa azul)
- [ ] Ouvir os 6 sons uma vez (nenhuma máquina do harness tem áudio; handoff-B §9.1) e apertar "Fechar Gameficação" numa temporada de teste na homologação antes da demo (handoff-B §9.3)
- [ ] Antes da demo ao vivo: `node scripts/demo.mjs preparar --remote` + `demo:lead` para a trava de 5 min (handoff-B §9.2)
- [ ] SMTP (Brevo) + template do código no painel do Supabase — desejável, não bloqueia (o cliente entra por senha)
- [x] ~~Confirmar `supabase db push`~~ — resolvido na Tarefa K: o histórico do remoto foi reparado (25 `applied` + 7 `reverted`) e `npx supabase db push --dry-run` responde "Remote database is up to date"

## Aplicado direto na homologação pelo copiloto

- **26/08 — T14, `cca_stages.color`.** O `UPDATE` de normalização ficou sem dono: a Tarefa K entregou antes da H e o SQL saíu no `handoff-H.md` §7. Conferindo o banco, as 6 linhas guardavam **hex** (`#fbbf24`, `#34d399`…) — formato que nenhum ramo daquele SQL cobria e que o `ccaStageTone` também não reconhece: **a esteira CCA inteira estava cinza no ar**. Apliquei o SQL com um ramo a mais para hex. Resultado: `danger, warning, info, info, success, danger`. Dois pares ficaram no mesmo tom porque a paleta tem 6 tons para 6 etapas; dá para separar pelo editor de estágio da própria tela.

## Validação do copiloto — 26/08, depois de J e L

Rodei a suíte inteira por conta própria em vez de aceitar os handoffs. **Bate tudo:**
`npm run typecheck` limpo, `npm run lint` 0 erros / 7 avisos pré-existentes,
**183 testes em 12 arquivos**, `npm run build` em 10,2 s, e o bundle no ar
(`index-DWf46mx_.js`) idêntico ao do `dist/` local. O `xlsx` sumiu do
`package.json`, do `src/` e do `npm audit`. O vídeo de backup é MP4 H.264 válido,
**65,5 s**. As 12 capturas `smoke-j-*` existem.

Três coisas que os handoffs não pegaram:

- 🔴 **`react-router-dom@6.30.1` carrega 4 avisos *high* de redirecionamento aberto
  e XSS — e é dependência de produção.** Nenhuma tarefa olhou para isso porque o
  enunciado da L falava só do `xlsx`. **Medi o remédio:** subir para **`6.30.6`**
  (patch, sem mudança de código) fecha **7 dos 9** avisos, incluindo **todos os
  *high*** — o `@remix-run/router` vai a `1.23.4`, acima da faixa vulnerável
  `<=1.23.2`. Sobram 2 *moderate* que só o v7 fecha, e nenhuma delas alcança este
  app (ver `D6-O-dependencias.md`). O `npm audit fix` **sem `--force` não faz isso
  sozinho** — precisa do bump explícito. Vai na Tarefa O.
- 🔴 **O diário público grava o dia errado quando se edita um dia anterior.**
  `public_daily_submit(p_slug, p_pin, p_entries)` **não recebe data**: o corpo faz
  `insert into daily_reports (team_id, report_date, ...) values (v_link.team_id,
  current_date, ...)`. Mas `DailyReport.tsx` tem estado de `date`, um caminho de
  Histórico e o aviso "Editando um dia anterior: <data>" — e o `submit` (:290-312)
  **nunca manda essa data**. Editar 20/08 sobrescreve o checkpoint de hoje, em
  silêncio. A J viu metade disso (§3.2, o rótulo "ontem"); a outra metade é perda
  de dado. Vai na Tarefa M.
- 🟡 **`NotificationBell.tsx:23` navega para o que estiver em `notifications.link`
  sem validar.** `resolveLink` só reescreve o formato `/leads/<uuid>`; qualquer
  outra coisa passa direto para o `navigate()`. A policy `notifications_insert`
  permite a **admin, diretor e gerente** inserir notificação para qualquer perfil,
  com `link` livre — então um gerente pode plantar `//site-externo` no sino de um
  corretor. Hoje só triggers do banco escrevem ali, então não está sendo explorado;
  é um guard de uma linha na função compartilhada. Vai na Tarefa M.

Também reconferido no banco agora: os **2 links de diretoria continuam sem PIN**
(e o `diretor-ricardo-sampaio` sem validade nenhuma), a **conta do cliente não
existe** (22 contas `@example.invalid` que nunca logaram + a sua) e a temporada
**"Agosto 2026" está aberta** com `period_end` nulo — que é o modelo correto.

## Validação do copiloto — 27/08, depois de M, N, O e P

**As quatro entregaram e a validação passa inteira:** `npm run typecheck` limpo nos 3 projects,
`npm run lint` 0 erros / 7 avisos pré-existentes, **190 testes em 14 arquivos** (183 → +4 da M,
+3 da N), `npm run build` verde. O que está no ar (`index-oQLdfviq.js`) **bate** com o `dist/`
local e leva M, N e O. `Julho 2026` corrigido no banco. Nenhuma conta `e2e.*` sobrou na
homologação — a P nunca rodou contra o remoto, como mandado.

**A qualidade das quatro foi acima do enunciado em três pontos que merecem registro:** a O
conferiu o diff do `@remix-run/router` em vez de confiar no rótulo do `npm audit`; a P **refutou
com medição** a causa que eu tinha escrito para o `trava-atendimento` (não era o cron, era o
modal deixando a página `aria-hidden`); e a M mediu a perda de dado do diário em vez de deduzi-la.

### 🔴 O acidente: `src/pages/Gamification.tsx` foi apagado

**A cadeia, reconstruída dos três handoffs e conferida no repositório:**

1. A **Tarefa M** precisava provar que o detector de versão dispara num build novo. Para isso
   pôs um comentário em `src/pages/Gamification.tsx` — arquivo que **não era dela** — porque
   era o que vivia num chunk lazy. Depois desfez com `git checkout --` (handoff-M §1).
2. O arquivo **nunca foi commitado**. `git checkout --` não desfez o comentário: trocou o
   arquivo pela versão do último commit, **apagando a remontagem no kit que a Tarefa B tinha
   feito em 23/08** (`handoff-B.md` §8: "`Gamification.tsx` (remontada no kit; fechamento;
   ciclo real)").
3. A **Tarefa N** viu o typecheck quebrar, diagnosticou certo ("o arquivo está idêntico ao
   HEAD"), repôs **a única linha** que fazia o typecheck passar e disse que não tinha como
   garantir que era só ela (handoff-N §6.4).
4. A **Tarefa P** mediu a consequência sem saber da causa: **5 testes E2E vermelhos**, todos
   cobrando o kit naquela tela, e **recusou-se a reescrever os seletores** para maquiar o
   placar (handoff-P §7.1). Foi a decisão certa.
5. A **Tarefa O** publicou às 11h08 — ou seja, **a tela quebrada está no ar agora**.

**Conferido por mim:** `git diff --stat -- src/pages/Gamification.tsx` dá `1+/1-` enquanto
`Pipeline.tsx` dá `226+/1320-` e `Leads.tsx` `205+/844-`; o arquivo tem **zero** referências a
`Podium`, `SectionCard`, `PageHeader` ou `num()`, e é a única tela assim.

**Recuperável, e o conteúdo já foi achado.** O `Write` original está no transcript da sessão da
Tarefa B (`7e39eab8-…jsonl`, linha 386): **22 619 bytes, 539 linhas**. Conferido que ele importa
só símbolos que existem na árvore de hoje (`closeMonthAndSeason`, `openGameSeason`, `monthStart`,
`SectionCard`, `PageHeader`, `Podium`, `num`) e que **não tem nenhum literal de fonte nem de
paleta** — ou seja, passa no `type-scale.test.ts` que a N acabou de criar. O typecheck em cima
dele **não foi rodado** (a Tarefa Q roda). Vai na **Tarefa Q**.

### 🔴 A causa raiz é anterior ao acidente: **158 arquivos não commitados**

O `git status` tem **158 entradas**, e entre elas diretórios inteiros de trabalho novo que só
existem na árvore: `src/components/{shared,pipeline,engagement,dashboard,leads}/`,
`src/lib/engagement/`, `docs/prompts/`, `docs/design-system/`, `e2e/global-teardown.ts`.

Enquanto isso for verdade, **`git checkout --` não é desfazer, é apagar** — e um `git clean -fd`
levaria a sprint inteira. Aconteceu duas vezes hoje (o `index.css` da N e o `Gamification.tsx`
da M) e as duas vezes foi um agente tentando desfazer uma alteração temporária, que é a operação
mais banal que existe.

**Consequência de commitar:** `git checkout --` volta a significar "desfazer", os agentes ganham
uma rede, e um `git diff` passa a mostrar só o que a rodada mudou. **Consequência de não
commitar:** a próxima tarefa que precisar desfazer alguma coisa temporária tem chance real de
apagar trabalho de novo, e desta vez pode ser num arquivo que ninguém repare.

### Defeitos de produto que a P achou e não corrigiu (`src/` não era dela)

- 🟠 **"19. REPROVADO" escapa da confirmação de perda.** `normalizeStatus` tira o prefixo
  numerado e devolve `"REPROVADO"`, que não está em `Status1` — então `changeStatus` cai no
  `update` direto. Só que "19. REPROVADO" **é um dos quatro motivos que o próprio
  `LoseDealDialog` oferece**: escolhido no diálogo encerra o negócio; escolhido no Select da
  tabela grava o status e o negócio **continua ativo no funil e no VGV**. Conferido em
  `useDealActions.ts:69` e `LoseDealDialog.tsx:20`. Vai na **Tarefa R**.
- 🟡 **"Motivo obrigatório" é, na prática, "motivo pré-selecionado":** o Select nasce em
  `LOSS_REASONS[0]` = "17. DISTRATO", o rótulo mais forte da lista. Vai na **Tarefa R**.
- 🟠 **Transbordo de 137 px no Checkpoint a 375 px** (achado da N §6.1, nos dois temas): a
  barra de 4 botões + `Select w-56` não quebra linha, e o `BrandMotif` vaza por falta de
  `overflow-hidden` no pai. **Consertar só um deixa 123 px.** Vai na **Tarefa S**.
- 🟡 O modal do `NewLeadNotifier` deixa a página inteira `aria-hidden` enquanto está aberto.
  Comportamento correto de modal, consequência real para o corretor. Anotado, sem dono.

### Pendências herdadas com dono nomeado

`resolveLink` deveria morar em `src/lib/` (apaga um `eslint-disable` e o `vi.mock` do teste) ·
os 4 literais do `NotificationBell` e a linha `PENDENTE_DE_OUTRA_TAREFA` do `type-scale.test.ts`
· `bg-black/40` em `MetaAdsSetup.tsx:117` — **todos na Tarefa S**. O `to_char(..., 'TMMonth')`
do `close_game_season` e a correção histórica do diário (handoff-M §6) são **migration**, e
migration segue sem dono nesta rodada.

## Validação do copiloto — 27/08, depois de Q, R e S

**As três entregaram.** `npm run typecheck` limpo, `npm run lint` 0 erros / 7 avisos
pré-existentes, **199 testes em 15 arquivos** (190 → +7 da R, +2 líquidos da S), `npm run build`
verde. **Tudo já está no ar:** reconstruí a árvore atual e o hash saiu `index-B7h7QudJ.js`,
idêntico ao que a Vercel serve — ou seja, o build da Q levou R e S junto.

**🟢 O repositório foi commitado** (`5943b45`, 27/08 14:08, já em `origin/nova`): 158 arquivos
soltos viraram zero. A causa raiz dos dois acidentes de ontem está fechada — `git checkout --`
voltou a significar "desfazer".

**As três fizeram a coisa que mais importa: não acreditaram no enunciado.**

- A **R** refutou a opção que eu recomendava, conferindo chamador por chamador, e mostrou que ela
  não consertava o defeito e ainda armava uma bomba no `isPerda`. Corrigiu dois números meus de
  passagem.
- A **S** corrigiu a N: o transbordo do Checkpoint tinha **uma** causa, não duas — o `BrandMotif`
  aparecia na medição por estar clipado, e consertar só a causa 1 dá **0**, não 123.
- A **Q** respondeu a pergunta que eu tinha posto como "pode ser o item mais valioso do handoff":
  **sim, havia mais trabalho apagado.** A Tarefa L também tinha editado o `Gamification.tsx` em
  26/08 (`describeError`), e o `git checkout --` levou as duas camadas. Recuperou as 4 substituições
  do transcript da L e aplicou.

### O método que a Q deixou, e que vale guardar

Procurar trabalho apagado varrendo transcript por `tool_use` com `file_path` **é cego**: não alcança
subagente (fica em `<sessao>/subagents/workflows/wf_*/`) e não vê edição aplicada por `Bash`, que
não tem `file_path`. A Q quase concluiu "a L super-declarou" com evidence que parecia forte — e
salvou-se rodando um **controle**: aplicou a mesma busca a um arquivo que sabidamente tinha a
alteração, e deu zero também. **O ângulo que funciona é outro: cruzar o que cada handoff declara
ter feito contra o que o arquivo tem hoje.** Foi assim que ela achou.

### 🔴 O que sobrou desta rodada

- **O popover do sino é invisível.** Está no ar. O painel existe, tem 363 px, e o
  `overflow-hidden` do `<header>` (64 px) deixa **9 px visíveis**. Clicar no sino parece não fazer
  nada. A S mediu a correção (`overflow: visible` no header) em 18 combinações: `transbordo=0`,
  `erros=0`. E descartou o caminho óbvio: `position: fixed` **não** resolve, porque o
  `backdrop-blur` da `.glass` faz do header um *containing block*. Vai na **Tarefa T**.
- **O pódio escreve `2440` e a tabela `2.440`, na mesma tela.** É o primeiro elemento visual da
  Gamificação. Vai na **Tarefa T**.
- **`August 2026` no cabeçalho da Gamificação.** A O corrigiu o dado; a origem é o
  `to_char(..., 'TMMonth')` do fechamento automático. Vai na **Tarefa U**.

## Validação do copiloto — 01/09, estado de partida da próxima rodada

Reconferido **no banco e no repositório**, não nos handoffs:

| O que | Estado hoje |
|---|---|
| Conta do cliente | ✅ `controle@faceimob.com.br`, papéis `admin, broker, director, manager` |
| Links públicos | ✅ **4 de 4 com PIN** (`pin_hash` não nulo) |
| Sino (popover invisível) | ✅ corrigido e **no ar** (`index-D14OuzYD.js`, hash conferido) — item 1 da Tarefa T |
| IPs de check-in | 5 ativos + **1 desativado** (a regra `0.0.0.0/0` que eu tinha aberto; desligada a pedido, um clique religa) |
| Auto-cadastro no painel | 🔴 **continua ligado** — só você consegue desligar |
| Temporada do game | `Agosto 2026` aberta (`period_end` nulo), que é o modelo correto |
| Cofre de credenciais | 4 entradas, **todas internas** (`brevo.api_key`, `brevo.sender_email`, `supabase.functions_url`, `supabase.service_role_key`). **Nenhuma chave de terceiro do Douglas**: sem OpenAI e sem Meta, o SDR por IA e o WhatsApp não têm como rodar |
| Conferência documental | **0 `pending`**, 7 `draft`, 25 `approved` — o passo continua invisível na demo (Tarefa U) |
| Presenças abertas | **0** — o Check-in abre com a fila vazia até rodar o cenário dentro da janela do turno |
| Fila de notificações | **151** represadas (eram 77 em 26/08) — não despausar o cron sem limpar |

**Suíte:** 199 testes em 15 arquivos, `typecheck` limpo, `lint` 0 erros / 7 avisos
pré-existentes, `build` verde. Árvore commitada em `5943b45`; o que está solto
hoje é o conserto do sino, as 4 capturas e os dois prompts D8.

## Rodadas 9 e 10 — 01/09, "o app todo funcional"

**A linha de chegada mudou** (decisão registrada em `decisoes.md` 01/09): não é mais a demonstração,
é o aplicativo funcional em todas as telas, funções, fluxos e perfis. Para saber o que falta de
verdade, rodei uma **auditoria funcional das 24 telas** com 12 agentes em modo somente leitura e um
cético adversarial em cima de cada achado (104 agentes, 25 min): **92 achados brutos → 86 confirmados,
6 refutados.** O JSON completo, com evidência e conserto por achado, está no scratchpad desta sessão
(`auditoria.json`); a lista por tela vai para os handoffs das frentes.

| Grupo | Confirmados | quebrado | vazio | perfil |
|---|---|---|---|---|
| `admin_operacao` | 8 | 6 | 0 | 2 |
| `admin_seguranca` | 4 | 2 | 0 | 2 |
| `cca` | 5 | 3 | 1 | 1 |
| `checkin` | 5 | 2 | 2 | 1 |
| `dashboard` | 7 | 4 | 2 | 1 |
| `diario` | 11 | 11 | 0 | 0 |
| `game` | 4 | 2 | 0 | 2 |
| `leads` | 6 | 5 | 1 | 0 |
| `marketing` | 9 | 9 | 0 | 0 |
| `pipeline` | 7 | 6 | 0 | 1 |
| `sdr` | 12 | 9 | 1 | 2 |
| `sistema` | 8 | 4 | 1 | 3 |

**Refutados pelo cético (não são defeito):** Gerente 1 vazio para corretor no formulário do negócio;
gerente arrastando para "Em análise"; Realocar para marketing; permissão do aporte por papel de maior
precedência; `window.prompt` na Automação; colunas do formato Leadfy.

### Como está sendo feito

Eu implemento direto, por workflows, com **arquivos-dono disjuntos** entre agentes e revisão
adversarial (duas lentes: correção+segurança, UX+kit+a11y) seguida de correção, por frente. Banco
remoto, Storage, deploy de functions e Vercel ficam comigo — nenhum agente vê segredo.

| Rodada | Frentes | Estado |
|---|---|---|
| **9** — escopo fechado | `atividades` (tela + `menu.atividades`, 0036) · `meta-global` (Equipes) · `esteira-agil` (0037: rótulo escrito pelo sistema; seed `pending`/`returned`; roteiro) · `meta-ads` (tela lê o cofre; sem token hardcoded) · `gamificacao` (pódio `num()`; 0035 rótulo pt-BR) · `documentos-storage` (script sobe 69 PDFs) | ⏳ rodando |
| **10-A** — auditoria, telas livres | `diario` (11; 0038, 0039) · `sdr` (12; 0040) · `leads` (7; 0041, 0042) · `admin-operacao` (6; 0043) · `admin-seguranca` (4; 0044) · `checkin-checkpoint` (5) · `marketing-dados` (13; 0045) · `game-resultados` (4) · `broker-modal` (2; 0046) · `cca` (2; 0047) | ⏳ rodando |
| **10-B** — auditoria, telas que a 9 está editando | `dashboard` (6) · `pipeline` (7, inclui `CcaMoveDialog`) · `equipes` (3) · `App.tsx` (login de CCA/SDR/Marketing cai em "Acesso não liberado") | ⏸ espera a 9 terminar |

**Numeração de migrations já atribuída:** 0035 rótulo pt-BR · 0036 menu.atividades · 0037 guarda do
rótulo Esteira Ágil · 0038–0039 diário · 0040 SDR · 0041–0042 leads · 0043 automação · 0044 permissões ·
0045 menu marketing/dados · 0046 campos do perfil · 0047 storage CCA + envio sem construtora.

**Depois das rodadas, comigo:** `db push` → regenerar `types.ts` → `showcase --remote` → subir os
PDFs → deploy das functions alteradas → typecheck/lint/vitest/build → E2E no remoto → publicar.

## Fechamento — 02/09, publicado

**No ar:** https://faceimob.vercel.app · bundle `index-OpDEuXsg.js`, hash conferido
contra o `dist/` local · HTTP 200.

| Validação | Resultado |
|---|---|
| `npm run typecheck` | limpo nos 3 projects |
| `npm run lint` | 0 erros, 7 avisos pré-existentes |
| `npx vitest run` | **296 testes em 30 arquivos** (começou em 199/15) |
| `npm run build` | verde, 8,5 s |
| **E2E contra a homologação** | **223 passando, 0 falhando**, 8 pulados |
| Migrations aplicadas | **51** (as de numeração 0035–0053 desta sprint; 0042 e 0049 nunca chegaram a existir) |

### O caminho do E2E: 19 → 10 → 1 → 0

Quatro passadas, e cada rodada de falhas revelou um defeito de produto — nenhum
foi "ajustar o teste até passar":

1. **19 falhas → a 0051.** Oito testes com "o modal do negócio não fecha" eram
   um defeito só: a 0037 revogou `deal_status_bare` de `authenticated`, e o
   gatilho `deals_guard_esteira_label` (SECURITY INVOKER) a chama em **todo**
   write de `deals` → 403 em criar, editar, perder, mover etapa. A correção
   "óbvia" (tornar o gatilho DEFINER) teria deixado a suíte verde **desligando a
   proteção**, porque o escape do guard é `current_user not in ('postgres',
   'service_role')`.
2. **10 falhas → a 0052.** O corretor podia arrastar negócio para "Aprovado" e o
   gerente não — o inverso da regra de crédito. Duas travas para o mesmo fato
   discordavam: `deals_guard_stage()` recusava, a matriz permitia.
3. **1 falha → a 0053.** O SDR podia cadastrar negócio manual e levar 100% do
   rateio de VGV, porque `handle_new_auth_user` dá `broker` a todo perfil novo.
   A 0048 afirmava por escrito que isso era impossível; o teste provou 201 onde
   deveria haver 403.
4. **6 falhas de SDR → nenhuma.** `TypeError: fetch failed`: instabilidade de
   rede. Reexecutado o projeto isolado: **20/20**. Não virou correção de código.

### Defeitos que só a aplicação revelou

Nenhum agente os viu, porque agente valida com typecheck/lint/vitest e não
aplica seed nem abre sessão autenticada contra o banco:

- **O mesmo erro de semente, quatro vezes:** id fixo com dado que depende do mês
  (temporada, diário, aportes, metas). O `on conflict do nothing` transformava
  "não consegui" em "não fiz nada", em silêncio. Nas metas, o cartão do Dashboard
  voltava a mostrar "—".
- **A 0037 travou o rótulo de esteira e não retroalimentou** quem já estava no
  CCA: a tela deixou de permitir marcar à mão *e* não mostrava quem tinha ido.
  Fechado pela 0050.
- **O seed recriava o link de diretoria sem PIN**, divergindo em silêncio da
  homologação corrigida à mão em 27/08.

### Continua só com você

1. **Desligar o auto-cadastro** no painel do Supabase (Authentication → Sign In /
   Providers → "Allow new users to sign up").
2. **Cadastrar as chaves de OpenAI e Meta** em Admin → Integrações. O cofre tem 4
   entradas, todas internas — sem elas o SDR por IA e o WhatsApp não rodam.
3. **Rodar o cenário dentro da janela de um turno** antes de mostrar o Check-in:
   `node scripts/demo.mjs showcase:limpar --remote` e depois `showcase --remote`.

## Aplicado na homologação — 02/09

**14 migrations no banco** (`0035`–`0048` + a corretiva `0050`), tipos regenerados,
cenário semeado, Storage preenchido, functions no ar. Conferido por consulta, não por handoff:

| O que | Antes | Depois |
|---|---|---|
| Migrations aplicadas | 34 | **48** |
| Permissões de menu | 20 | **21** (`menu.atividades`) |
| `daily_entries.sales` | `integer` | **`numeric`** — meio ponto passa a ser aceito |
| `daily_reports.filled_by_name` | não existia | **existe** |
| `profiles.cpf` (e demais campos do modal) | não existia | **existe** |
| `season_label_ptbr('2026-08-15')` | — | **"Agosto 2026"** |
| Temporada aberta | "Agosto 2026" | **"Setembro 2026"** — em pt-BR, pela função |
| Negócios aguardando conferência | 0 | **1 `pending` + 1 `returned`** |
| Negócios rotulados "ESTEIRA AGIL" | 0 | **3**, escritos pelo banco |
| Documentos com arquivo no Storage | **0 de 75** | **75 de 75**, 0 órfãos |
| Edge functions | — | `sdr-agent-chat`, `sdr-whatsapp-broadcast`, `meta-ads-webhook` |

**Trava de JWT provada depois do deploy** — as duas do SDR respondem **401** sem
credencial e o webhook da Meta responde **403** com token errado. Deployei sem
`--no-verify-jwt` de propósito: as duas do SDR não estão na lista de
`verify_jwt = false` do `config.toml`, e a flag as republicaria como superfície
anônima, desfazendo o endurecimento da Tarefa I.

### Dois defeitos que só apareceram ao aplicar

Nenhum agente os viu, porque nenhum agente aplica seed. Apareceram na primeira
execução real **depois da virada do mês**, e os dois eram silêncio:

1. **O seed ficava sem temporada aberta.** O id fixo da temporada colidia com a
   que o próprio bloco acabara de encerrar; o `on conflict do nothing` engolia a
   colisão e o erro só aparecia 150 linhas adiante, como violação de not-null em
   `game_events`.
2. **O diário só era idempotente dentro do mesmo dia.** `on conflict (team_id,
   report_date)` não cobre a chave primária, e o id era fixo.

Detalhe e correção em `decisoes.md` (02/09). O terceiro foi a **0050**: a 0037
travou o rótulo de esteira mas não retroalimentou quem já estava no CCA — a tela
deixou de permitir marcar à mão *e* não mostrava quem tinha ido.

## Estado em 02/09 — o que as rodadas entregaram

**Árvore:** `npm run typecheck` limpo · `npm run lint` 0 erros / 7 avisos pré-existentes ·
**258 testes vitest em 24 arquivos** (eram 199) · 133 arquivos alterados ou novos.
Cópia de segurança fora do git em `_recuperacao-faceimob/2026-09-02-rodadas-9-10/`.

**13 migrations novas, escritas mas ainda NÃO aplicadas** (`0035`–`0047`):

| # | O que faz |
|---|---|
| 0035 | rótulo da temporada em pt-BR (`season_label_ptbr`); mata o "August 2026" na origem |
| 0036 | `menu.atividades` + concessões |
| 0037 | "ESTEIRA AGIL" vira rótulo escrito pelo banco; escrita manual recusada |
| 0038 | diário: `filled_by_name`, meio ponto (`numeric(6,1)`), `public_daily_submit` com notas, `public_daily_team` com mês |
| 0039 | checkpoint da diretoria: gerente por equipe e bloco do mês |
| 0040 | SDR: modelo da OpenAI corrigido nos agentes + handoff |
| 0041 | leads da fila: `update`/`insert`/`select` com o mesmo predicado |
| 0043 | automação de leads: tempo máx. por etapa e a rotina que lê "sem resposta" |
| 0044 | permissões de funcionalidade passam a ser aplicadas de verdade |
| 0045 | menu: gerente ganha Marketing; Dados sai de corretor/CCA/SDR |
| 0046 | campos do perfil (CPF, CRECI, endereço…) que o modal fingia gravar |
| 0047 | policy do Storage para o papel CCA + envio ao gerente exige construtora |
| 0048–0049 | rateio do criador do negócio · cadastro de colaborador *(rodada 11, em curso)* |

**Auditoria:** 86 defeitos confirmados por 12 auditores + cético adversarial.
Endereçados até aqui: **68**. Em curso na rodada 11: os 16 restantes (Pipeline 8,
Dashboard 6, Equipes 3, login 1) mais a primeira revisão de 4 frentes e 8 achados
de revisão que ficaram sem aplicar quando o limite de uso cortou as rodadas.

### O que falta depois que a rodada 11 fechar — tudo comigo

1. `npm run typecheck` · `lint` · `vitest` · `build` na árvore final
2. `supabase db push` das 15 migrations
3. `supabase gen types` — `types.ts` é gerado; há casts locais esperando por ele
4. `showcase --remote` (cenário `pending`/`returned` da conferência documental)
5. `db:seed:documents` — sobe os 69 PDFs que faltam no bucket `deal-documents`
6. deploy de `sdr-agent-chat`, `sdr-whatsapp-broadcast`, `meta-ads-webhook`
   — **sem `--no-verify-jwt`**: as duas do SDR exigem JWT desde a Tarefa I, e a
   flag as republicaria como superfície anônima. Provar 401 depois.
7. E2E contra a homologação · publicar na Vercel

**Continua só com você:** desligar o auto-cadastro no painel (Authentication →
Sign In / Providers) e cadastrar as chaves de OpenAI e Meta em Admin → Integrações
— sem elas o SDR por IA e o WhatsApp não têm como rodar.

## Esteira Ágil — o passo pedido pelo cliente **já existe**; falta o rótulo e a demo

Pedido: *"uma etapa entre o corretor e o gerente, no envio para Esteira Ágil, para revisão; quem
valida é o gerente do corretor."*

**A migration `0028_document_review` implementa exatamente isso**, e o cabeçalho dela diz o mesmo:
*"Conferência documental entre corretor e gerente"*. Corretor envia por
`submit_deal_for_manager_review` (recusa sem documento obrigatório, recusa sem gerente vinculado,
notifica os gerentes); o gerente decide por `review_deal_documents` (devolução **exige motivo** e
notifica os corretores; aprovação chama `submit_deal_for_analysis` **na mesma transação**).
`deals_guard_stage()` recusa pular para o CCA sem aprovação, e `deals_guard_document_review()`
recusa `update` direto nas 6 colunas. Tem tela (aba **Anexos**: "Aprovar e enviar ao CCA" /
"Devolver"), filtro "Aguardando gerente", contador clicável no Pipeline e **dois specs E2E**.

**E "Esteira Ágil" é esse mesmo evento:** o gatilho de gamificação pontua `'esteira'` quando
`cca_cases.status` vira `'under_review'`, e o rótulo desse evento na tela é literalmente
**"Envio Esteira Ágil"**.

**Três lacunas, e só elas:**

1. 🟠 **O rótulo permite dizer que foi sem ter ido.** `deals.status_detail` é texto livre, sem
   trigger e sem constraint, e o catálogo oferece `"13. ESTEIRA AGIL"` e `"RET. ESTEIRA AGIL"` no
   Select da tabela. Marcar não cria caso no CCA nem pontua — a tela fica verde escrito "ESTEIRA
   AGIL" para um negócio que nunca foi revisado. **Mesma classe do "19. REPROVADO" que a R fechou.**
   Hoje há **0** negócios nesse estado: é buraco estrutural, não incêndio.
2. 🔴 **A demonstração não consegue mostrar o passo.** Medido: **25 `approved`, 6 `draft`, 0
   `pending`, 0 `returned`**. O contador mostra zero, o filtro não devolve nada e o botão de aprovar
   não aparece em lugar nenhum. **Quem abrisse o sistema hoje concluiria que o passo não existe —
   que é provavelmente o que aconteceu.**
3. ❓ **O aprovador é "gerente participante do negócio" (rateio), não "gerente da equipe do
   corretor".** Medido: dos **34** pares corretor×negócio, em **34** o gerente da equipe do corretor
   está entre os gerentes do negócio — **zero divergência hoje**. Mas isso é propriedade dos dados,
   não regra: o formulário deixa nomear qualquer gerente no rateio. **Decisão do Alisson**; a
   Tarefa U mede as situações de divergência e **não mexe na autorização**.

## Pendências abertas ao fim da sprint — com dono

Levantado pela Tarefa J em 26/08/2026, juntando o que G, H, I, K e L deixaram
anotado mais o que o smoke encontrou. **Nada aqui bloqueia a demonstração**, com
a exceção dos três primeiros itens, que são do usuário.

| # | Pendência | Dono | Gravidade |
|---|---|---|---|
| 1 | **Criar a conta do cliente** (`user:create -Password`) e testar o login real. Sem ela o passo 1 do roteiro não acontece | usuário | 🔴 bloqueia a demo |
| 2 | **Desligar o auto-cadastro** no painel do remoto (Authentication → Sign In / Providers) | usuário | 🔴 segurança |
| 3 | **Gerar PIN** nos 2 links de diretor (`seed-diretoria-daniela`, `diretor-ricardo-sampaio`) em Admin · Diário — conferido de novo às 19h20 de 26/08: `pin_hash` continua nulo | usuário | 🔴 segurança |
| 4 | `UpdateNotifier` acusa "Nova versão disponível" em build atualizado (falso positivo visível na demo) | próxima sprint | 🟠 |
| 5 | Suíte E2E: **134 de 136 passam**; as 2 restantes (`broker/trava-atendimento`) passam isoladas — são flaky pelo banco compartilhado com o cron da roleta rodando. Triagem no `handoff-J.md` §2 | próxima sprint | 🟡 |
| 6 | `DailyReport` rotula "ontem" e grava a data de **hoje** | próxima sprint | 🟠 |
| 7 | `seeds/060` cria a presença do check-in com UUID fixo e `on conflict do nothing`: uma vez criada, só volta depois de um `showcase:limpar` | próxima sprint | 🟡 |
| 8 | `describeError` nos ~35 toasts restantes (A05) | próxima sprint | 🟡 |
| 9 | `handle_new_auth_user` concede `broker` a toda conta nova (`0002`) | próxima sprint | 🟡 (inofensivo com signup off) |
| 10 | 77 notificações represadas em `notifications` com o cron pausado — **não despause sem limpar a fila** | usuário | 🟡 |
| 11 | SMTP (Brevo) + template do código no painel; logo do tema claro | usuário | 🟢 |

## Próxima sprint — ponto de partida

Sem prioridade definida: é o apanhado do que as Tarefas G, H, I, K e L
declararam fora de escopo, mais os defeitos que o smoke da J encontrou. Cada
linha diz onde está e por que ficou de fora.

### Defeitos achados no smoke (Tarefa J)

- **`src/components/UpdateNotifier.tsx:17-24` e `:27-35`** — o detector compara
  os assets **carregados na aba** (que incluem os pedaços carregados sob demanda
  pela rota) com os listados no `index.html` (que não os inclui). Toda rota com
  chunk próprio dispara o aviso. A correção provável é comparar só a entrada
  (`/assets/index-*.js`), não o conjunto.
- **`src/pages/DailyReport.tsx:85`** — `const yesterday = new Date()` é hoje. A
  tela rotula "Data (ontem)" e "checkpoint de ontem (26/08)" mostrando a data de
  hoje, e é a data de hoje que vai para `public_daily_submit`. Ou o rótulo está
  errado, ou a data está — é decisão de produto.
- **`src/components/RoleSwitcher.tsx:45,59,74`** e **`src/pages/Login.tsx`
  (divisor "ou")** — `text-[10px]`/`text-[11px]` abaixo do piso de 12 px que o
  X07 estabeleceu. O RoleSwitcher aparece no cabeçalho de todas as telas.
- **`supabase/seeds/060_demo_showcase.sql:982`** — presença do check-in com UUID
  fixo e `on conflict do nothing`. Derivar o id da data resolveria; o arquivo
  não era de ninguém nesta sprint.
- **`game_seasons.label` = "July 2026"** na homologação — rótulo em inglês numa
  tela em pt-BR, herdado do fechamento automático.

### Dívida declarada pelos handoffs

- **G §6** — `Checkin.tsx` (290 linhas) e `LeadDetailModal.tsx` (489) pedem
  `src/components/checkin/` e `LeadDetailTabs.tsx`; dois estilos de toast
  convivendo (`sonner` × `use-toast`); `describeError` no resto do app.
- **H §12** — tipo `Broker` morto em `types/crm.ts` (A11); `pipeline_stages.color`
  ainda em hex e ignorado pelo front; `DealStage` sem a etapa `lost` porque
  `lib/aiAnalytics.ts` a indexa como `Record<DealStage, number>`; **o `main` do
  `AppLayout` deixa transbordo horizontal escapar** — hoje contornado caso a
  caso com `contain: paint`.
- **I §7** — `types.ts` desatualizado para `create_public_link` (há cast local em
  `AdminDailyTeams.tsx`); o 200 do `sdr-agent-chat` no remoto nunca foi
  confirmado com credencial de verdade.
- **K §8** — DoS por lockout é consequência aceita da `0033`; os slugs legados
  (`seed-daily-paulista`, `seed-daily-sul`) continuam derivados do nome; as
  exceções pós-resolve em `public_daily_submit` seguem conhecidas e benignas.
- **Docs fora do alcance desta sprint** — a auditoria lista 14 afirmações
  desatualizadas. `PLANEJAMENTO.md` e `supabase/README.md` foram corrigidos pela
  J; continuam mentindo **`CLAUDE.md`** (18 migrations, 11 functions, plano
  ativo errado), o **`README.md` da raiz** (fala em projeto Lovable),
  `routePermissions.ts:2`, `supabase/tests/01_rls_visibility.sql:4`,
  `.env.example` e o grafo do `graphify-out`.

### Buracos de teste que a Tarefa J encontrou

- **Perder negócio não tem teste nenhum.** Era um interruptor que encerrava o
  negócio em um clique e virou diálogo com motivo obrigatório (F14) — a mudança
  de maior risco do Pipeline, e `grep` por "perder"/"DISTRATO"/"QUEDA" em
  `e2e/**/*.spec.ts` não acha nada. Primeiro da fila.
- **`e2e:remote` precisa de faxina antes de voltar a ser usado.**
  `provisionE2EUsers()` cria 10 contas e 2 equipes no banco alvo e **não existe
  o inverso**: rodar contra a homologação suja a base da demonstração. Um
  `deprovisionE2EUsers()` no `globalTeardown` resolve.
- **O gesto de mover cartão nunca foi exercitado de verdade** — nem o
  arrastar (a suíte dispara `dragstart`/`drop` sintéticos) nem o
  `Shift+←/→` do teclado.
- **`.xls` deixou de ser lido** com a troca do parser (handoff-L §8.1). Não há
  teste cobrando a mensagem de recusa na tela, só no `importSheet.test.ts`.

### O que ninguém começou

- Tela de cadastro de **meta global** (hoje a linha em `goals` entra por SQL).
- **Download de documento** que abra o arquivo (os anexos são registros sem
  arquivo no Storage).
- **Disparo de WhatsApp** — depende de credencial e de limpar a fila represada.
- **Meta Ads: gestão de campanhas** (budget, pausar, copiar) — o maior escopo
  não estimado das atas.
- **King Host** e **IA de voz** — dependem de terceiros.

## Decisões desta sprint (resumo; detalhe em `docs/sprints/decisoes.md`)

- Escuro por padrão; claro secundário. Paleta da marca ajustada por contraste (handoff-A §2).
- Login por senha **e** código — reverte a decisão de 02/08 (senha só existia em texto puro no Bubble).
- Ciclo do game não é mês de calendário: abre e fecha pelo admin (Tarefa E implementa no banco).
- `canvas-confetti` é a única dependência nova; som segue por síntese WebAudio.

> Atualize a coluna Status ao fim de cada tarefa; quem entrega marca ✅ e aponta o handoff.
