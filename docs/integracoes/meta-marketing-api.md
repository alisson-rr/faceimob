# Gestão de campanhas Meta — por que ainda não há uma linha de código

O pedido (ata de 14/07): gerenciar campanhas do Meta Ads de dentro do FACEIMOB —
**mudar orçamento, pausar, ativar e copiar campanha**, e ver o gasto sincronizado
ao lado dos leads e das vendas que ela gerou.

Nada disso existe. Este documento explica o que existe hoje, o que falta, e por
que construir agora seria construir errado.

---

## O que existe hoje (e não é isto)

- **`/admin/meta-ads`** configura o **webhook de entrada de leads**: Callback
  URL, geração do Verify Token no cofre, estado das credenciais. É por onde o
  lead do formulário do Meta entra na roleta.
- **`/marketing`** deixa o marketing **cadastrar a campanha à mão** (id externo,
  nome, investido) para cruzar com leads e vendas nos relatórios.

Ambos funcionam e são testados. Nenhum dos dois fala com a **Marketing API** da
Meta. A única URL da Meta no repositório é a de envio de WhatsApp
(`graph.facebook.com/v21.0/<phone>/messages`) — não há `act_<id>`, `/campaigns`,
`/adsets` nem `daily_budget` em lugar nenhum.

### Duas colunas que mentem

`ad_campaigns.synced_at` e `ad_campaigns.status` são **lidas na tela** e nunca
escritas por código nenhum. Medido em 02/09/2026: as seis campanhas da
homologação trazem `synced_at` de 28/07 e 26/08 — tudo seed — e
`CampaignPerformancePanel.tsx:372` escreve *"sincronizado 28/07/2026"* ao lado do
gasto. Quem olha a tela conclui que houve sincronização com a Meta.

A mesma tabela mistura `ACTIVE`/`PAUSED` com `active`/`paused` (dois seeds
diferentes) e o filtro compara sem normalizar: o mesmo estado vira dois valores,
e editar a campanha de status minúsculo mostra o campo Status em branco.

**Decidido em 02/09/2026:** trocar o rótulo por "cadastro manual" e normalizar o
status com `.toUpperCase()` na leitura — minutos de trabalho, nenhuma migration
de dados, e a tela para de prometer o que não acontece. `CampaignPerformancePanel.tsx`
e a página de marketing **não são desta frente**: o diff exato está registrado em
[README.md § Pendências, item 9](./README.md#9-a-tela-de-campanhas-diz-sincronizado-sobre-dado-que-ninguém-sincronizou).

A integração em si só entra em cronograma depois de o Douglas dizer o que a conta
dele permite — o rótulo honesto não espera por isso.

---

## O que falta, e é do Douglas

1. **Acesso ao Business Manager.**
2. **O id da conta de anúncios** (`act_...`).
3. **Um token de sistema com permissão `ads_management`.**
4. **A revisão do app pela Meta** para esse escopo.

---

## Por que isso é bloqueio de verdade, e não desculpa

A ata de 14/07 registra que **a verificação de empresa do ramo imobiliário limita
a automação** na Meta. Contas de imóveis caem em categoria especial de anúncio, e
o que uma conta nessa categoria pode fazer via API — e sob qual revisão de app —
depende do estado daquela conta específica.

Sem saber o que a conta do Douglas pode fazer, não dá para dimensionar: o mesmo
botão "Pausar campanha" pode ser uma chamada de uma linha ou pode ser impossível.
Escrever o código antes de saber significa escolher um caminho no escuro e
descobrir na entrega.

**É o maior escopo não estimado das duas atas.**

---

## O que a implementação vai precisar quando destravar

Registrado aqui para não se perder, e para dimensionar assim que a conta for
conhecida:

- Sincronizar `spend`, `daily_budget` e `status` por id externo, gravando
  `synced_at` de verdade.
- Auditoria: quem mudou orçamento de quanto para quanto, e quando. Mexer em
  dinheiro sem log é o que torna uma discussão de resultado insolúvel.
- Tratar a limitação de categoria como **dependência visível na tela** — botão
  desabilitado com o motivo escrito — e nunca como sucesso falso. Um botão que
  erra em silêncio por falta de permissão é pior que um botão que não existe.

---

## Antes de dimensionar: tirar da tela a promessa falsa (06/09/2026)

A pergunta levada ao dono foi: *antes de dimensionar a Marketing API, tiramos da
tela `synced_at` e `status` mostrando dado de seed como se fosse sincronização
real?* A resposta é **sim** — custa minutos e para de mentir; a integração em si
só entra em cronograma depois de o Douglas dizer o que a conta dele permite.

**O que foi medido.** `ad_campaigns.synced_at` é lida em
`src/integrations/supabase/analytics.ts:87` e renderizada em
`src/components/CampaignPerformancePanel.tsx:372` como
`sincronizado {data}`. **Nenhuma linha de código escreve essa coluna** — a busca
por `synced_at` acha o `create table` da 0011, três arquivos de seed
(`040`, `050`, `060`) e nada mais. Quem abre `/marketing` e vê "sincronizado
28/07" conclui que houve troca de dados com a Meta. Nunca houve.

**Por que a correção não está numa migration desta rodada.** Um
`update public.ad_campaigns set synced_at = null` deixaria a tela honesta até o
próximo `db:reset`, quando os três seeds repõem o valor. Fix que o seed desfaz é
pior do que fix nenhum: parece resolvido. A correção tem de estar na tela **e**
nos seeds, arquivos de outra frente.

### Diff 1 — a tela para de prometer sincronização

`src/components/CampaignPerformancePanel.tsx:372`

```diff
-                          {r.syncedAt ? `sincronizado ${date(r.syncedAt)}` : "digitado"}
+                          cadastro manual
```

Enquanto a Marketing API não existir, TODA campanha é cadastro manual — o
ternário só consegue escolher entre uma verdade e uma mentira.

### Diff 2 — os seeds param de fabricar a data

`supabase/seeds/040_reports_game_workspace.sql:126`,
`supabase/seeds/050_test_scenarios.sql:426` e
`supabase/seeds/060_demo_showcase.sql:997`: remover `synced_at` da lista de
colunas e o valor correspondente. Dado de demonstração pode ser fictício; não
pode afirmar que uma integração aconteceu.

### O que fica de pé

`status` já foi tratado por outra frente: o painel guarda `rawStatus` e trata o
vazio (`SEM_STATUS`), então editar campanha semeada não apaga mais o campo. Falta
apenas a **normalização de caixa** — `'ACTIVE'` e `'active'` são hoje dois
valores distintos no filtro e no rótulo. Um `.toLowerCase()` na leitura de
`analytics.ts` resolve, e é a mesma frente do diff 1.

### Auditoria de orçamento — quando a integração entrar

Não existe registro de quem mudou o orçamento de quanto para quanto e quando.
Mexer em dinheiro sem log torna qualquer discussão de resultado insolúvel, então
a tabela de auditoria é **pré-requisito** do primeiro botão que escreva
`daily_budget` na Meta — não um item posterior.
