# Ajustes pedidos pelo cliente (Douglas) — 10/09/2026

Fonte: lista do cliente + rodada de perguntas de 10/09/2026. Branch: `main`.

## Regras que valem para a lista inteira

- **"Administrador" inclui o Sócio.** Mesma permissão, sem exceção. Onde a lista
  diz "só adm", leia "admin **ou** sócio".
- **Ordem de ataque:** onda A (quebrado / travas erradas) → onda B (regras e
  telas) → onda C (novidades) → onda D (adiado a pedido do cliente).
- Prints de referência: `DOCUMENTOS/DOCs e PRINTs/`.
- Áudio de premiação: `public/senna.weba` (variação licenciada, fornecida pelo
  cliente).
- Logo: `public/LOGOTIPO + Texto.png` e `public/LOGOTIPOpng.png`.

## Já estava feito (verificar no build local antes de mexer)

Exportação já é `.xlsx`; já existe trava `pipeline.export`; corretor já vê só a
própria posição no ranking; Status 1 nunca teve número; menu já fundido em
Principal + Configurações; Links já fora do menu; não existe atalho de check-in
no Pipeline.

---

## Onda A — quebrado ou travado errado

| # | Item | Arquivos-dono |
|---|---|---|
| A1 | Sócio (`partner`) passa a ter permissão de admin no front e no banco | `src/contexts/AuthContext.tsx`, migration 0097 |
| A2 | Status 2 sem prefixo numérico na tela, ordem mantida, os dois "15." mantidos, valor gravado inalterado | `src/components/pipeline/statuses.ts`, `src/lib/dealStatus.ts` |
| A3 | Abrir negócio pelo clique na linha + ícone dedicado | `src/components/pipeline/DealsTable.tsx` |
| A4 | Cores por tempo parado: verde 0–3, amarelo 4–9, vermelho 10+ | `DealsTable.tsx`, `DealCard.tsx` |
| A5 | Cor por corretor mais visível (nome colorido; bolinha da construtora fica) | `DealsTable.tsx`, `DealCard.tsx` |
| A6 | X duplicado no modal do negócio | `src/components/DealDetailModal.tsx` |
| A7 | Travas: Status 1, edição de proposta, OFF e DISTRATO — só admin/sócio | `src/pages/Pipeline.tsx`, `DealForm.tsx`, `guards.ts`, migration 0098 |
| A8 | Remover aba Leadfy (importador genérico continua em /leads) | `src/pages/DataManagement.tsx` |

## Onda B — regras, permissões e telas existentes

| # | Item |
|---|---|
| B1 | Checkpoint deixa de ser link público; vira tela logada com hierarquia (adm/sócio veem todos · diretor vê o dele + gerentes dele, e entra no do gerente · gerente vê o dele) |
| B2 | Equipes: só adm/sócio; front mostra só nome e foto; desligar corretor; modal de novo corretor com a ficha completa |
| B3 | Equipes: aba de credenciais (nome / login / senha / link), visível só para adm/sócio, com registro de quem revelou |
| B4 | Definir senha do corretor pelo admin, guardada no cofre |
| B5 | CCA: clique no card abre o mesmo modal do Pipeline, com as permissões da CCA |
| B6 | Comentários do negócio: cor por usuário e destaque melhor na leitura |
| B7 | Anexo tipo "outros" aceita vários arquivos; apelido editável |
| B8 | Gerente: lista com recorte só do time dele |
| B9 | Dashboard: validar ordenação |
| B10 | Toast "cadastrado com sucesso" centralizado e mais bonito |
| B11 | Game: filtro semanal (segunda a domingo) sobre a pontuação da temporada |

## Onda C — novidades

| # | Item | Referência |
|---|---|---|
| C1 | Card de game no topo do Pipeline: corretor vê a própria barra + meta; gerente/diretor/admin veem pódio de 3 | `card de game ... corretor.png`, `... gerente diretor e admin.png` |
| C2 | Modal "Painel": abre automático 1×/dia para corretor, clicável por todos. Funil próprio + Recados/Dica de Ouro + Destaques. Recorte: corretor vê top 3 da equipe · gerente vê os corretores dele · diretor idem · admin vê o rank completo | `modal ao abrir pipeline.png` |
| C3 | Gráfico quadrado no Dashboard: grade mês × ano com total anual, faturamento do mês e do ano | `grafico quadrado.png` |
| C4 | Editar meta pelo Dashboard |
| C5 | Cards superiores do Dashboard no estilo do Bubble |
| C6 | Som de premiação (`senna.weba`) ao atingir marco |
| C7 | Logo nova aplicada (login, sidebar, favicon, exportação) |
| C8 | Cores mais chamativas nos destaques | `ref de cores.jpeg` |
| C9 | Mais respiro nos cards grandes; visual mais clean |
| C10 | Responsividade validada |
| C11 | Marketing: importar relatório da Meta |
| C12 | Equipes: tela de pessoa / perfil |

