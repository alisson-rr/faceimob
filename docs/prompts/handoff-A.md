# Handoff A — Fundação visual

21/08/2026 · branch `nova` · **nada commitado**.
Documento de uso para quem vai montar tela: `docs/design-system.md` (é o único que precisam ler).
Capturas: `docs/design-system/*.png` — login, shell e 404, em 1280 px e 375 px, claro e escuro.

---

## 1. O que mudou

**Tokens.** `src/index.css` reescrito com claro e escuro completos e `tailwind.config.ts` espelhando
**todos** eles. Isso mata o achado crítico T01 (`--success`/`--warning` existiam no CSS e não no
Tailwind: ~40 classes compilavam zero regras e o botão "Converter em Negócio" ficava sem fundo).
Novos: `info`, `highlight`, `chart-1..5`, `gold/silver/bronze`, `brand-*`. O `background-color:#0a090b`
do `body` saiu — era ele que deixava o modo claro com fundo preto (T02).

**Duas correções de raiz que não estavam no pedido, mas bloqueavam o resto:**

1. **O tema não valia fora do `AppLayout`.** A classe `.light` só era escrita pelo efeito do
   `useTheme`, e o único componente que chamava o hook era a barra lateral. Login, 404, Diário e
   Checkpoint público abriam **sempre no escuro**, com o tema claro salvo. Agora `main.tsx` aplica a
   classe antes do React montar (também mata o flash no primeiro quadro). `useTheme` segue dono da troca.
2. **`--input` não era identificável.** O contorno de campo tinha ~1,3:1 contra a superfície nos dois
   temas (WCAG 1.4.11 pede 3:1). Foi escurecido nos dois temas; os campos ficaram visivelmente mais marcados.

**Shell.** `AppLayout` + `AppSidebar` + `ui/sidebar`: sidebar com item ativo como pílula primária,
grupos com rótulo em caixa alta, logo colorido/branco por tema, toggle de tema com `aria-label`,
`SidebarInset` pintando `bg-background` (antes o `main` não pintava nada), largura máxima de 1600 px
com padding responsivo, `<MotionConfig reducedMotion="user">` envolvendo tudo. O pódio do header foi
reestilizado com `gold/silver/bronze`; **a lógica de `headerScores` está intacta, linha por linha**.

**Rótulo da barra do topo.** `pageTitles` (12 de 27 rotas; Gamificação, Check-in, Checkpoint, SDR e todo
o admin apareciam como "Faceimob") morreu. Agora sai de `src/components/layout/navigation.ts`, a mesma
lista que desenha o menu — fonte única. Rota fora do menu entra na lista com `hidden: true`
(hoje só `/admin/meta-ads`). O rótulo continua `<p>`, não `<h1>` (decisão de 10/08 preservada).

**Login.** Redesenhado (painel de marca com o motivo do símbolo + cartão de acesso) e **mudança de
fluxo**: modo padrão "Entrar com senha" (`signInWithPassword`), alternativa "Receber código por e-mail"
com o fluxo OTP atual. `shouldCreateUser: false`, as mensagens de rate-limit/expirado/inválido e o
`sessionStorage "faceimob-just-logged"` estão preservados nos dois caminhos. Erro de senha tem mensagem
única ("E-mail ou senha inválidos.") em `role="alert"`, o campo de senha é limpo, e o texto
"Não usamos senha" saiu. Registrado em `docs/sprints/decisoes.md` (21/08/2026).
O framer-motion saiu do Login — ele é importado de forma síncrona pelo `App`, então isso também tira
peso do primeiro carregamento.

**Kit** em `src/components/shared/`: `PageHeader`, `KpiCard`, `SectionCard`, `StatusBadge`,
`EmptyState`, `LoadingState` — mais `BrandMotif` (o motivo decorativo), que eu adicionei porque
Login, header e `EmptyState` precisavam dele e a alternativa era repetir o mesmo SVG em três lugares.
Barril em `src/components/shared/index.ts`.

