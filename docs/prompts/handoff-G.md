# Handoff G — Telas: Check-in + Leads (o coração da roleta)

26/08/2026 · branch `nova` · **nada commitado**.
Depende de A (kit), B (celebrações), D (correções do corretor) e F (`useQuery` + `staleTime`),
todas entregues. Rodou em paralelo com H (Pipeline) e K (lockout).

**URL do cliente republicada: https://faceimob.vercel.app**
(deployment `faceimob-8g15rlext`, target production, Ready — o bundle servido é
`assets/index-PRU1c-di.js`, o mesmo hash do `dist/` local reconstruído depois do envio.)

---

## 1. O que mudou, em uma frase

`Leads.tsx` saiu de **932 linhas** de `useEffect` + 5 `useState` de carga para **247 linhas de
composição** sobre 12 blocos novos em `src/components/leads/`; o nome do cliente virou botão e
abre o histórico do lead; e o Check-in passou a acompanhar `checkins` por realtime (F12), sem F5.

---

## 2. Componentes novos e onde vivem

Todos em `src/components/leads/`, exportados pelo barril `index.ts`.

| Arquivo | Linhas | O que é |
|---|---|---|
| `data.ts` | 182 | Todas as consultas (`useLeads`, `useOpenLeads`, `useLeadSources`, `useAssignableBrokers`, `useAutomationSettings`, `useWhatsappTemplates`, `useDevelopers`, `useDeveloperProjects`, `useTimeoutReleasesToday`, `useLeadDetail`), o realtime (`useLeadsRealtime`), a invalidação (`useInvalidateLeads`) e o relógio da trava (`useNowTicker`) |
| `model.ts` | 84 | Regras puras: `matchesFilters`, `leadMetrics`, `waNumber`, `emptyLeadFilters`/`hasActiveFilter`, `LeadDialogState`/`noLeadDialogs` |
| `model.test.ts` | 105 | 9 casos sobre filtro, indicadores, WhatsApp e importação |
| `importSheet.ts` | 124 | `parseSheet` (CSV com aspas + XLSX, com limites) e `rowsToLeads` (cabeçalho → lead) |
| `LeadsTable.tsx` | 172 | A lista. Nome do cliente = `<button>`; colunas secundárias colapsam abaixo de `lg` |
| `ConvertLeadDialog.tsx` | 172 | Conversão em negócio, com anexo opcional — **o dono do A06** |
| `OutreachDialogs.tsx` | 155 | `WhatsAppDialog` e `EmailDialog` |
| `LeadImportDialog.tsx` | 140 | Importação de planilha com dropzone que funciona e total antes de confirmar |
| `LeadFormDialog.tsx` | 135 | Novo/editar lead |
| `ReassignLeadDialog.tsx` | 86 | Realocação manual por gestor |
| `LeadDialogs.tsx` | 74 | Anfitrião dos seis diálogos |
| `model`/apoio: `LeadFilters.tsx` 66 · `FileDropzone.tsx` 66 · `SourcePerformanceCard.tsx` 64 · `OverdueLeadsCard.tsx` 59 · `LeadsSummary.tsx` 29 · `index.ts` 39 | | |

Nenhum passa de 182 linhas.

### Arquivos existentes tocados

| Arquivo | Antes → depois | O quê |
|---|---|---|
| `src/pages/Leads.tsx` | 932 → 247 | Composição; filtro, diálogo aberto e ações são o único estado |
| `src/pages/Checkin.tsx` | 270 → 290 | 5 `useQuery`, realtime de `checkins` (F12), kit, tokens |
| `src/components/LeadDetailModal.tsx` | 512 → 489 | `useLeadDetail`, `useId`+`htmlFor`, `aria-label`, tokens |
| `src/components/LeadFunnel.tsx` | 360 → 333 | `useQuery`, cartão navegável por teclado, tokens |
| `src/components/LeadCounter.tsx` | 35 → 35 | `text-[10px]` → `.text-eyebrow`; `num()` |
| `src/components/NewLeadNotifier.tsx` | 253 → 254 | `describeError` no toast de "Não foi possível atender" |
| `src/integrations/supabase/leads.ts` | 749 → 812 | Tom no lugar de classe, `leadSourceTone`, `listWhatsappTemplates`, `dbError` no Storage |
| `src/integrations/supabase/checkin.ts` | — | **não precisou mudar** |

---

## 3. Achados endereçados

