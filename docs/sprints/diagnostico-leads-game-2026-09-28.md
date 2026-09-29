# Diagnóstico de leads e game — 28/09/2026

## Atualização — ajustes aplicados e verificados às 17:31 BRT

Alisson confirmou que o cliente é **Douglas Gomes** e que, salvo indicação diferente, as referências ao cliente nesta conversa são ao Douglas. Autorizou habilitá-lo para testar a distribuição e configurar a Meta preservando o Leadfy. Também confirmou a conclusão da importação; o resultado está em [carga-bubble-2026-09-28.md](carga-bubble-2026-09-28.md). O diagnóstico inicial abaixo antecede essa carga e estes ajustes.

### Douglas habilitado

- Adicionado `broker`, preservando `admin`, `sdr` e `marketing`.
- Incluído como membro ativo da **Fila Geral**.
- Alterações feitas numa transação, com conferência do perfil e do grupo antes de gravar. Releitura confirmou os quatro papéis, o vínculo ativo e Douglas em **1º na fila**, com o check-in existente. A distribuição está despausada.

### Meta configurada, Leadfy preservado

As credenciais pertencem ao aplicativo **Business**, ID `3692943720990682`. A leitura das inscrições do aplicativo mostrou dois destinos distintos:

| Objeto | Antes | Depois |
|---|---|---|
| `page`, campo `leadgen` | `https://wkgvqzcqtgyugzykxunj.supabase.co/functions/v1/meta-ads-webhook` | `https://app.faceimob.com.br/functions/v1/meta-ads-webhook` |
| `whatsapp_business_account` | `https://chat-api.leadfy.xyz/webhooks/whatsapp` | Preservado, incluindo todos os campos e versões assinados |

O objeto `user` também foi preservado. A configuração de Page/leadgen foi atualizada pela API oficial e as páginas **Faceimob Premium**, **Faceimob Gestão Imobiliária** e **Faceimob Canoas** receberam a assinatura `leadgen` deste aplicativo. As releituras confirmaram as três inscrições e a preservação integral das demais configurações. Nenhum aplicativo de terceiro foi removido.

Portanto, **Douglas não precisa trocar o domínio manualmente**. Os leads de formulários estão configurados para chegar ao FACEIMOB; as conversas de WhatsApp continuam no Leadfy. A conta de anúncios habilitada possui 15 conjuntos ativos destinados a formulários e três destinados ao WhatsApp. Estes últimos não passam a gerar automaticamente registros no FACEIMOB com a configuração de formulários.

### Verificação e limite

- Handshake do callback atual validado com o token cadastrado; a Meta aceitou e ativou a inscrição.
- POST com assinatura HMAC válida e sem eventos aceito pelo webhook, sem criar lead nem enviar mensagem de teste.
- Leitura de um lead existente de cada página com a mesma credencial usada pelo webhook: sucesso nas três, com os campos solicitados pelo código. Os dados pessoais não foram impressos nem copiados ao CRM.
- Configuração completa do WhatsApp/Leadfy comparada antes/depois: idêntica.
- Até 17:31 BRT ainda não havia chegado lead novo da Meta. A entrega completa Meta → registro no CRM → distribuição ainda depende de uma nova submissão; não foi declarada validada por estes testes de configuração.

Snapshot anterior das inscrições, sem tokens: `/opt/faceimob/import/meta-leads-before-20260928.json`. Scripts operacionais locais: `deploy/.server.local/enable-douglas-distribution-20260928.sh`, `configure-meta-leads-20260928.sh` e `verify-meta-intake-20260928.sh` (ignorados pelo Git).

