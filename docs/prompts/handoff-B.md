# Handoff B — Camada de engajamento

23/08/2026 · branch `nova` · **nada commitado**.
Depende da Tarefa A (tokens e kit em `docs/design-system.md`), já entregue.

---

## 1. A API — `useCelebration()`

Um lugar só decide som, confete e visual. **Nenhuma tela toca som ou dispara confete direto.**

```tsx
import { useCelebration } from "@/components/engagement";

const celebrate = useCelebration();
celebrate("lead_claimed", { title: lead.full_name });
```

```ts
celebrate(kind, payload?)

kind:    "lead_new" | "lead_claimed" | "checkin" | "rank_up" | "sale" | "goal"
payload: {
  id?: string;      // identidade do evento (chave de animação e de dedupe)
  title?: string;   // linha principal — nome do corretor, do lead, da meta
  detail?: string;
  from?: number;    // rank_up: posição anterior
  to?: number;      // rank_up: posição nova
  origin?: Element | { x: number; y: number };  // de onde o confete sai
}
```

A tabela que liga kind → som + confete + visual é **uma só**, em
`src/lib/engagement/celebrations.ts`:

| kind | som | confete | visual |
|---|---|---|---|
| `lead_new` | `leadNew` (2 toques) | — | nenhum (o popup do `NewLeadNotifier` já é o visual) |
| `lead_claimed` | `leadClaimed` (2 notas, curto) | `burst` | toast "Lead em atendimento" |
| `checkin` | `checkin` (1 nota) | — | toast "Check-in confirmado" |
| `rank_up` | `rankUp` (arpejo) | `burst` | toast "Você subiu para Nº X" |
| `sale` | `sale` (fanfarra) | `rain` | card central, 6 s |
| `goal` | `goal` (fanfarra + acorde) | `fireworks` | toast |

Mudar o efeito de uma comemoração é mudar **uma linha** dessa tabela.

`lead_new` não estava na lista do briefing; entrou porque o `NewLeadNotifier`
tocava `playLeadAlert()` direto e a regra "ninguém toca som direto" precisava
de uma porta para ele. Visual `none` justamente porque o popup já avisa.

Também exportado (uso raro, quando não há kind adequado):

```tsx
import { fireConfetti } from "@/components/engagement";
fireConfetti("burst", elementoDeOrigem);   // "burst" | "rain" | "fireworks"
```

---

## 2. Gatilhos

### Ligados (sem precisar de mais nada de ninguém)

Todos por realtime dentro do `EngagementLayer`, num canal só (`engagement-<uid>`):

| kind | fonte | recorte |
|---|---|---|
| `sale` | `game_events` INSERT, `event_code='venda'` | todo mundo logado vê — é o efeito de loja que o cliente pediu |
| `checkin` | `checkins` INSERT `profile_id=eq.<eu>` | só o próprio |
| `lead_claimed` | `lead_events` INSERT `actor_id=eq.<eu>`, `kind='claimed'` | só o próprio |
| `rank_up` | comparação da ordem do ranking (`visible_game_ranking`) | só o próprio, e só quando sobe |
| `lead_new` | `NewLeadNotifier` (realtime de `leads`) | corretor: atribuído a ele · gestor: fila dos grupos dele |

**`lead_claimed` já funciona de qualquer tela.** `claim_lead` grava
`lead_events (kind='claimed', actor_id=auth.uid())` e a tabela está publicada no
realtime (migration `0020`), então o `Leads.tsx` e o `LeadDetailModal.tsx` **não
precisam de nenhuma linha nova** — quem chamar `claimLead()` recebe som, confete
e toast automaticamente.

> Se o agente das telas quiser o nome do lead no toast (hoje ele sai genérico,
> porque `lead_events` não carrega o nome), a linha é:
>
> ```tsx
> const celebrate = useCelebration();          // de "@/components/engagement"
> // depois do await claimLead(lead.id):
> celebrate("lead_claimed", { title: lead.full_name });
> ```
>
> **Cuidado:** isso soma à celebração do realtime (duas). Se for adotar, avise
> para eu tirar o gatilho de `lead_events` — os dois juntos comemoram em dobro.

### Pendente

- **`goal`** — o kind existe, o som e os fogos existem, e **nada no banco publica
  "meta batida"**. Não há tabela nem evento de meta. Quando existir (migration de
  outro agente), é uma assinatura de realtime a mais dentro do `EngagementLayer`
  chamando `celebrate("goal", { title: "..." })`.

