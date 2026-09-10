# Design system Faceimob

Atualizado em 21/08/2026. **Este é o único arquivo que você precisa ler para montar uma tela.**
Capturas em `docs/design-system/` (login, shell e 404, em 1280 px e 375 px, claro e escuro).

---

## 1. Regras (as cinco que não se negociam)

1. **Sem hex e sem paleta literal do Tailwind.** Nada de `#3B82F6`, `text-emerald-400`,
   `bg-slate-800`, `text-white`. Só token: `text-success`, `bg-card`, `border-border`.
   Em SVG do Recharts e em `style` inline use `hsl(var(--token))` — funciona nos dois.
2. **Um `<h1>` por tela, e ele sai do `PageHeader`.** O rótulo da barra do topo é `<p>`
   de propósito. Seção usa `<h2>` (o `SectionCard` já faz isso).
3. **Cor nunca é o único sinal.** Delta tem seta, estado tem rótulo escrito, badge tem texto.
4. **`prefers-reduced-motion` é respeitado sozinho** — o bloco `@media` de `index.css` e o
   `<MotionConfig reducedMotion="user">` do `AppLayout` cobrem CSS e framer-motion.
   Não escreva animação contínua que dependa de você lembrar disso.
5. **Escuro é o padrão, claro tem de funcionar.** Toda cor precisa passar em **AA nos dois**
   (4,5:1 texto · 3:1 elemento de interface). `src/lib/theme-contrast.test.ts` reprova quem quebrar.

---

## 2. Tokens

Definidos em `src/index.css` (`:root` = escuro, `.light` sobrepõe) e espelhados em
`tailwind.config.ts`. **Token sem espelho no Tailwind compila zero regras e a classe some
em silêncio** — foi o achado T01. Mexeu em um, mexa no outro; o teste cobre isso.

### Superfície e texto

| Token | Use para |
|---|---|
| `background` | fundo da página (quem pinta é o `AppLayout`; sua tela não precisa) |
| `foreground` | texto principal |
| `card` / `card-foreground` | superfície elevada: card, tabela, painel |
| `popover` / `popover-foreground` | conteúdo flutuante: select, dropdown, tooltip |
| `muted` / `muted-foreground` | fundo neutro · texto de apoio, legenda, rótulo |
| `secondary`, `accent` | botão secundário, chip neutro, linha destacada |
| `border` | divisória e contorno de card |
| `input` | contorno de campo (mais forte que `border`, exigência de a11y) |
| `ring` | anel de foco — **nunca remova o `focus-visible`** |

### Semânticos (cada um com `-foreground`)

| Token | Significado | Exemplo |
|---|---|---|
| `primary` | ação principal, item ativo, link | botão "Salvar", item de menu ativo |
| `success` | deu certo, acima da meta, aprovado | "Aprovado total", meta batida |
| `warning` | atenção, pendente, abaixo da meta | "Pendente de viabilidade" |
| `destructive` | erro, perda, ação destrutiva | "Distrato", "Excluir" |
| `info` | informação neutra, em andamento | "Em análise", "Visita agendada" |
| `highlight` | **amarelo da marca**: celebração, destaque de ranking, ação secundária de peso | selo "Poss. venda", botão de destaque |

> ⚠️ **`highlight` é token de FUNDO.** `text-highlight` sobre fundo claro dá 1,6:1.
> Precisa de amarelo em texto? Use `text-warning` — é o mesmo tom, escurecido.

### Apoio

- `chart-1` … `chart-5` — séries de gráfico (Recharts). Ordem fixa: azul, menta, amarelo, ciano, violeta.
- `gold`, `silver`, `bronze` (+ `-foreground`) — pódio.
- `brand-blue`, `brand-blue-light`, `brand-mint`, `brand-yellow` — cores literais do símbolo.
  **Só decoração** (o `BrandMotif`). Nunca texto, nunca estado.
- `sidebar-*` — exclusivo da barra lateral.

### Por que os pares parecem invertidos entre os temas

No **escuro** a cor de marca é a **clara** e o `-foreground` é a tinta navy → botão primário
é azul claro com texto escuro. No **claro** a cor é a **profunda** e o `-foreground` é branco.
É o único jeito de a mesma variável servir como preenchimento (`bg-primary`) **e** como texto
(`text-primary`) mantendo 4,5:1 nos dois. Não "conserte" isso.

---

## 3. Tipografia, forma e movimento

