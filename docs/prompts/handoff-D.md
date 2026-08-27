# Handoff D — Correções do caminho do corretor

26/08/2026 · branch `nova` · **nada commitado**.
Depende de A (tokens/kit) e B (celebrações), já entregues. É comportamento, não visual:
nenhuma tela foi redesenhada e nenhuma `celebrate()` foi adicionada — o gatilho de
realtime de `lead_events` continua sendo o único dono da comemoração de "atender lead".

Republicado em **https://faceimob.vercel.app** (deployment `dpl_AxuGsB4tGN2BLLMmnBd7XcoPD9HN`, Ready).

---

## 1. O que mudou, por achado

### F05 — "17. DISTRATO" / "18. QUEDA" não marcavam perdido

`src/lib/dealStatus.ts` · `normalizeStatus` tira o prefixo numérico antes de comparar:

```ts
const u = s.toString().trim().toUpperCase().replace(/^\d+\.\s*/, "");
```

Corrige os três chamadores de uma vez, porque todos passam por aqui:

| Chamador | O que estava acontecendo |
|---|---|
| `Pipeline.tsx:596` (`updateDealStatus`, select da tabela) | etapa mantida, `lost_reason` null — o negócio seguia somando VGV e ranking |
| `newSchema.ts:574` (`saveLegacyDeal`) | mesmo defeito ao salvar pelo formulário |
| `Dashboard.tsx:157,168` (contagem de distrato/queda) | distrato com prefixo não entrava na conta |
| `DealDetailModal` | já funcionava (usa o rótulo puro) — e continua |

`isPerda`/`isProducao`/`isResultado` herdam a correção. Teste em `src/lib/dealStatus.test.ts`
(4 casos, com e sem prefixo, incluindo os rótulos que **não** podem virar status:
`"19. REPROVADO"`, `"11. AG. RET. AGENCIA"`, `"RET. ESTEIRA AGIL"`).

### F01 — notificação de lead levava a 404

Dois lados:

1. `NotificationBell.tsx` — `resolveLink()` normaliza `/leads/<uuid>` → `/leads?lead=<uuid>`
   antes do `navigate`. Só o formato exato da migration é reescrito; qualquer outro link
   passa intacto.
2. `Leads.tsx` — aceita `?lead=<id>`, acha o lead na lista e abre o `LeadDetailModal`
   (o mesmo componente que o `LeadFunnel` já usava; nada novo foi criado). O parâmetro é
   **consumido** ao abrir (`setSearchParams` com `replace`): é instrução de navegação, não
   estado de tela. Sem isso, o realtime reabriria o modal que o corretor acabou de fechar,
   e a mesma notificação não funcionaria uma segunda vez.
   Se o lead não estiver na lista (voltou para a fila, foi realocado), sai um toast em vez
   de nada acontecer.

> **Migration pendente (para depois da demo):** a correção na origem é uma linha em
> `notify_lead_assigned` (`0011:207` e `0011:218`), trocando `'/leads/' || new.lead_id::text`
> por `'/leads?lead=' || new.lead_id::text` — ou por `'/leads'` puro. Enquanto ela não
> existir, `resolveLink` segura as notificações antigas **e** as novas. Quando ela existir,
> `resolveLink` continua correto (vira no-op para os links novos) e pode ser removido num
> segundo passo. Está listada na Tarefa E (`D1-E-ciclo-do-game.md`, "link da notificação").

### F03 — importação de CSV/XLSX levava no máximo 10 leads

`Leads.tsx` guardava só `rows.slice(0, 11)` no estado e importava a partir desse mesmo
array. Agora `csvRows` guarda o arquivo inteiro e `csvPreview` é derivado
(`csvRows.slice(0, 11)`) só para a tabela de amostra. O diálogo passou a dizer quantas
linhas o arquivo tem e que a tabela é amostra; o botão importa o total.

### F07 — avisos de documento obrigatório que mentiam

A migration `0028` (decisão de 10/08, `decisoes.md`) tirou a exigência de anexo da conversão:
o negócio nasce sem documento e os obrigatórios travam só o **envio ao gerente**. Foram
removidos/alinhados:

- `Leads.tsx:794` — o parágrafo "O lead precisa de pelo menos um documento anexado" saiu;
- `Leads.tsx:315` — o comentário do `catch` de `doConvert` agora descreve o que de fato barra
  (lead já convertido, falta de permissão);
- `LeadDetailModal.tsx:383` — "A conversão em negócio exige pelo menos um documento" virou
  "O negócio pode ser criado assim; os documentos obrigatórios são cobrados no envio ao gerente";
- `leads.ts` — o comentário de `convertLeadToDeal` cita a `0028` em vez da regra antiga.

### F08 — flash de "Acesso não liberado" e sidebar vazia ao logar

`AuthContext.applySession` nunca voltava `loading` para `true`, então entre o `SIGNED_IN` e
o fim do `Promise.all` a matriz de permissões era a do usuário anterior (vazia) e `can()`
negava tudo. Agora:

```ts
if (loadedForUser.current !== nextSession.user.id) setLoading(true);
```