| Achado | O que foi feito |
|---|---|
| **X06** | A célula do cliente é um `<button>` e abre o `LeadDetailModal`. As linhas do card de atrasados e os cartões do funil também viraram `<button>` — `<tr onClick>`/`<Card onClick>` não recebiam foco nem Enter |
| **F12** | `Checkin.tsx` assina `checkins` **e** `lead_assignments` (filtrados pelo próprio perfil) e invalida `["checkin"]`. Check-out feito em outra aba, ou a virada do turno, chegam sozinhos. `current_shift`/`checkin_eligibility` também refazem a cada 60 s (`refetchInterval`), no lugar do `setInterval` que chamava `load()` |
| **P14** | O dropzone existe e funciona: `FileDropzone` é um `<button>` com `onDrop` + `<input type="file">`, e o mesmo `onFile` atende arrastar e clicar. A instrução que apontava para a tela errada saiu |
| **F03** | Preservado e reforçado: `rows` guarda o arquivo inteiro, a amostra é derivada na renderização, e o total aparece no texto **e** no botão ("Importar 30 leads"). Coberto por teste (`model.test.ts`) |
| **X03** | `aria-label` em todos os `size="icon"` destas telas, com o nome do lead junto ("Editar Roberto Nakamura"). O fechar do modal já vinha nomeado do primitivo (`dialog.tsx` tem `sr-only` "Fechar") |
| **X04** | `EditFields` do `LeadDetailModal` e todos os formulários novos usam `useId` + `<Label htmlFor>`. Os filtros usam `<label class="sr-only">` — o placeholder some quando o corretor digita |
| **X07** | Zero `text-[Npx]` nos arquivos da tarefa. Escala `text-xs` (12) → `text-sm` → `text-base`; rótulo em caixa alta usa `.text-eyebrow`. Nenhum `text-white/40` |
| **X08** | Grades de modal e card ganharam breakpoint (`grid-cols-1 sm:grid-cols-2`, KPIs `sm:grid-cols-2 lg:grid-cols-5`, janelas de turno `sm:grid-cols-2 lg:grid-cols-3`) |
| **T13** | Todo `<button>` cru leva `focus-visible:ring-2 ring-ring ring-offset-2`. O WhatsApp saiu de dois verdes (`emerald-400` e `green-600`) para o token `success` |
| **A05** | `describeError` em todos os toasts destes arquivos. Na origem: `uploadLeadAttachment` e `signedAttachmentUrl` passaram a usar `dbError` (davam `throw new Error(msg)` e perdiam o `code`), e as duas sentinelas de sessão expirada viraram `dbError(..., { code: "P0001" })` para o texto pt-BR sobreviver ao `describeError` |
| **A06** | `ConvertLeadDialog` é o dono único — ver §5 |
| **`Checkin.tsx:155`** | `border-amber-500/40 bg-amber-500/10 text-amber-600` → `border-warning/40 bg-warning/10 text-warning` |
| **F16** | Conferido, não refeito: `grid grid-cols-4 sm:grid-cols-7 h-auto` continua, e a captura mostra as 7 abas numa linha em 1280 px |

`grep -nE "#[0-9a-fA-F]{6}|-(emerald|amber|rose|cyan|slate|sky|violet|blue|green|red|purple|yellow|orange|teal|indigo|pink|gray)-[0-9]|text-white|text-\[[0-9]+px\]"` nos 8 arquivos-dono + `components/leads/*`
volta **vazio** (uma ocorrência sobra num comentário que explica a troca).

---

## 4. Decisões que valem discussão

**A cor do estado saiu da camada de dados.** `LEAD_STATUSES` e `FUNNEL_STAGES` carregavam a classe
pronta (`cls: "bg-cyan-500/20 text-cyan-400"`, `accent: "border-violet-500/50"`). Paleta literal
não tem versão de tema claro, e o `leadStatusClass` era o único consumidor. Agora cada entrada tem
`tone: LeadTone`, que é **exatamente** o conjunto de tons do `StatusBadge` — a tela repassa sem
mapear. `leadStatusClass` foi removido (só as três telas desta tarefa o usavam; conferi os
chamadores antes). Consequência: quem quiser uma cor nova para um status mexe em um lugar só;
o preço é que as etapas do funil agora reutilizam seis tons em vez de oito cores distintas.

**`sourceBadgeCls` e `sourceStyle` viraram `leadSourceTone`.** A mesma regra ("WhatsApp é verde")
estava copiada no `LeadDetailModal` e no `LeadFunnel`, com verdes diferentes — era metade do T13.
Agora é uma função em `leads.ts`.

**A tabela colapsa em vez de rolar de lado.** Primeira versão deixava a `<Table>` rolar dentro do
próprio container: a página não ganhava barra horizontal (critério cumprido), mas a 375 px o botão
**Atender** ficava fora da tela — o corretor no celular tinha que rolar de lado para atender o
lead. Abaixo de `lg`, Etapa/Origem/Corretor/Recebido somem e voltam como badge e linha de apoio
embaixo do nome. Consequência: duas representações do mesmo dado no mesmo componente; era isso ou
uma segunda árvore de layout só para o celular.