---

## 3. Áudio

`src/lib/engagement/audio.ts`. **Um** `AudioContext` para o app inteiro,
destravado no primeiro `pointerdown`/`keydown` da sessão (listener único, que se
remove sozinho).

Antes cada toque criava um contexto novo — e contexto nasce `suspended`, com
`resume()` só valendo dentro de um gesto do usuário. Numa TV de loja, que
ninguém toca, **nenhum som saía nunca**. Medido no navegador: 5 sons seguidos
criavam 5 contextos; agora criam **1** (18 osciladores, exatamente o catálogo).

| export | para quê |
|---|---|
| `playSound(name)` | catálogo: `leadNew`, `leadClaimed`, `checkin`, `rankUp`, `sale`, `goal` |
| `isSoundOn()` · `setSoundOn(on)` · `subscribeSound(fn)` | estado do mudo (o `SoundToggle` lê por `useSyncExternalStore`) |
| `playLeadAlert()` · `playSaleFanfare()` | compatibilidade — continuam funcionando |

Mudo persiste em `localStorage` sob **`faceimob-sound`** (`on` \| `off`).
Com o som desligado, `playSound` sai antes de criar oscilador nenhum.

`src/lib/sound.ts` virou reexport de 1 linha. Pode ser apagado quando ninguém
mais importar `@/lib/sound` (hoje: ninguém; ficou de pé só para não quebrar
agente que estivesse editando outra tela em paralelo).

---

## 4. Confete

`src/components/engagement/Confetti.tsx`, sobre `canvas-confetti`.

- **Cores dos tokens, lidas a cada disparo** — `--primary`, `--highlight`,
  `--success`, `--gold`. O `canvas-confetti` só aceita hex (ele passa a string
  por um `hexToRgb` próprio), então `hslToHex` converte o `"214 72% 62%"` do
  `index.css`. Verificado no navegador: escuro → `#5895e4 #f2c936 #72cba7 #f5c73d`;
  claro → `#2759a5 #f5c114 #207958 #82610d`. Nenhum hex fixo no código.
- **`prefers-reduced-motion` desliga tudo** — checagem própria por `matchMedia`
  (o `MotionConfig` do AppLayout só cobre o framer-motion) **mais**
  `disableForReducedMotion: true` em cada rajada. Medido: 0 canvas com a
  preferência ligada, 1 com ela desligada.
- Canvas é `position: fixed`, `pointer-events: none`, `z-index: 100`.

---

## 5. Pódio

`src/components/engagement/Podium.tsx` — degraus 2-1-3, avatar grande com anel
`gold/silver/bronze`, coroa balançando no 1º, entrada com stagger de baixo para
cima, contagem animada dos pontos e brilho contínuo só no 1º.

```tsx
<Podium entries={top3} />                                   {/* Gamificação */}
<Podium entries={top3} size="sm" onSelect={abrirRecado} />  {/* Pipeline */}
```

Dois consumidores: `Gamification.tsx` e `PipelineTopRanking.tsx` — este último
tinha a configuração de medalha duplicada com `slate-300`/`amber-400`/
`orange-400`, invisíveis no tema claro.

Detalhes que custaram tempo e valem para quem for mexer:

- **A contagem parte do valor anterior**, não de zero: com o realtime somando
  10 pontos, o número anda de 120 para 130 em vez de recomeçar do chão.
- **O brilho contínuo vai num invólucro, não no Avatar.** `animate-glow-pulse` e
  o `ring` do Tailwind escrevem os dois em `box-shadow` — o anel de ouro do 1º
  lugar **sumia** debaixo da animação. Peguei isso medindo o `boxShadow`
  computado no navegador, não olhando o código.
- `ring-offset-card` (não `-background`): o pódio vive dentro de um `SectionCard`.
- `useReducedMotion()` do framer-motion corta coroa, stagger e contagem;
  `animate-glow-pulse` já cai no bloco `@media` de `index.css`.

---

## 6. Gamificação — o que mudou de comportamento

### G01 (crítico): um único ponto de fechamento

O botão "Fechar Gameficação" chamava `closeGameSeason(undefined, true)` →
`close_game_season(p_close_month => true)`, que grava `month_start(current_date)`
em `closed_months` **sem migrar as propostas abertas** (só
`close_month_and_season` faz isso). O trigger `deals_guard_closed_month` passava
então a recusar qualquer insert/update de não-admin em negócio daquele mês-base
**pelo resto do mês**.