Referência de API usada: [exemplo oficial da Meta para inscrição do aplicativo e das páginas](https://github.com/fbsamples/lead-ads-webhook-sample/blob/main/postman/FB%20Lead%20Ads%20%28Part%201%20-%20The%20Webhook%29.postman_collection.json).

## Diagnóstico inicial — antes da carga e dos ajustes

Consultas de leitura no banco de produção (`app.faceimob.com.br`) e na API da Meta, na tarde de 28/09. Naquele momento, nenhum cadastro, permissão, pontuação ou integração havia sido alterado neste atendimento. Douglas era o autor do único negócio criado depois da abertura do game; sua identidade como a pessoa do áudio foi confirmada posteriormente, acima.

## Game: temporada aberta, mas nenhum evento de pontuação

- A temporada **Setembro 2026** está aberta desde **12/09/2026 às 17:52, horário de Brasília**, com período iniciado em 01/09.
- Os gatilhos de pontuação de negócios, participantes, CCA e documentos estão habilitados. A regra padrão de venda está ativa e vale 600 pontos.
- `game_events` está vazio. Isso explica o ranking corrente zerado.
- Os placares importados estão preservados: **629 resultados em sete temporadas encerradas**, separados da temporada corrente. A importação não recria os eventos individuais desses placares.
- Existe um único negócio criado depois da abertura: `2f42985b-25b0-4324-ab8e-173568efc760`, cadastrado por **Douglas Gomes** em 28/09 às 14:22. Está com **Status 1 VENDA**, **Status 2 04. EM CONTRATO**, etapa **Contrato**, desfecho **em aberto** (`outcome = open`) e sem data de fechamento. O corretor no rateio é **Leonardo da Silveira Vallier**.

A regra atual pontua venda quando o desfecho vira ganho (`outcome = won`), para os corretores do rateio. O Status 1 VENDA sozinho não aciona essa regra. Logo, o negócio observado não deveria pontuar segundo a implementação atual. Se o cliente espera pontuação já em EM CONTRATO/Status 1 VENDA, há uma diferença entre a regra implementada e a regra de negócio esperada; reiniciar o game não resolve isso.

Referências: `supabase/migrations/20260912180000_0142_game_distrato_reabertura.sql` (`deals_award_points` e `deal_participants_award_points`); `supabase/migrations/20260915090000_0149_status_catalogo.sql` (classificação independente da etapa/desfecho); `scripts/import/04-jogo-metas.mjs` (placares congelados).

## Distribuição: habilitada, fila vazia

- A pausa global está desligada e os jobs de distribuição, expiração e checkout estão ativos, com última execução bem-sucedida.
- A Fila Geral está ativa e tem **87 membros ativos**, mas a fila elegível estava vazia na consulta.
- **Douglas Gomes** tem os papéis `admin`, `sdr` e `marketing`; não tem `broker` e não pertence a nenhum grupo de distribuição. Seu check-in da tarde está aberto desde 16:03.
- A tela oferece apenas pessoas ativas com papel `broker`. O motor exige também vínculo ativo com grupo, presença no turno, horário de distribuição e quantidade de leads vencidos abaixo do limite.
- Não há impedimento geral a ADM atuar como corretor: o cadastro aceita vários papéis. Alisson, por exemplo, já possui `admin` e `broker`.

Para Douglas receber leads pela fila, o cadastro precisa incluir o papel Corretor e a participação no grupo desejado. O check-in, sozinho, não basta. Essa inclusão deve ser feita para a pessoa efetivamente indicada pelo cliente; o áudio ainda não foi identificado nominalmente.

Referências: `src/pages/AdminLeadAutomation.tsx` (filtro de participantes) e `supabase/migrations/20260913090000_0148_roleta_independe_da_sessao.sql` (`distribution_queue_interna`).

## Meta: formulários disponíveis, páginas sem inscrições de aplicativos

- Não há leads registrados no CRM desde 26/09, data da migração para a VPS.
- As credenciais de página, Marketing API, segredo do app e verificação do webhook foram cadastradas em 28/09.
- O token armazenado como token de página identifica **Douglas Sistema**. Ele consegue listar três páginas e suas permissões incluem `leads_retrieval` e `pages_manage_metadata`. Isso, por si só, não comprova a entrega do webhook.
- Usando os tokens das próprias páginas, a consulta `/{page_id}/subscribed_apps` retornou lista vazia nas três: **Faceimob Premium**, **Faceimob Gestão Imobiliária** e **Faceimob Canoas**.
- As três possuem formulários acessíveis. Não foi necessário consultar os dados pessoais dos leads.
- Nenhum formulário está mapeado a grupo no CRM. Isso não bloqueia o recebimento: existe Fila Geral ativa para o fallback.

Falta configurar/verificar a assinatura do aplicativo nas páginas que devem enviar eventos `leadgen`, com o callback do ambiente atual: `https://app.faceimob.com.br/functions/v1/meta-ads-webhook`. Não foi possível comprovar nesta leitura a configuração do callback no painel do app. A confirmação final exige uma entrega de teste da Meta seguida do registro e da distribuição no CRM.

Referências: respostas ao vivo da Graph API v25.0; `supabase/functions/meta-ads-webhook/index.ts`; `src/pages/MetaAdsSetup.tsx`.

## Conclusão

A hipótese de ausência de inicialização do game não se confirmou: temporada e gatilhos estão ativos. Os problemas observados são a assinatura das páginas na Meta, a ausência do administrador na distribuição e a diferença entre classificar um negócio como VENDA e efetivamente fechá-lo como ganho para pontuar. Os dados importados do ranking continuam no histórico.