## Onda D — adiado pelo cliente

| # | Item | Motivo |
|---|---|---|
| D1 | Push (celular e desktop), só novo lead e avisos | "pode ficar pra depois" |
| D2 | Medalhas e prêmios gravados no perfil | "melhoria, não implantação" |
| D3 | Notificação por e-mail | "era para ter, mas fica por último" |
| D4 | Tela Links | fica oculta como está, não apagar |

---
## Placar final — 10/09/2026

Validação na árvore final: `npm run typecheck`, `npm run lint`, `npx vitest run`
(**1089 testes**) e `./scripts/validate-schema.sh --all` (**105 migrations**, seed
e **57 arquivos de assert SQL**; 65 tabelas, 135 policies, RLS em todas) — os
quatro verdes. Inventário conferido no código, item a item, não no relato.

**Onda A — 8 de 8.** Sócio com permissão de administrador na raiz do banco ·
Status 2 sem número na tela com o valor gravado intacto · abrir pelo clique na
linha com ícone dedicado · cores em 3 faixas · cor por corretor · X duplicado ·
travas de etapa e desfecho · aba Leadfy fora.

**Onda B — completa**, com a ressalva do B8 (o recorte do gerente virou filtro
padrão, não mudança de policy).

**Onda C — parcial.** Feitos: card de game nas duas visões, modal Painel, grade
anual, editar meta, som de premiação, cores dos destaques, respiro e
responsividade, importador de relatório da Meta, perfil da pessoa. Ver as
pendências abaixo.

**Onda D — não iniciada**, por decisão do cliente.

---

## Pendências que precisam do cliente

1. **Corretor não avança o próprio funil nem registra venda.** Consequência de
   "Status 1 é só o administrador" ao pé da letra. Reversível em
   Admin · Permissões → Etapas, sem código.
2. **"Edição de proposta só admin" foi retirada no caminho.** A primeira versão
   travou o Status 2 inteiro e quebrou três fluxos de produção (agendar visita,
   CCA aprovar, corretor encerrar). A trava ficou só em **OFF e DISTRATO**, que
   é o que o cliente escreveu em outro item da lista. Se ele quiser o Status 2
   inteiro restrito, é decisão nova — e volta a quebrar os três fluxos.
3. **Logo (C7): dependência externa.** O arquivo entregue é byte a byte igual ao
   que já existia, com a letra branca. Falta a marca fornecer o lockup de letra
   escura com fundo transparente (SVG ou PNG @2x). Até lá a logo tem contraste
   ruim no tema claro. O paliativo visual que havia sido inventado foi removido.
4. **Cards superiores do Dashboard (C5): sem referência.** Falta o print do
   Bubble.
5. **Respiro (C9): o pedido tem duas leituras opostas.** O código *reduziu* a
   folga abaixo do breakpoint pequeno, atendendo "card gigante"; acima dele nada
   mudou. Se "mais respiro" significava aumentar a folga no desktop, é o
   contrário do que está no ar.
6. **Perfil da pessoa (C12) é um modal, não uma rota.** Se a intenção era uma
   página com URL própria — para mandar o link de alguém — o item não está
   atendido como o cliente imagina.
7. **Responsividade (C10) sem prova executável nas telas novas.** Pipeline,
   Dashboard, card de game, modal Painel e grade anual não têm teste em viewport
   de celular.
8. **"Copiar o gestão de anúncios"** já existia antes desta rodada
   (`CampaignPerformancePanel`, migration 0089). Só a segunda metade do pedido —
   importar o relatório — foi construída agora.

## Ordem de publicação

As migrations sobem **antes** do front. Marketing passou a ler colunas que só
existem a partir da 0113, e a aba de anexos precisa da 0106.

---

## Meta Ads — fase 1 e fase 2 (decisão de 11/09/2026)

Referência técnica: repositório `dg-jarvis-os` (sistema da agência). Trazer =
**reescrever no padrão do FACEIMOB** usando o Jarvis como referência de chamadas
e regras de contagem — não copiar código (o Jarvis inventa número quando a Meta
falha, tem funções sem login e guarda chave de IA em texto puro).