Agora o botão chama `close_month_and_season(p_period)` — a mesma RPC do
"Fechar Mês" do Pipeline — com `p_period = month_start(period_start)` da
temporada aberta (o mês do **início da temporada**, não o do relógio de quem
clicou). Um `AlertDialog` explica: *"Encerra a temporada, congela o ranking,
trava o mês-base MM/AAAA e move as propostas abertas para o mês seguinte."*

`closeGameSeason()` em `game.ts` **perdeu o parâmetro `closeMonth`** e fixa
`p_close_month: false`, para ninguém reintroduzir o caminho. Ela ficou sem
chamador; mantive exportada de propósito, com o comentário do porquê, porque é
o espelho de uma RPC que existe no banco.

### O ciclo não é mês de calendário

Decisão de 21/08: a temporada começa quando o admin abre e termina quando ele
fecha (02/07 → 05/08 é um ciclo legítimo). A tela:

- mostra o **período real** (`period_start → period_end` ou "em andamento") no
  lugar de "Agosto 2026" derivado do relógio;
- o seletor lista temporadas por **`id`**, com o rótulo e o período — antes
  indexava por `YYYY-MM`, e uma temporada nova ficava **invisível** depois de um
  fechamento no meio do mês (duas temporadas caíam na mesma chave);
- "fechada" deriva de `closed_at`, não de comparação de mês.

### Ranking reativo

`useGameRanking` virou TanStack Query (`useCurrentSeasonId` + `useSeasonRanking`,
chaves sob `gameKeys`, em `game.ts`). O `EngagementLayer` assina `game_events`
INSERT e invalida `["game"]` — placar, temporada e regras se atualizam juntos,
sem cada tela abrir um canal. Antes era um `useEffect` que buscava uma vez e
nunca mais: uma venda com a tela aberta não mexia o placar.

### G06: jogo parado

Sem temporada aberta, `award_game_points` devolve null em silêncio e nada
pontua. A tela mostra **"Jogo parado — abra uma temporada"**, com o aviso de que
os eventos perdidos não são recuperados, e um botão **"Abrir temporada"** para o
admin (`insert` em `game_seasons`, que a policy `game_seasons_write` já permite).
Sem o botão o aviso seria um beco sem saída: `close_game_season` só abre a
próxima ao fechar uma, e não havia nenhum caminho de UI para o primeiro ciclo.
A celebração de `rank_up` não dispara nesse estado (ranking vazio).

### Kit e tokens

A tela foi remontada com `PageHeader`, `SectionCard`, `StatusBadge`,
`EmptyState` e `LoadingState` — é a primeira a adotar o kit e serve de
referência. Sumiram: o `#fbbf24` da animação de pontos, `text-yellow-400`,
`text-gray-300`, `text-amber-600`, `border-green-500/40 text-green-400`.
**Os 5 hex que a Tarefa A deixou nos meus arquivos foram zerados; não introduzi
nenhum.**

Também: o histórico buscava `game_season_results` de **todas** as temporadas
fechadas no primeiro render (N+1); agora busca só a selecionada.

### Uma armadilha que vale registrar

`isPending` do TanStack Query **não** serve como "mostrar esqueleto": consulta
desabilitada (sem temporada aberta) ou com retry pausado fica `pending` para
sempre e a tela trava no esqueleto — foi o que aconteceu aqui, e só apareceu
rodando no navegador. O certo é `isLoading` (`isPending && isFetching`).
Corrigido na Gamificação e no `useGameRanking`. E `jogoParado` deriva de
`isSuccess`, não da ausência de dado: erro de rede não é "o admin não abriu
temporada".

---

## 7. Outras correções

- **F04** — `NewLeadNotifier` navegava para `/pipeline` (abre a aba de negócios)
  nos dois botões; agora vai para `/leads`. O rótulo "Abrir funil" virou
  "Abrir leads".
- **G13** — `isFresh` comparava `assigned_at`/`created_at` (relógio do servidor)
  com `Date.now()` (relógio da máquina do corretor): micro atrasado deixava de
  anunciar lead legítimo, adiantado anunciava atribuição velha. Agora a
  referência é o `commit_timestamp` do payload do realtime — os dois lados do
  mesmo relógio.