A comparação com o último usuário carregado é deliberada: `onAuthStateChange` também dispara
em `TOKEN_REFRESHED` e `USER_UPDATED` (o novo card de senha provoca este último). Um
`setLoading(true)` incondicional faria `RequirePermission` devolver `null` e **desmontar a
rota inteira** a cada refresh de token — derrubando filtro, modal e formulário abertos.

### F13 — contadores de check-in divergiam

Havia dois números na mesma tela, de fontes diferentes:

| Onde | Fonte antiga | Problema |
|---|---|---|
| Badge do turno | `checkins.leads_received` | só a roleta (`assign_lead`) incrementa; realocação manual não conta |
| Card "Leads recebidos" | `lead_assignments` com meia-noite **local** | depois das 21h em Brasília o dia local ≠ `current_date` do banco |
| `LeadCounter` | `try/finally` sem `catch` | erro virava spinner eterno |

Unificado sobre `lead_assignments` + `current_work_date()` (migration `0029`):

- `checkin.ts/getLeadCounts` calcula dia/semana/mês a partir da data do banco, em UTC
  (`new Date(workDate + "T00:00:00Z")`), que é o mesmo recorte de `assign_lead` e de
  `checkins.work_date`. Semana começa na segunda.
- `Checkin.tsx` faz **uma** busca (dentro do `Promise.all` que já existia), usa o número no
  badge e passa o mesmo objeto para `<LeadCounter counts={counts} />`. Não há como divergir:
  é a mesma variável.
- `LeadCounter` virou apresentacional (perdeu fetch e realtime; ficou com 35 linhas). A
  assinatura de realtime de `lead_assignments` foi para `Checkin.tsx`, junto do resto.
- Sem número, o card mostra `—` em vez de `0` — e o erro sai num toast (o `catch` do `load()`).
- O `leads_received` por turno continua no card "Janelas de trabalho", agora rotulado
  **"Pela roleta neste turno"**, que é exatamente o que ele mede.

### Contraste no funil

`LeadFunnel.tsx:347` · `bg-destructive text-white` (3,6:1 no escuro) → `text-destructive-foreground`.
Nenhuma cor nova, nenhum hex.

### F16 — 7 abas num grid de 6

`LeadDetailModal.tsx:294` · `grid-cols-6` escondia a aba "Rastreio" e o `h-10` do `TabsList`
cortava o rótulo. Agora `grid grid-cols-4 sm:grid-cols-7 w-full h-auto`: sete colunas a
partir de `sm`, duas linhas em tela estreita, altura pelo conteúdo (`h-auto` vence o `h-10`
pelo `tailwind-merge` do `cn`).

### A04/A05 — erro cru do Postgres na tela

Novo `src/lib/supabaseError.ts`:

```ts
describeError(error, fallback)   // code → frase pt-BR; desconhecido → fallback
dbError(label, error)            // Error com o erro do Postgres preservado
```

- `23505` duplicado · `23503` referência · `22P02` formato · `42501` permissão/RLS → frase
  em pt-BR **sem citar tabela, coluna ou constraint**.
- `P0001`/`P0002` são as nossas `raise exception`: a mensagem já é pt-BR e é repassada
  ("Lead já convertido no negócio X.").
- Qualquer outra coisa (inclusive `Error` comum) → o `fallback` da tela. O texto cru nunca
  chega ao usuário; ele continua na mensagem do `Error` para o console.

Para o `code` sobreviver até a tela, `asError` (`leads.ts`) e os oito `throw` de `checkin.ts`
passaram a usar `dbError`. Adotado nos toasts de `Leads.tsx` (6, incluindo o `loadError`
inline), `LeadDetailModal.tsx` (6) e `Checkin.tsx`. Teste em `src/lib/supabaseError.test.ts`.

Caso à parte: `Checkin.action()` fala com a edge function `broker-checkin`, que repassa as
mensagens pt-BR de `perform_checkin`/`perform_checkout`. Ali o `describeError` não serve (não
há `code` do outro lado do HTTP), então o texto é mantido e só os dois sentinelas em inglês da
function (`unauthorized`, `unknown`) são traduzidos por `FUNCTION_ERRORS`. De quebra, a
extração manual do corpo da resposta virou o helper que já existia, `functionErrorMessage`.

### Senha de acesso (decisão de 21/08, reverte a de 02/08)

`Settings.tsx` ganhou o card "Senha de acesso": nova senha + confirmação, mínimo de 8
caracteres, `supabase.auth.updateUser({ password })`, tudo em pt-BR e com `<Label htmlFor>`.
Se o projeto estiver com **Secure password change** ligado, o erro contém `reauthentication`:
a tela chama `supabase.auth.reauthenticate()`, mostra o campo do código e refaz a chamada com
`{ password, nonce }`. Os erros do GoTrue que o usuário provoca (`weak_password`,
`same_password`, `reauthentication_not_valid`, `over_request_rate_limit`) têm frase própria;
o resto cai num fallback pt-BR.