**Fase 1:** conectar a conta de anúncios · sincronização diária automática no
mesmo livro de gasto da planilha · pausar, ativar e mudar verba na Meta pela
tela · resultado separado por formulário, WhatsApp e landing page · aviso de
saldo · alertas de CPL, gasto sem lead e verba do mês · transcrição de áudio do
lead no WhatsApp.

**Fase 2:** nota por anúncio (escalar, manter, cortar) · gestor de tráfego IA
com fila de aprovação · planejador de campanha para imóvel · resumo diário de
marketing no WhatsApp · caixa de conversas completa.

**Sem fase:** padrão de nome de campanha.

**Fora:** criar, duplicar ou renomear campanha na Meta · relatório público ·
estúdio de arte · comando pelo WhatsApp · agentes e cockpit · visão de agência.

**Para ligar:** token de usuário de sistema do Business Manager, guardado no
cofre pela tela Admin · Meta Ads. O código lê do cofre; sem token, nada liga.

### Meta Ads — antes de publicar

**Ordem obrigatória.** Publicar fora dela quebra telas que já existiam:
1. **Migrations 0115 a 0121.** Sem a 0115, a tabela de campanhas do
   /marketing fica vazia. Sem a 0120, "Assumir conversa" dá erro e a resposta
   do atendente some do histórico.
2. **Edge functions novas:** `meta-ads-connect`, `meta-sync`,
   `meta-campaign-action`, `meta-ad-scores`, `meta-campaign-planner` e
   `meta-traffic-manager`. **Republicar** `meta-ads-webhook`,
   `whatsapp-inbound-webhook`, `sdr-whatsapp-broadcast` e `notify-dispatch`.
3. **Front.**

**Checagens que esta máquina não fez** (Docker e Deno indisponíveis):
- `./scripts/validate-schema.sh --all` com o Docker ligado. Os testes SQL
  passaram num PostgreSQL local, que não é a versão do Supabase.
- `deno check` nas seis edge functions novas e nas quatro republicadas.
- Nada foi testado contra a Meta real, porque falta o token. Se a Meta recusar
  algum filtro de status na sincronização, a falha aparece na tela, com a frase
  e a data da última sincronização boa.

**Para ligar:** token de usuário de sistema do Business Manager, com
`ads_read` e `ads_management`, guardado no cofre pela tela Admin · Meta Ads.

**Urgente, independe do resto:** o `sdr-whatsapp-broadcast` usava a Graph API
v20.0, que a Meta desliga em 24/09/2026. Ele passou para a versão central
(`META_GRAPH`), mas **só vale depois de republicado**.

### Meta Ads — estado em 12/09/2026

**Implementado:** os 13 itens da fase 1 e da fase 2, em 13 frentes. Depois
disso vieram quatro rodadas de conferência adversarial e de correção. As
migrations são da 0115 à 0125.

**Validação:**
- typecheck, lint e vitest (1.279 testes) passam.
- Suíte SQL completa no PostgreSQL 18 local: 116 migrations, 64 arquivos de
  teste e RLS em todas as 73 tabelas.
- Falta o harness oficial (`validate-schema.sh`, PG 15 no Docker), o
  `deno check` e um teste contra a Meta real.

**Correções que valem saber:**
- **Furo de segurança anterior à integração.** O `requireServiceRole` aceitava
  qualquer token que se dissesse "service_role", sem conferir a assinatura.
  Pelo `meta-ads-webhook`, qualquer um injetava lead e podia fazer o robô
  disparar WhatsApp. Fechado no código. **Continua aberto no ar** até
  republicar as funções que importam `_shared/auth.ts`: `meta-ads-webhook`,
  `notify-dispatch` e `submission-dispatch` (e as novas `meta-sync` e
  `meta-traffic-manager`).
- **Livro de gasto.** Um mesmo nome de campanha só tem gasto numa linha: a
  manual e a sincronizada não recebem os mesmos dias, nem por planilha nem por
  sincronização, nem em importações simultâneas. A importação que perderia
  dias é recusada, com os intervalos exatos. Conta de anúncios com campanha
  não se apaga: se desliga.
- **Roleta:** o comportamento de antes foi mantido. Conversa assumida por um
  SDR **não** segura o lead fora da roleta.

**Publicação:** migrations 0115 a 0125 primeiro, depois as edge functions e por
último o front, como descrito acima. Vale acrescentar `submission-dispatch` à
lista de republicação.

**Limites conhecidos (ponytail):**
- A corrida entre a sincronização e uma importação no mesmo instante continua
  possível.
- Uma parada da sincronização maior que 90 dias deixa buraco.
- O `types.ts` precisa ser regenerado para as tabelas e funções novas.