**O estado dos diálogos é um objeto só.** Eram 6 `useState` na página. Virou `LeadDialogState` +
`openDialog(patch)`, e o `LeadDialogs` monta cada diálogo **só enquanto aberto**, com `key` por
lead no formulário. É isso que dispensa o `useEffect` copiando prop para estado — o formulário
abria com os dados do lead anterior quando o efeito perdia a corrida.

**`useLeadDetail` só consulta com o modal aberto.** O `LeadDetailModal` é montado pela tela
inteira; sem `enabled`, cada lista de leads dispararia três requisições por lead que ninguém abriu.

**Limites na importação.** 8 MB e 5 000 linhas, com mensagem própria em pt-BR. Não substituem a
troca do `xlsx` (S06): seguram o caso de planilha grande travar a aba, porque o parser roda na
thread principal. O CSV passou a respeitar aspas — endereço com vírgula quebrava a linha em duas
colunas e o telefone ia para o campo errado.

**Nenhuma `celebrate()` foi adicionada.** O `EngagementLayer` continua sendo o único dono das
comemorações de `checkin` e `lead_claimed`, por realtime. O toast de "Lead em atendimento" que já
existia foi mantido (é texto, não som).

---

## 5. A06 — quem adota o quê

`ConvertLeadDialog` (`src/components/leads/ConvertLeadDialog.tsx`) é agora o **único** dono de
`convertForm`, `pickDeveloper` e da chamada a `convert_lead_to_deal`. Ele é o **superconjunto** das
duas versões que existiam: o anexo inicial que só o Pipeline tinha entrou como opcional, então
**o agente H pode adotar sem perder nada**:

```tsx
{convertingLead && (
  <ConvertLeadDialog
    lead={convertingLead}
    onClose={() => setConvertingLead(null)}
    onConverted={() => { void fetchDeals(); setActiveTab("deals"); }}
  />
)}
```

Some do `Pipeline.tsx`: `convertForm`, `convertProjects`, `convertDoc`, `convertFileRef`,
`openConvertLead`, `pickConvertDeveloper`, `confirmConvert` e o `<Dialog>` inteiro (~110 linhas).
**Não editei `Pipeline.tsx`** — é arquivo do H.

---

## 6. O que ficou de fora, e por quê

- **S06 — `xlsx` 0.18.5 (CVE-2023-30533, CVE-2024-22363).** Continua parseando planilha de
  terceiros na thread principal. Trocar por `exceljs` ou pelo build de `cdn.sheetjs.com` mexe em
  `package.json`, que colide com H e K. Os limites de tamanho/linhas em `importSheet.ts` reduzem a
  superfície, **não fecham o buraco**: a correção é a troca da dependência.
- **`Checkin.tsx` ficou com 290 linhas.** A decomposição pedida era do `Leads.tsx`, e os únicos
  arquivos novos que eu podia criar eram em `src/components/leads/` — pôr um bloco de check-in ali
  seria mentir sobre o dono. Se quiser abaixo de 250, o caminho é `src/components/checkin/` com
  `ShiftWindows` e `CheckinPanel`.
- **`LeadDetailModal.tsx` ficou com 489 linhas.** Mesma razão: as 7 abas caberiam em
  `src/components/leads/LeadDetailTabs.tsx`, mas não era a decomposição pedida e mexer nas 7 abas
  no fim da sessão trocaria risco por estética.
- **Dois estilos de toast (parte do A05).** `Checkin.tsx` usa `sonner`, `Leads.tsx` usa
  `@/hooks/use-toast`. Unificar toca telas de outros agentes; mantive cada arquivo no que já usava.
- **`describeError` no resto do app** (`Equipes`, `AdminLeadAutomation`, `Links`, `DataManagement`…)
  continua pendente — são os 30–45 toasts restantes do A05.
- **Realtime de `distribution_queue`.** O `QueuePosition` já assina `checkins` e `lead_assignments`
  por conta própria (arquivo de ninguém nesta tarefa); não dupliquei.

---

## 7. Capturas

`docs/design-system/` — 8 arquivos de tela cheia + 3 de estado, `deviceScaleFactor: 2`:

| Arquivo | O quê |
|---|---|
| `leads-{dark,light}-{1280,375}` | Lista de leads nos dois temas e nas duas larguras |
| `checkin-{dark,light}-{1280,375}` | Check-in nos dois temas e nas duas larguras |
| `leads-detalhe-dark-1280` | `LeadDetailModal` aberto pela lista, com as 7 abas |
| `leads-importar-dark-1280` | Importação com 30 linhas reconhecidas |
| `leads-converter-dark-1280` | Conversão em negócio com o anexo opcional |