O texto "Não existe senha nesta conta — nada para vazar, nada para trocar" saiu, junto do
comentário de cabeçalho que dizia o mesmo. "Como você entra" agora descreve os dois caminhos.
O Login com senha é da Tarefa A e já está publicado.

---

## 2. Arquivos tocados

| Arquivo | O quê |
|---|---|
| `src/lib/supabaseError.ts` | **novo** — `describeError` + `dbError` |
| `src/lib/supabaseError.test.ts` | **novo** — 4 casos (códigos, P0001/P0002, fallback, round-trip) |
| `src/lib/dealStatus.ts` | prefixo numérico em `normalizeStatus` |
| `src/lib/dealStatus.test.ts` | **novo** — 4 casos |
| `src/components/NotificationBell.tsx` | `resolveLink` |
| `src/pages/Leads.tsx` | `?lead=`, `LeadDetailModal`, `csvRows`, F07, toasts |
| `src/components/LeadDetailModal.tsx` | `grid-cols-7`/`h-auto`, texto de anexos, toasts |
| `src/components/LeadFunnel.tsx` | 1 classe (contraste do badge "Atrasado") |
| `src/pages/Checkin.tsx` | contadores unificados, realtime, erros pt-BR |
| `src/components/LeadCounter.tsx` | virou apresentacional (`counts` por prop) |
| `src/integrations/supabase/checkin.ts` | `current_work_date` em `getLeadCounts`, `dbError` |
| `src/integrations/supabase/leads.ts` | `asError` → `dbError`, comentário de `convertLeadToDeal` |
| `src/contexts/AuthContext.tsx` | `setLoading(true)` guardado por usuário |

Nada fora da lista de arquivos-dono. Nenhuma migration, nenhum commit.

---

## 3. Validação

```bash
npm run typecheck   # ✅  (os 3 projects)
npm run lint        # ✅  0 erros, 7 warnings (todos pré-existentes, react-refresh)
npx vitest run      # ✅  137 testes, 7 arquivos (2 novos)
npm run build       # ✅  20 s
```

Publicado e carregando: https://faceimob.vercel.app (login renderiza, console limpo).

**O que não foi testado contra banco.** Não há stack Supabase local do FACEIMOB nesta máquina
(o Docker está com outro projeto), e o harness não pode digitar senha em campo de login — então
os itens abaixo têm evidência estática/unitária, não execução ponta a ponta:

| O que testar à mão | Como |
|---|---|
| **CSV com 30 linhas** | Leads → Importar → arquivo com cabeçalho + 30 linhas. O diálogo deve dizer "30 linhas no arquivo (amostra das 10 primeiras abaixo)" e o botão "Importar 30 leads"; o toast final deve dizer 30. Antes: 10. |
| **Notificação → lead** | Rodar `node scripts/demo.mjs demo:lead --remote` para cair um lead; clicar no sino. Deve abrir o modal do lead em `/leads`, não o NotFound. |
| **DISTRATO** | Pipeline → tabela → status "17. DISTRATO". O negócio deve sair de produção (etapa `lost`, `lost_reason = 'Distrato'`). Coberto pelo teste unitário na função; a tela é de outro agente. |
| **Senha** | Configurações → Senha de acesso → definir; depois sair e entrar por senha. Se aparecer o campo de código, é o "Secure password change" do projeto — o fluxo de `nonce` cobre. |
| **Contadores** | Check-in com um lead recebido: badge e card "Hoje" têm que mostrar o mesmo número, inclusive depois de uma realocação manual (era aí que divergiam). |

---

## 4. O que fica para o D3 (agente G — Check-in + Leads)

- **`?lead=<id>` está implementado** e é o contrato do sino. Se a tela de Leads for
  reescrita, preserve: `searchParams.get("lead")` → abrir o modal → consumir o parâmetro.
- **Abrir o lead pela lista** não existe: só o caminho da notificação abre o
  `LeadDetailModal` em `/leads`. Clicar na linha da tabela para abrir o mesmo modal é uma
  linha e um ganho óbvio — ficou de fora por ser mudança de interação, não correção.
- **`LeadCounter` agora recebe `counts` por prop.** Quem renderizar tem que buscar
  (`getLeadCounts`) — foi assim que o número parou de divergir; não volte a buscar dentro dele.
- **`describeError` nos outros arquivos.** Só os quatro desta tarefa adotaram. Os demais
  (`Equipes`, `AdminLeadAutomation`, `Links`, `Pipeline`, `DataManagement`…) continuam com
  `error.message` cru — são os 30–45 toasts do A05. Regra ao adotar: se o erro vier de uma
  função que faz `throw new Error(error.message)`, troque por `dbError(label, error)` primeiro,
  senão o `code` se perde e tudo cai no fallback.
- **`Checkin.tsx:155`** ainda usa `border-amber-500/40 bg-amber-500/10 text-amber-600`
  (paleta literal, pré-existente): é `warning` no token novo. Deixei para a varredura de
  cores da tela, para não misturar visual com comportamento aqui.
- **Migration do F01** (seção 1) — 1 linha, depois da demo.