- **Display** (`font-display`, Bricolage Grotesque): `<h1>`–`<h6>` já usam por padrão. Aplique também
  em número de KPI e de pódio. **Texto** (`font-sans`, DM Sans): o resto, é o padrão do `<body>`.
- Número que atualiza sozinho leva `tabular-nums`, senão a largura pula a cada refresh do realtime.
- **Piso de 12 px, com uma exceção escrita** (decidido em 27/08/2026 — X07). Escala:
  `text-xs` (12) → `text-sm` (14) → `text-base` (16). **Zero `text-[Npx]`**: nenhum tamanho
  literal, nem abaixo nem acima do piso.
  A única coisa abaixo de 12 px é a `.text-eyebrow` (11 px), e ela vale só para **rótulo curto
  em CAIXA ALTA com tracking aberto**. A exceção é a **forma**, não o número: caixa alta não
  tem descendente e o `letter-spacing` de 0.14em devolve a separação que o corpo menor tira —
  texto corrido de 11 px não tem nem uma coisa nem outra.
  Precisa de rótulo em caixa alta com outra cor? `text-xs uppercase tracking-widest` — a 12 px
  a exceção não é necessária, e a `.text-eyebrow` fixa a cor de propósito (ela fica depois das
  utilities geradas, então um `text-warning` ao lado não vence).
  **`src/lib/type-scale.test.ts` reprova as duas metades:** literal solto em `src/**` e regra de
  `index.css` abaixo de `0.75rem` sem `text-transform: uppercase` e `letter-spacing >= 0.1em`.
- **Raio:** `--radius: 1rem`. Card = `rounded-2xl` · campo e caixa menor = `rounded-xl` ·
  badge, filtro e botão = `rounded-full` (o `Button` já é pílula).
- **Ícone:** `h-4 w-4` no corpo, `h-5 w-5` em destaque. Dentro do `Button` o tamanho é forçado
  para 16 px — não tente sobrescrever com `h-3`.
- **Movimento:** 150–300 ms com `ease-premium` (`cubic-bezier(.22,1,.36,1)`). Hover de card/CTA
  sobe 2 px com sombra da própria cor. Utilitários prontos: `.interactive`, `.animate-fade-in`,
  `.animate-slide-up`, `.stagger-1..8`.
- **Vidro (`.glass`, `.glass-strong`, `.glass-subtle`) só em superfície sobreposta** — header fixo,
  modal, popover. Card de conteúdo é `bg-card`, sólido.

---

## 4. Kit — `@/components/shared`

Importe pelo barril: `import { PageHeader, KpiCard } from "@/components/shared";`

### `PageHeader` — o `<h1>` da tela

```tsx
<PageHeader
  title="Pipeline de negócios"
  eyebrow="Comercial"
  icon={GitBranch}
  description="Negócios ativos, por etapa, no período selecionado."
  actions={<Button onClick={novo}>Novo negócio</Button>}
/>
```

### `KpiCard` — indicador

```tsx
<KpiCard label="VGV do mês" value={brl(stats.vgv)} icon={DollarSign}
         delta={{ label: "+12% vs. mês anterior", direction: "up" }} />
<KpiCard label="Distratos" value={num(stats.distratos)} icon={XCircle}
         delta={{ label: "+3", direction: "up", tone: "danger" }} hint="meta: 0" />
<KpiCard label="Negócios" value={num(stats.negocios)} variant="highlight" icon={CheckCircle2} />
```

`direction` escolhe a seta, `tone` escolhe a cor. Subir nem sempre é bom — em perda/distrato
passe `tone: "danger"` explicitamente.

### `SectionCard` — bloco de conteúdo (`<h2>` + ações)

```tsx
<SectionCard title="Negócios por construtora" description="Mês corrente"
             icon={Building2} actions={<Select …/>}>
  <MeuGrafico />
</SectionCard>

{/* Tabela de borda a borda: tire o padding do corpo */}
<SectionCard title="Ranking" flush footer="Atualizado há 2 minutos">
  <Table>…</Table>
</SectionCard>
```

### `StatusBadge` — estado

```tsx
<StatusBadge tone="success" icon={Check}>Aprovado total</StatusBadge>
<StatusBadge tone="warning">Pendente de viabilidade</StatusBadge>
<StatusBadge tone="danger">Distrato</StatusBadge>
<StatusBadge tone="info">Em análise</StatusBadge>
<StatusBadge tone="neutral">Sem etapa</StatusBadge>
<StatusBadge tone="highlight">Campeão do mês</StatusBadge>
```