- **G13** — o gestor recebia popup de **todo** lead da casa. Agora o gerente só
  é avisado da fila geral (`distribution_group_id` nulo) e dos grupos em que sua
  equipe está inscrita; admin e diretor continuam vendo tudo. A lista de
  pessoas sai de `select id from profiles`, que o RLS já recorta por
  `auth_visible_profiles()`.
- **G03/G04** — a venda deduplica por `ref_id`: o trigger grava uma linha de
  `game_events` por corretor do rateio, então um negócio a três mãos tocava
  **três** fanfarras e trocava o nome no meio do card. Agora os eventos são
  acumulados por ~500 ms e viram um card com todos os nomes e **uma** fanfarra.
  Vendas diferentes na mesma janela entram numa fila e comemoram uma de cada vez.
- **G03** — o nome vem de `listRanking(seasonId)` (escopado), não de `profiles`:
  o RLS de `profiles` esconde quem está fora do escopo e todo corretor via
  "Equipe". Quem seguir fora do escopo continua anônimo, de propósito; se nenhum
  nome resolver, o card diz "Equipe".
- `MotivationalPopup` passou a ler ele mesmo o `sessionStorage
  faceimob-just-logged` — o `AppLayout` não precisa mais saber que ele existe.
- `GamificationAdmin`: `text-[10px]` → `text-xs` (piso de 11 px do design system).

---

## 8. Arquivos tocados

**Novos**
```
src/lib/engagement/audio.ts
src/lib/engagement/celebrations.ts        (tabela + funções puras)
src/lib/engagement/celebrations.test.ts   (15 asserções)
src/components/engagement/{index.ts,EngagementLayer.tsx,Confetti.tsx,
                           Podium.tsx,SoundToggle.tsx,context.ts}
docs/prompts/handoff-B.md
```

**Alterados**
```
src/lib/sound.ts                     (virou reexport)
src/components/SaleCelebration.tsx   (só apresentação; realtime saiu para o layer)
src/components/NewLeadNotifier.tsx   (rota, celebrate, commit_timestamp, grupos)
src/components/MotivationalPopup.tsx (gatilho do sessionStorage veio para cá)
src/components/PipelineTopRanking.tsx(usa Podium + SectionCard; cores fixas saíram)
src/components/GamificationAdmin.tsx (piso de fonte)
src/pages/Gamification.tsx           (remontada no kit; fechamento; ciclo real)
src/hooks/useGameRanking.ts          (TanStack Query; isLoading)
src/integrations/supabase/game.ts    (gameKeys, closeMonthAndSeason, openGameSeason,
                                      monthStart; closeGameSeason perdeu closeMonth)
src/components/layout/AppLayout.tsx  (só o provider e o toggle, conforme handoff-A §5)
```

Não toquei em `supabase/**`, `scripts/**`, `package.json`, nem em arquivo fora
da lista do prompt. Nenhuma migration criada.

`AppLayout.tsx`: `SaleCelebration`, `MotivationalPopup` e `NewLeadNotifier`
saíram de lá (o `EngagementLayer` os monta), junto com o estado
`showMotivation` e seu efeito. `<SoundToggle />` entrou antes do `RoleSwitcher`,
`h-8 w-8` com `aria-label`. **Deixei a indentação do bloco envolvido como
estava, de propósito**: reindentar ~60 linhas por 2 espaços inflaria o conflito
textual com quem estiver editando o arquivo em paralelo.

---

## 9. Validação

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpo |
| `npm run lint` | 0 erros · 7 avisos (os mesmos 7 de antes; não adicionei nenhum) |
| `npx vitest run` | 129 testes, 5 arquivos (114 de antes + 15 novos) |
| `npm run build` | ok |
| hex e paleta literal nos meus arquivos | zero |

Os 15 testes novos cobrem as funções puras: agrupamento de venda por `ref_id`
(inclusive reentrega do realtime e evento sem `ref_id`), detecção de `rank_up`
(subiu, desceu, empatou, primeira carga, entrou agora, sem usuário), escrita da
lista de nomes em português e a conversão HSL → hex.

**Medido no navegador** (dev server, `VITE_BYPASS_AUTH` num `.env.local`
temporário, já removido — confira com `ls .env*`):