**Como foram feitas — leia antes de tirar conclusão dos números.** Não há stack Supabase local do
FACEIMOB nesta máquina (o Docker está com outro projeto) e o harness não tem credencial para logar
na homologação. Então: **sessão encenada no `localStorage` e um PostgREST/GoTrue/Realtime de
mentira servindo fixtures**, com o Vite apontado para ele (`VITE_SUPABASE_URL=http://localhost:5401`).

Diferente da Tarefa F, **os fixtures são sintéticos, não um despejo da homologação**: nomes,
telefones e e-mails foram inventados (`@exemplo.com`). O que é fiel é o *shape* das linhas —
colunas e enums de `0001`/`0005`. Foi de propósito: o que estas capturas provam é layout, token e
estado, não número de negócio; e assim nenhum dado pessoal do banco saiu para um mock.
O mock, os fixtures e os dois scripts ficaram no scratchpad da sessão, **fora do repositório**.

Verificado nas 8 combinações, por código: **nenhuma barra de rolagem horizontal**
(`scrollWidth <= clientWidth`), **um único `<h1>` por tela** e **console sem erro**.

### Verificação de interação (Playwright, contra o mock)

```
✓ clique no nome abre o LeadDetailModal — abas: Dados/Formulário/Comentar/Anexos/Histórico/Agenda/Rastreio
✓ label do EditFields foca o input (X04) — value="11977776622"
✓ nome do cliente tem focus-visible
✓ ?lead=<id> abre o modal — Patrícia Fonseca
✓ ?lead=<id> é consumido da URL — http://localhost:5400/leads
✓ lead fora da lista avisa — "Lead indisponível"
✓ importação conta as 30 linhas (F03) — "Importar 30 leads · 30 leads serão importados de 30 linhas"
✓ diálogo de conversão tem anexo opcional
✓ vazio por filtro oferece 'Limpar filtros'
Console limpo.
```

O contrato do sino (`searchParams.get("lead")` → abre → consome) está provado nas linhas 4 e 5.

---

## 8. Validação

```bash
npm run typecheck   # ✅  (os 3 projects)
npm run lint        # ✅  0 erros, 7 avisos pré-existentes nos meus arquivos (react-refresh)
npx vitest run      # ✅  176 testes, 11 arquivos (1 novo: components/leads/model.test.ts, 9 casos)
npm run build       # ✅  10 s
npx vercel deploy --prod --yes   # ✅  Ready em 28 s
```

**Sobre o deploy.** As duas primeiras tentativas terminaram com `Error: fetch failed` no meio do
envio dos 7,9 MB — mas **a segunda subiu mesmo assim** (`faceimob-cfyt863y5`, Ready). Se você vir
duas produções seguidas no `vercel ls`, é isso. A que está no ar é a terceira (`8g15rlext`).
O primeiro `curl` do hash não bateu porque o `dist/` local era de dois minutos antes e o agente H
gravou arquivos nesse intervalo; refeito o `npm run build`, os dois lados dão
`assets/index-PRU1c-di.js`.

O build publicado inclui o Pipeline do agente H no estado em que o repositório estava às 18h10.
Se o H ainda não terminou, ele republica ao final — o último build ganha, como combinado.

**O que não foi testado contra banco.** Nenhum caminho de escrita rodou contra Postgres real —
importar, converter, realocar, atender e bater ponto foram exercitados só até a chamada. À mão:

| O que testar | Como |
|---|---|
| **Abrir lead pela lista** | Leads → clicar no nome do cliente. Deve abrir o mesmo modal do sino |
| **CSV com 30 linhas** | Leads → Importar planilha → arrastar o arquivo para a área tracejada (não só clicar). Deve dizer "30 leads serão importados de 30 linhas" e o toast final "30 leads importados" |
| **F12** | Bater check-in numa aba e abrir `/checkin` em outra: a segunda tem que trocar para "Check-out" sem F5. Idem para o check-out automático no fim do turno |
| **Converter com documento** | Leads → ícone de converter → anexar um PDF → Converter. O anexo tem que aparecer no negócio |
| **Contadores** | Badge do turno e card "Hoje" com o mesmo número, inclusive depois de realocação manual (regressão do F13) |

---

## 9. O que fazer em seguida

1. **Agente H:** adotar o `ConvertLeadDialog` (§5) e apagar a cópia do `Pipeline.tsx`.
2. **S06:** trocar o `xlsx`. É a única pendência de segurança que sobrou desta tela.
3. `describeError` no resto dos toasts (A05).
4. Se `Checkin.tsx` e `LeadDetailModal.tsx` incomodarem no tamanho, §6 diz onde cortar.