Tons: `success · warning · info · danger · neutral · highlight`. `highlight` é sólido; os outros
são tingidos (fundo a 15%, texto na própria cor).

### `EmptyState` — lista vazia com saída

```tsx
<EmptyState icon={Inbox} title="Nenhum negócio com esses filtros"
            description="Tente ampliar o período ou limpar a construtora."
            action={<Button variant="outline" onClick={limpar}>Limpar filtros</Button>} />

<EmptyState icon={AlertTriangle} tone="danger" title="Não consegui carregar os negócios"
            description={describeError(erro)} action={<Button onClick={recarregar}>Tentar de novo</Button>} />
```

Lista vazia **por erro** e lista vazia **por filtro** não podem dar a mesma tela: use `tone="danger"`
e diga o que houve.

### `LoadingState` — espera

```tsx
if (isLoading) return <LoadingState variant="kpi" rows={4} label="Carregando indicadores…" />;
<LoadingState variant="table" rows={6} />
<LoadingState variant="list" rows={5} />
<LoadingState variant="block" />
```

Já traz `role="status"` + `aria-busy` — a espera existe para quem não vê o esqueleto.

### `BrandMotif` — fundo decorativo

Os retângulos rotacionados do símbolo. Precisa de pai `relative`. `aria-hidden` por dentro.
Já está no Login, no header e no `EmptyState`; use em capa e tela pública.

```tsx
<div className="relative overflow-hidden">
  <BrandMotif className="opacity-40" />
  <div className="relative">…</div>
</div>
```

---

## 5. Formatação — `@/lib/format`

```tsx
import { brl, num, date, dateTime } from "@/lib/format";

brl(1200000)                  // "R$ 1.200.000"     (sem centavos por padrão)
brl(1234.5, { cents: true })  // "R$ 1.234,50"
num(1200)                     // "1.200"
date("2026-08-21")            // "21/08/2026"       (data do Postgres, sem perder um dia no fuso)
dateTime(deal.created_at)     // "21/08/2026 14:30"
```

Valor ausente vira `—`, não `R$ NaN`. **Não escreva outro formatador** — havia 6 de BRL e 5 de data,
e o mesmo VGV aparecia com e sem centavos em telas diferentes.

---

## 6. Primitivos — `@/components/ui`

APIs inalteradas; só o visual mudou. `Button` ganhou `variant="highlight"`:

```tsx
<Button>Salvar</Button>                          {/* primária, pílula, sobe no hover */}
<Button variant="highlight">Fechar o mês</Button>{/* amarelo da marca */}
<Button variant="outline">Cancelar</Button>
<Button variant="destructive">Excluir</Button>
<Button size="icon" aria-label="Fechar"><X /></Button>  {/* size="icon" SEMPRE com aria-label */}
```

As variantes `hero` e `heroOutline` foram removidas: tinham 0 uso e apontavam para classes
inexistentes (`bg-gradient-accent`, `shadow-elevated`).

`Badge` ganhou `size="sm"` — o selo que entra **dentro de uma linha de lista**:

```tsx
<Badge variant="outline">Obrigatórios completos</Badge>          {/* padrão */}
<Badge variant="default" size="sm">PIN</Badge>                   {/* caixa menor, mesma letra */}
<Badge variant="outline" size="sm" className="border-warning text-warning">Link aberto</Badge>
```

O que `sm` encolhe é a **caixa** (`px-2 py-0`), não a letra: continua em `text-xs`, que é o
piso. Catorze telas escreviam `text-[9px] h-4 px-1` na mão para conseguir isso — se você
estiver prestes a fazer o mesmo, é `size="sm"` que você quer.

---

## 7. Antes de dar a tela por pronta

- [ ] `grep -nE "#[0-9a-fA-F]{6}|-(emerald|amber|rose|cyan|slate|sky|violet)-[0-9]" no arquivo` → vazio
- [ ] `grep -n "text-\[" no arquivo` → vazio (o piso é `text-xs`; caixa alta curta usa `.text-eyebrow`)
- [ ] Um `<h1>`, via `PageHeader`
- [ ] Carregando, vazio e erro têm tela própria (`LoadingState` / `EmptyState`)
- [ ] `size="icon"`, `Switch` e campo sem rótulo visível têm `aria-label` (ou `htmlFor`)
- [ ] Abre em 375 px sem barra horizontal; grade é `grid-cols-1 sm:grid-cols-N`
- [ ] Trocou para o tema claro e voltou, e continua legível
- [ ] `npm run typecheck && npm run lint && npx vitest run && npm run build`