- tokens lidos ao vivo nos dois temas → os quatro hex do confete, corretos;
- `fireConfetti` cria canvas `fixed` / `pointer-events:none` / `z-index:100`;
- `prefers-reduced-motion` simulado: **0** canvas nos três presets; sem ela, 1;
- 5 sons seguidos → **1** `AudioContext`, 18 osciladores (o catálogo exato);
  com o som desligado, 0 osciladores novos;
- `SoundToggle`: clique alterna `aria-pressed` e grava `faceimob-sound`;
- card de venda: `role="status"`, `aria-live="polite"`, `pointer-events:none`,
  com os três nomes escritos por `joinNames`;
- pódio: `<ol>` com ordem visual 2-1-3, `aria-label` por degrau
  ("1º lugar: Ana Ribeiro, 340 pontos") e os anéis ouro/prata/bronze
  confirmados no `box-shadow` computado, nos dois temas;
- Gamificação com temporada `02/07/2026 → em andamento`: o cabeçalho mostra o
  período real, não o mês do calendário.

### O que **não** foi testado

1. **Não ouvi som nenhum.** O navegador do harness não entrega gesto confiável
   (`isTrusted`), e a política de autoplay exige um. O que provei é estrutural:
   contexto único, catálogo certo, mudo cortando na origem. **Falta alguém
   clicar uma vez na tela e conferir os seis timbres** — principalmente se
   `checkin` (1 nota) e `leadClaimed` (2 notas) ficaram distinguíveis.
2. **Nenhum gatilho foi disparado contra banco de verdade.** Não havia stack
   local (`npm run db:start` exige Docker) e não entro na homologação com
   credencial que não é minha. As assinaturas de realtime foram conferidas
   contra as migrations (`0020` publica `leads`, `lead_events`, `game_events` e
   `checkins`; `claim_lead` grava `kind='claimed'` com `actor_id=auth.uid()`),
   não contra tráfego real. **Vale rodar `node scripts/demo.mjs preparar` e
   `lead` antes da demo**, e fechar um negócio de teste para ver a fanfarra.
3. **Fechamento de temporada não foi executado.** `close_month_and_season` é
   admin-only e destrutivo; o caminho está lido linha a linha na migration
   `0021`, mas ninguém apertou o botão. **Teste em homologação antes de mostrar
   ao cliente** — é a mudança de maior risco desta entrega.
4. **Sem captura de tela**: o navegador do harness não compõe quadros aqui, então
   toda a verificação visual foi por árvore de acessibilidade e estilo computado.
   Não tenho print do pódio para o material de demonstração.

### Uma pedra no caminho, para poupar tempo de quem vier

O primeiro carregamento quebrou com *"Invalid hook call / more than one copy of
React"* dentro do `<AlertDialog>`. Não era código: o `@radix-ui/react-alert-dialog`
nunca tinha sido importado por página nenhuma, e o Vite serviu a dependência
recém-otimizada com hash diferente do resto. `rm -rf node_modules/.vite` e
reiniciar o dev server resolve.

---

## 10. Decisões que outro agente pode querer discutir

1. **A detecção de `rank_up` mora no `EngagementLayer`, não no `useGameRanking`**
   (o prompt pedia no hook). Motivo: o hook é montado duas vezes — `AppLayout` e
   `PipelineTopRanking` — e as duas instâncias leem o mesmo cache, então a
   comemoração sairia em dobro. O `EngagementLayer` é montado uma vez. A função
   pura (`detectRankUp`) é a mesma e está testada; só o ponto de chamada mudou.
2. **`SaleCelebration` virou apresentação pura.** Todo o realtime, o agrupamento
   e a resolução de nome subiram para o `EngagementLayer`, que é quem tem o
   canal e a fila. Quem importar `SaleCelebration` precisa passar
   `sale={{ id, names }}` — mas ninguém deveria importar: o layer monta.
3. **Nome parcialmente visível numa venda em conjunto.** Se o RLS deixa ver 1 de
   3 corretores, o card mostra só esse 1. A alternativa ("Ana e Equipe") ficou
   pior de ler. Se o cliente achar enganoso, o ajuste é uma linha em `joinNames`.
4. **`seen` (eventos já comemorados) cresce sem limite** enquanto a aba fica
   aberta — herdado do código anterior. Numa TV ligada por semanas são alguns
   milhares de uuid. `ponytail: sem poda; virar um Set com janela se a TV de
   loja acusar memória.`
