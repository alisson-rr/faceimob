# Handoff C — Cenário de demonstração, usuário do cliente e deploy

25/08/2026 · branch `nova` · **nada commitado**.
Depende das Tarefas A e B, já entregues. O deploy publica o estado atual da branch.

**URL do cliente: https://faceimob.vercel.app**

---

## 0. O que apareceu no caminho e mudou o escopo

A homologação estava na **migration 0025**. As migrations `0026`–`0031` nunca
foram aplicadas lá, e o frontend da branch `nova` depende delas:

| Faltava no remoto | Quem chama | Tela que quebrava |
|---|---|---|
| `deal_participant_names()` | `listLegacyDeals` | **Pipeline e Dashboard** |
| `visible_game_ranking()` | `game.ts` | **Gamificação** |
| `current_work_date()` | `checkin.ts` | **Check-in** |
| `deals.document_review_*` | `newSchema.ts`, `documents.ts` | Pipeline (aba Anexos) |
| `marketing_campaign_stats()` | `Marketing.tsx` | **Marketing** |
| `import_remarketing_list()` | `SdrModule.tsx` | SDR |

Ou seja: o caminho inteiro da demonstração abriria em erro. Sem resolver isso,
nenhum dado de cenário adiantaria.

**Apliquei as seis migrations na homologação** e registrei cada uma em
`supabase_migrations.schema_migrations` com a versão do arquivo — então um
`supabase db push` futuro as vê como já aplicadas e não tenta repetir. As seis
são aditivas (funções, policies, uma coluna nova em `deals` com backfill);
nenhuma apaga dado. Depois disso os crons continuam saudáveis.