**Primitivos** `ui/`: `button` (pílula + variante `highlight`), `badge`, `card`, `input`, `select`,
`tabs`, `dialog`, `table` no novo raio e tipografia. Props inalteradas — **exceto** que as variantes
`hero` e `heroOutline` do `Button` foram removidas: tinham 0 uso e apontavam para classes inexistentes
(`bg-gradient-accent`, `shadow-elevated`). Se algum agente as usar, quebra no typecheck, não em silêncio.

**Varredura mecânica.** 355 classes de paleta literal → token, 97 literais de branco → token,
86 hex → token. Hex fora de `ui/`: **91 → 5**, e os 5 que sobraram estão em arquivos do agente B
(`SaleCelebration.tsx`, `Gamification.tsx`).

**Miúdos.** `index.html` com `lang="pt-BR"`, `color-scheme` e `theme-color` por tema. `NotFound.tsx`
em pt-BR no visual novo. `src/lib/format.ts` (`brl`, `num`, `date`, `dateTime`) com teste — o `date`
lê `YYYY-MM-DD` do Postgres como data **local**, senão toda data de check-in imprime um dia a menos.

---

## 2. Paleta final (HSL)

Escuro é `:root`; claro é `.light`.

| Token | Escuro | Claro | Por quê |
|---|---|---|---|
| `background` | `222 38% 10%` | `210 33% 97%` | navy da marca; matiz puxado de 232 para 222, mais perto do azul da marca (216) |
| `foreground` | `210 30% 96%` | `222 45% 14%` | 16,5:1 e 15,6:1 |
| `card` | `222 32% 14%` | `0 0% 100%` | uma camada acima do canvas |
| `muted-foreground` | `214 18% 72%` | `218 20% 40%` | 8,8:1 e 5,9:1 — substitui todo `text-white/40` (era ~3,7:1) |
| `primary` | `214 72% 62%` | `216 62% 40%` | claro = azul profundo da marca (#2A5CA8); escuro = clareado para o azul claro da marca |
| `primary-foreground` | `222 45% 10%` | `0 0% 100%` | ver a regra invertida abaixo |
| `success` | `156 46% 62%` | `158 58% 30%` | menta da marca; dessaturada e escurecida no claro para dar 5,3:1 com branco |
| `warning` | `33 92% 60%` | `30 88% 36%` | âmbar, **não** o amarelo da marca — é o tom escurecido que serve como texto |
| `destructive` | `358 72% 62%` | `358 66% 48%` | 5,1:1 e 5,0:1 como texto |
| `info` | `196 78% 60%` | `200 82% 32%` | ciano, para não colidir com `primary` |
| `highlight` | `47 88% 58%` | `46 92% 52%` | **amarelo da marca, token de fundo** (ver ressalva) |
| `input` | `220 14% 44%` | `214 16% 54%` | 3,1:1 e 3,7:1 — contorno de campo identificável |
| `border` | `222 22% 24%` | `214 22% 82%` | divisória; fica em ~1,5:1 de propósito |
| `gold/silver/bronze` | `45 90% 60%` · `214 18% 76%` · `25 68% 58%` | `43 82% 28%` · `214 12% 44%` · `22 62% 36%` | pódio; a prata clara era invisível no branco |
| `chart-1..5` | 214/156/47/196/268 | idem, escurecidos | azul · menta · amarelo · ciano · violeta |
| `brand-blue/blue-light/mint/yellow` | `216 60% 41%` · `215 47% 60%` · `153 35% 75%` · `50 80% 55%` | iguais nos dois | cores literais do símbolo, só decoração |

**Ajustes que fiz e por quê:**

- **Matiz do navy de 232 → 222.** 232 puxa para o violeta e brigava com o azul da marca (216).
- **A regra que parece invertida.** No escuro a cor de marca é a **clara** e o `-foreground` é a tinta
  navy; no claro é o contrário. Não é descuido: é a única forma de a mesma variável servir como
  preenchimento (`bg-primary`) **e** como texto (`text-primary`) com 4,5:1 nos dois temas. Um vermelho
  que passe com texto branco no escuro tem no máximo 3,9:1 como `text-destructive` — as duas coisas não
  cabem no mesmo valor. Consequência visível: **no escuro o botão primário é azul claro com texto
  escuro**, e o destrutivo é vermelho-coral com texto navy.
- **`warning` é âmbar, não o amarelo da marca.** O amarelo (`highlight`) como texto sobre página clara
  dá 1,6:1. É o "escurecer o amarelo quando for texto" do briefing, resolvido com dois tokens em vez
  de um: `highlight` para fundo, `warning` para texto.
- **Menta dessaturada no claro** (`158 58% 30%`): o `#A8D5C1` puro dá ~1,4:1 sobre branco.

### ⚠️ A ressalva que importa

**`--highlight` é token de FUNDO.** `text-highlight` sobre fundo claro é 1,6:1 e eu **não** consigo
fazer o amarelo da marca funcionar como texto no tema claro sem deixar de ser amarelo. Quem precisar
de amarelo em texto usa `text-warning`. O `StatusBadge tone="highlight"` é sólido por isso, enquanto
os outros tons são tingidos. Está no `docs/design-system.md` e no comentário do topo do `index.css`.

### Trava executável

`src/lib/theme-contrast.test.ts` lê o `index.css` de verdade e reprova qualquer par abaixo de
4,5:1 (texto) ou 3:1 (interface), **nos dois temas** — 73 asserções. Verifiquei que ela falha de
verdade: escureci `muted-foreground` do tema claro de propósito e os dois casos reprovaram.
(O primeiro rascunho do teste tinha um defeito: `indexOf(".light")` casava com a menção no comentário
do topo e media o `:root` duas vezes. Corrigido para casar a abertura do bloco.)

---

## 3. O que ficou de fora

1. **Login com credencial real não foi testado.** Não tenho usuário/senha da homologação. O que
   verifiquei, com as chamadas do Supabase Auth interceptadas: o caminho da senha chama
   `token?grant_type=password`, mostra a mensagem única e limpa o campo; o do código chama `/otp` com
   `create_user:false`, avança para os seis dígitos, mostra o cooldown e o "Trocar e-mail". **Falta
   alguém entrar de verdade uma vez, nos dois caminhos.** Lembrando a pendência que já existe em
   `decisoes.md`: o template de e-mail do OTP precisa ser colado no painel do remoto, senão o e-mail
   chega sem código nenhum.
2. **Não existe logo com letra escura.** `logo-faceimob.png` e `logo-faceimob-white.png` são o **mesmo**
   desenho de letra branca — no sidebar claro o texto some e sobra só o símbolo. Contornei pondo a arte
   sobre uma placa azul da marca no tema claro. **Pedir à marca um `logo-faceimob-dark.png`** e trocar
   as duas linhas em `AppSidebar.tsx`.
3. **Não redesenhei página nenhuma** (só Login e NotFound, como combinado). A varredura em
   `Dashboard`, `Pipeline`, `Equipes`, `Checkpoint`, `DailyReport`, `PublicDirectorCheckpoint` e
   companhia trocou **cor**, não estrutura: continuam com `text-[8px]`, `grid-cols-4` sem breakpoint,
   `<tr onClick>` sem teclado e h1 fora do `PageHeader`. Isso é dos agentes de tela.
4. **5 hex sobraram**, todos em arquivo do agente B: `SaleCelebration.tsx` (4 cores de confete) e
   `Gamification.tsx` (1). O `LeadFunnel.tsx:347` tem `bg-destructive text-white`, que no escuro dá
   3,6:1 — também é de outro agente.
5. **`.text-eyebrow` e as utilidades de motion** foram mantidas e ligadas a token, mas o piso de 11 px
   e a escala tipográfica só valem de fato quando as telas forem refeitas.
6. **Chip de papel na tela de Permissões**: sete papéis para cinco tons de gráfico, então dois pares
   repetem cor. O rótulo escrito continua ao lado; é cosmético.

---

## 4. Arquivos tocados

**Novos**
```
src/components/shared/{index.ts,PageHeader,KpiCard,SectionCard,StatusBadge,EmptyState,LoadingState,BrandMotif}.tsx
src/components/layout/navigation.ts
src/lib/format.ts · src/lib/format.test.ts · src/lib/theme-contrast.test.ts
docs/design-system.md · docs/design-system/*.png (14) · docs/prompts/handoff-A.md
```

**Fundação**
```
src/index.css · tailwind.config.ts · src/main.tsx · index.html
```

**Shell, login, 404**
```
src/components/layout/AppLayout.tsx · src/components/layout/AppSidebar.tsx
src/components/ui/sidebar.tsx · src/pages/Login.tsx · src/pages/NotFound.tsx
```

**Primitivos** — `src/components/ui/{button,badge,card,input,select,tabs,dialog,table}.tsx`

**Varredura mecânica (só cor)**
```
src/pages/{Dashboard,Pipeline,Equipes,Checkpoint,DailyReport,PublicDirectorCheckpoint,Marketing,
  CcaPipeline,DirectorDashboard,DataManagement,Resultados,SdrModule,MetaAdsSetup,AdminAllowedIps,
  AdminDailyTeams,AdminDevelopers,AdminIntegrations,AdminLeadAutomation,AdminPermissions}.tsx
src/components/{ComparativeFunnel,RoleSwitcher,BrokerEditModal,MarketingInvestmentPopup,
  TaskPanel,UpdateNotifier,DealDetailModal}.tsx
src/integrations/supabase/permissions.ts
```

**Docs** — `docs/sprints/decisoes.md` (7 linhas novas em "Registradas", 21/08/2026)

**Não toquei** em nada da lista proibida, em `supabase/**`, `scripts/**` nem no `package.json`.
`Pipeline.tsx` não estava na lista proibida e entrou na varredura — a mudança lá é só troca de classe
de cor em tabelas de constante; se o agente D estiver editando o arquivo, o conflito é textual e trivial.

> Uma nota para o agente D: os chips de etapa do `Pipeline.tsx` eram `bg-<cor> text-foreground`, que não
> passa contraste em nenhum dos temas. Viraram tingidos (`bg-<token>/15 text-<token>`) nas 34 ocorrências.

---

## 5. Para montar o `<EngagementLayer />` do agente B

`docs/prompts/handoff-B.md` **ainda não existe** — B não entregou até aqui. Quando entregar, o
`AppLayout.tsx` precisa de duas linhas. Import, junto dos outros:

```tsx
import { EngagementLayer, SoundToggle } from "@/components/engagement";
```

O provider envolve o conteúdo do `SidebarProvider`. Hoje a árvore é:

```tsx
<SidebarProvider style={…}>
  <SaleCelebration />
  <AppSidebar />
  <SidebarInset>…</SidebarInset>
  {showMotivation && <MotivationalPopup />}
  <NewLeadNotifier />
</SidebarProvider>
```

Vira:

```tsx
<SidebarProvider style={…}>
  <EngagementLayer>
    <AppSidebar />
    <SidebarInset>…</SidebarInset>
  </EngagementLayer>
</SidebarProvider>
```

— com `SaleCelebration`, `MotivationalPopup` e `NewLeadNotifier` saindo daqui **se** o `EngagementLayer`
passar a montá-los (é o que o prompt de B descreve). Se ele só adicionar o provider, mantenha os três
onde estão e apenas envolva.

O `SoundToggle` vai no bloco da direita do header, **antes** do `RoleSwitcher`:

```tsx
<div className="relative ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
  <SoundToggle />
  <RoleSwitcher />
  <NotificationBell />
  …
```

Ele precisa ter nome acessível próprio (`aria-label`) e caber em `h-8 w-8` para alinhar com o
`NotificationBell` e o avatar.

---

## 6. Validação

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpo |
| `npm run lint` | 0 erros · 7 avisos (os mesmos 7 de antes; não adicionei nenhum) |
| `npx vitest run` | 114 testes, 4 arquivos — inclui 73 asserções de contraste e 4 de formatação |
| `npm run build` | ok |
| hex fora de `ui/` | 91 → **5** (todos em arquivo do agente B) |
| contraste | todos os pares em AA nos dois temas, medido no navegador **e** travado em teste |

As capturas foram geradas com Playwright e um script temporário, já apagado. O shell foi capturado com
uma sessão encenada no `localStorage` e o PostgREST interceptado — **sem** `VITE_BYPASS_AUTH`, para o
print provar o caminho real de quem tem sessão. O `.env.local` que usei no meio do caminho foi removido;
confira com `ls .env*` se desconfiar.