> Isto estava previsto como tarefa sua ("Confirmar `supabase db push` quando a E
> rodar"). O `db push` ainda vale quando a Tarefa E entregar a `0032`; o que já
> foi aplicado não vai atrapalhar.

Segunda descoberta, esta boa: **`npx supabase db query --linked` fala com o
banco pela Management API**, usando o login que a CLI já tem — sem senha de
banco e sem service role key. Foi preciso rodar `supabase link` uma vez (o
projeto estava "linkado" por um arquivo legado, e a CLI caía num host que só
responde em IPv6). É esse o transporte que o `showcase` usa.

---

## 1. Arquivos entregues

| Arquivo | O que é |
|---|---|
| `supabase/seeds/060_demo_showcase.sql` | Fase 6 — o cenário. Faixa de UUID `80000000…8f000000` |
| `supabase/seeds/069_demo_showcase_rollback.sql` | Desfaz a fase 6 e devolve o que ela alterou |
| `scripts/demo.mjs` | Subcomandos `showcase` e `showcase:limpar`; `preparar/lead/limpar` intactos |
| `scripts/create-user.ps1` | `-Password` (cria com senha) e `-SetPassword` (troca a de quem já existe) |
| `docs/demo/roteiro-cliente.md` | O passo a passo do cliente, com os números de cada tela |
| `vercel.json` | Fallback de SPA — sem ele, F5 em `/pipeline` dá 404 |

Nada em `src/`. Nenhuma migration nova.

---

## 2. O que foi aplicado no remoto

`node scripts/demo.mjs showcase --remote`, com o cenário **ativo agora**.

| Item | Valor |
|---|---|
| Pessoas criadas pelo cenário | 8 (6 corretores, 1 gerente, 1 diretor) |
| Corretores no total | 13 |
| Equipes ativas | 3, sob 2 diretorias |
| Leads do cenário | 60 (73 no total) |
| Negócios do cenário | 25, cobrindo as 9 etapas (31 no total) |
| Vendas fechadas | 7 |
| VGV líquido do cenário | R$ 10.329.060,00 |
| Documentos anexados | 63 |
| Casos no CCA | 9 (12 no total) |
| Eventos de jogo na temporada aberta | 77 |
| Metas | 10 — inclusive a **global de vendas do mês (14)** |
| Tarefas / visitas / notificações não lidas | 5 / 5 / 5 |
| Aportes de marketing do mês | R$ 37.900,00 |
| Diários de equipe | 3 |

Pódio da temporada **Agosto 2026**: Ana Oliveira **2.360** (3 vendas) · Diego
Costa **2.250** (2) · Rafael Nogueira **1.320** (1). A temporada **July 2026**
foi encerrada pelo seed e ficou com 5 colocações congeladas em
`game_season_results` — é o histórico que a tela mostra como "(fechada)".

**Pendência operacional nº 1 de `decisoes.md` está resolvida** enquanto o
cenário estiver aplicado: o Dashboard lê `goals` (`scope='global'`,
`metric='sales'`) e agora acha a linha do mês corrente. Continua sem UI para
cadastrar — virar o mês sem rodar o seed traz o "—" de volta.

### Validação executada

- `showcase --remote` **duas vezes seguidas**: mesmos números, sem erro.
- `showcase:limpar --remote` **duas vezes seguidas**: sem erro.
- Depois do rollback, **as 16 contagens conferidas voltaram exatamente ao estado
  anterior** (leads 13, negócios 6, perfis 15, equipes 2, metas 6, eventos de
  jogo 6, congelados 3, avatares 0, diários 4, aportes 4, campanhas 3, anuais 3,
  tarefas 4, visitas 3, notificações 56, usuários do cenário no Auth 0), a
  temporada de julho voltou a ficar aberta e o testador manteve os dois papéis.
- Ciclo completo também num Postgres descartável (Docker), com migrations +
  seeds 010–050 antes: `060 → 060 → 069 → 069 → 060`, fases 1-5 preservadas.
- Três movimentos do Pipeline conferidos no banco como admin autenticado, sem
  gravar nada: **Incompleto → Em Análise é recusado** com "A documentação
  precisa ser aprovada pelo gerente antes de entrar no CCA."; **Contrato →
  Fechado** e **Proposta → Visita Agendada** passam.
- `npm run lint` (0 erros, 7 avisos pré-existentes) · `npm run typecheck` ·
  `npx vitest run` (129 testes) · `npm run build`.

---

## 3. Deploy

**https://faceimob.vercel.app** — projeto `alissons-projects-b1faee75/faceimob`,
alvo production, status Ready.

Verificado na URL publicada:

- o login abre (campos E-mail/Senha + "Receber código por e-mail");
- **F5 em rota interna não dá 404**: `/pipeline` e `/checkin` respondem 200 com
  o shell do app — é o `vercel.json`;
- console sem erro, todos os assets 200, nenhuma falha de rede ou CORS;
- o bundle aponta para o Supabase certo e **não contém a service role key**;
- a RPC anônima responde 200 a partir da origem publicada.

As três variáveis públicas estão em production e preview. A CLI recusa variáveis
com prefixo `VITE_` sem `--visibility config --no-sensitive` nesses ambientes —
ela sabe que esse prefixo vai para o navegador. Comandos completos no roteiro.

O **login por senha não foi testado por mim**: exige criar conta e digitar
credencial, que não é coisa que eu faça. É o item 3 da sua lista abaixo.

---

## 4. O que só você pode fazer

1. **Criar o usuário do cliente — e nesta ordem.** Notificações, tarefas e
   presença são gravadas para a conta que existir quando o seed roda. Se a conta
   nascer depois, esses itens ficam com outra pessoa e um novo `showcase` **não
   os move** (os UUIDs já estão ocupados). Então:

   ```bash
   node scripts/demo.mjs showcase:limpar --remote
   ```

   ```bash
   npm run user:create -- -Email <email-do-douglas> -FullName "Douglas" -Role admin -Password
   ```

   ```bash
   node scripts/demo.mjs showcase --remote
   ```

   A senha é pedida na hora, oculta. O `showcase` já vincula esse usuário como
   corretor da Equipe Paulista e o coloca na fila geral, além de admin.

2. **Template do e-mail com o código** — colar
   `supabase/templates/magic_link.html` em Authentication → Emails → Magic Link.
   É o mais urgente: sem ele o e-mail chega **sem código nenhum** para digitar.
   `supabase config push` existe na CLI 2.110.0 e cobre a seção, mas empurra o
   `config.toml` inteiro (47 linhas, quase só `db.seed` e `functions`) — o que
   ele não declara volta ao padrão no remoto, `site_url` inclusive. **Não rodei
   de propósito.** Detalhe no roteiro.

3. **Testar o login de verdade** com um e-mail externo: senha e, depois do SMTP,
   o código de seis dígitos.

4. **SMTP do Brevo** — desejável, não bloqueia. Sem ele o remetente embutido do
   Supabase recusa endereço fora da equipe do projeto e o código não chega a um
   e-mail externo. O cliente entra pela senha.

5. **Domínio próprio**, se quiser algo melhor que `faceimob.vercel.app`.

---

## 5. Riscos e coisas que valem saber

- **Documentos sem arquivo.** Os 63 anexos do cenário são registros sem arquivo
  no Storage: existem para as regras de etapa funcionarem (as etapas do CCA em
  diante exigem documento vigente e conferência aprovada). **O download não abre
  nada.** Está avisado no roteiro, na seção "O que ainda não está pronto".
- **A demonstração precisa acontecer dentro de um turno.** Fora de 08:30–12:00,
  13:30–18:00 ou 19:00–21:30 (Brasília), o check-in fica desabilitado e a fila
  aparece vazia — regra de turno, não defeito. O `auto_checkout_expired` fecha em
  até um minuto qualquer presença fora da janela, então o seed nem cria presença
  fora dela.
- **Os leads se mexem sozinhos**, e é o produto trabalhando: os 4 da fila são
  distribuídos pela roleta em até um minuto quando há corretor em check-in; os 4
  atribuídos voltam para a fila quando o prazo estoura. O prazo do cenário é de
  45 minutos em vez dos 5 do produto, só para eles não sumirem antes de o
  cliente abrir a tela. A trava real de 5 minutos se demonstra com
  `npm run demo:lead`.
- **O `showcase` mexe no ciclo do jogo.** Ele encerra a temporada aberta de um
  mês anterior (congelando o placar) e abre a do mês corrente. É o que um admin
  deveria ter feito na virada, e o `showcase:limpar` reabre a anterior. Se a
  Tarefa E mudar o mês-base do ciclo, vale reler o BLOCO 7 do `060`.
- **Uma ponta sem marca no rollback:** a saída da fila geral do usuário da demo.
  A tabela tem chave composta e nenhuma coluna de origem, então se o usuário já
  estivesse na fila antes, o `069` o remove mesmo assim. Recolocar é um clique em
  Automação de Leads. Está anotado como `ponytail:` no arquivo.
- **`vercel link` mexeu em dois arquivos fora do meu escopo**, como efeito do
  comando oficial: acrescentou `.vercel` e `.env*` ao `.gitignore` e criou
  `.env.local` com um `VERCEL_OIDC_TOKEN` (ignorado pelo git, renovado sozinho).
  O padrão `.env*` também casa com `.env.example`, mas esse arquivo já é
  rastreado, então nada muda na prática — vale limpar quando alguém for commitar.
- **O projeto da Vercel ficou conectado ao repositório GitHub
  `alisson-rr/faceimob`.** Push na branch padrão dispara deploy automático.
  Confira antes de mexer no remoto.
- **Bug de ordem que quase passou, registrado para quem for mexer no seed:** o
  trigger `deals_add_creator_participant` (migration 0012) inscreve
  `deals.created_by` como Corretor 1. Na primeira versão o `created_by` era o
  admin do seed — resultado: o admin virava corretor de todos os negócios sem
  lead e **levava metade do rateio de VGV**. Agora `created_by` é o corretor do
  negócio, e é dele que os participantes são derivados: fonte única.

---

## 6. Comandos

```bash
node scripts/demo.mjs showcase --remote
```

```bash
node scripts/demo.mjs showcase:limpar --remote
```

Pré-requisito, uma vez por máquina:

```bash
npx supabase link --project-ref mcmqgxvtwegtptfseqvw
```

Republicar depois de mexer no front:

```bash
npm run build
```

```bash
npx vercel deploy --prod --yes
```
