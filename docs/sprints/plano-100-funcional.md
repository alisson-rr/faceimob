# FACEIMOB — plano para 100% funcional

**Revisão:** 10/08/2026  
**Cadência:** sprints de 1 semana, com Sprint 0 de 2 dias  
**Capacidade-base:** 1 pessoa desenvolvedora em dedicação integral  
**Prazo-base:** 7 a 8 semanas, mais eventual espera por aprovações da Meta/WhatsApp/IA de voz

Este plano parte do código e dos testes atuais, não dos planos antigos. A base
compila, passa no typecheck, tem 37 testes unitários e 134 testes E2E verdes,
aplica 31 migrations do zero e executa 15 arquivos de regressão SQL. Não existe
mais `test.fixme` e o ESLint fecha com zero erros. Restam sete warnings conhecidos
do Fast Refresh, além da homologação das integrações externas e da
consolidação/publicação das alterações locais.

O objetivo não é reescrever o produto. É corrigir, integrar, provar e implantar
o que já existe; a única construção nova de grande porte é a gestão real de
campanhas pela API da Meta.

## O que significa “100% funcional”

O projeto só será considerado concluído quando todos os itens abaixo forem
verdadeiros ao mesmo tempo:

1. Todas as rotas previstas abrem para os papéis autorizados e recusam os demais.
2. Cada operação crítica grava no banco e sobrevive a reload: leads, negócios,
   documentos, CCA, check-in, diário, marketing, SDR, tarefas e visitas.
3. `npm run build`, `npm run typecheck`, `npm test`, `npm run lint` e o harness
   SQL terminam sem erro.
4. Não existe `test.fixme` para requisito contratado. `skip` só é aceito para
   condição ambiental legítima e explicitamente comprovada.
5. A suíte E2E passa localmente e contra homologação, sem erro inesperado no
   console do navegador.
6. O histórico de migrations local e remoto é idêntico e todas as Edge Functions
   necessárias estão implantadas na versão esperada.
7. OpenAI, Meta Lead Ads, WhatsApp, Brevo e IA de voz foram exercitados com
   credenciais e eventos reais — não apenas mocks.
8. Crons estão ativos, saudáveis e observáveis; reprocessamento não duplica lead,
   mensagem, pontuação nem envio de dossiê.
9. Existe procedimento documentado de deploy, rollback, rotação de segredo e
   recuperação de falha.
10. Um piloto com usuários reais foi aprovado pelo responsável do produto.

## Sprint 0 — congelar a verdade e preparar a entrega

**Duração:** 2 dias  
**Meta:** impedir que código local, banco remoto e documentação continuem
representando versões diferentes do produto.

### Entregas

- Revisar e consolidar os 34 arquivos modificados e 5 arquivos novos atuais.
- Commitar as migrations `0024` e `0025` junto dos testes correspondentes.
- Ligar o repositório ao projeto Supabase autorizado e comparar migrations
  locais × remotas sem aplicar mudança às cegas.
- Definir os três ambientes: local, homologação e produção, com URLs e donos.
- Criar pipeline mínimo de CI: build, typecheck, unitários, lint e harness SQL.
- Corrigir o escopo do ESLint para não varrer artefatos gerados; registrar os
  erros reais do fonte como backlog, sem mascará-los.
- Congelar a lista de requisitos e fechar a decisão documental. Nome do gerente
  visível ao corretor e ranking da equipe foram decididos e entregues na `0027`.

### Aceite

- Árvore Git limpa e código atual preservado em commit.
- CI reproduz localmente a linha de base conhecida.
- Relatório de migrations remotas salvo e sem versão desconhecida.
- Credenciais e decisões pendentes têm responsável e data limite.

## Sprint 1 — acesso, Diário e Checkpoint público

**Meta:** qualquer usuário consegue entrar e os dois fluxos públicos deixam de
ser telas que só aparentam funcionar.

### Entregas

- Aplicar o template OTP de seis dígitos no Supabase remoto.
- Configurar SMTP do Brevo para autenticação e validar entrega real, expiração,
  reenvio e e-mail inexistente sem enumeração de conta.
- Corrigir `public_daily_team` e `public_director_checkpoint`: remover escrita de
  função `STABLE` ou tornar o contrato corretamente `VOLATILE`.
- Fazer o Diário abrir com PIN correto e salvar `daily_reports` e
  `daily_entries`.
- Alinhar o retorno do Checkpoint da diretoria com o frontend
  (`director`, `team_id`, `team_name`).
- Implementar PIN no Checkpoint da diretoria e separar “link inválido” de
  “falha de conexão”.
- Transformar os seis `fixme` dessas duas superfícies em testes verdes.

### Aceite

- Usuário real recebe o código, entra e encerra a sessão em homologação.
- Link público sem PIN, com PIN, desativado e inexistente apresenta o resultado
  correto sem expor dados.
- Gestor preenche o Diário e o resultado reaparece após reload.
- Nenhuma RPC pública nova é concedida ao papel `anon`.

**Status local em 10/08/2026:** Diário e Checkpoint públicos corrigidos pela
migration `0026`; os 17 cenários anônimos passam, incluindo PIN, persistência e
erro de rede. OTP remoto e SMTP Brevo continuam pendentes de configuração.

## Sprint 2 — operação comercial e CCA sem buracos

**Meta:** o caminho check-in → roleta → lead → negócio → documentos → CCA
funciona durante todo o horário operacional.

### Entregas

- ~~Corrigir a data do check-in entre 21h e 21h30: o frontend passa a usar a data
  operacional devolvida pelo banco, não uma data recalculada no navegador.~~
  Entregue na `0029`, com E2E forçando divergência entre os dois relógios.
- ~~Mapear `deals.code` no adaptador e usar o código humano no `naming_pattern`
  `{negocio}`.~~ E2E comprova o nome com `NEG-...`, nunca UUID.
- Validar em homologação as migrations de IP `/32` e ordinal de participantes.
- ~~Fechar a decisão de documento obrigatório e aplicar a trava no ponto escolhido.~~
  Entregue na `0028`: negócio nasce sem anexo; obrigatórios travam o envio ao gerente.
- ~~Cobrir tarefas, visitas e central de notificações com E2E de criação,
  conclusão, atraso, leitura e persistência.~~ Entregue no fluxo do corretor.
- ~~Cobrir a CCA: mudança de etapa, análise, documentos obrigatórios, histórico,
  montagem de dossiê e fila `developer_submissions`.~~ Entregue; a `0030` libera
  ao papel CCA o formulário de análise que já existia no Pipeline.
- ~~Criar smoke positivo para Pipeline, Leads, Check-in, CCA, Equipes e
  Construtoras.~~ Entregue junto de mais oito rotas administrativas.

### Aceite

- Fluxo comercial completo passa sem `fixme`, inclusive no limite noturno.
- Documento recebe nome correto, pode ser baixado e mantém histórico versionado.
- Corretor não perde participantes ou acesso ao salvar o próprio negócio.
- Dossiê entra uma única vez na fila e falha de envio fica visível e reprocessável.

**Status local em 10/08/2026:** nomes dos participantes do próprio negócio e
ranking da equipe entregues pela migration `0027`, sem ampliar
`auth_visible_profiles`; testes de banco provam que o lead do colega continua
privado e os E2E do corretor cobrem múltiplos gerentes e equipe × equipe rival.

Conferência documental entregue pela migration `0028`: corretor envia o dossiê
completo, todos os gerentes vinculados são avisados, um deles aprova ou devolve
com motivo obrigatório, e a aprovação cria o caso no CCA/move o negócio para
Em análise na mesma transação. O Pipeline mostra e filtra a fila gerencial. Os
15 arquivos de teste SQL e os E2E dedicados passam localmente. A `0029` eliminou o buraco
noturno do check-in, e o código humano passou a nomear os anexos. Tarefas,
visitas e notificações agora têm prova de persistência. A `0030` fechou a CCA:
análise, decisão, auditoria, dossiê e retry foram exercitados pela interface.

## Sprint 3 — Marketing e SDR coerentes com permissões

**Meta:** eliminar falsos “salvo”, números incorretos e operações que a interface
oferece ao papel errado.

### Entregas

- ~~Alinhar permissão de aporte entre frontend e RLS.~~ Admin e marketing editam;
  diretor permanece somente leitura.
- ~~Criar agregação segura para leads por campanha.~~ A RPC
  `marketing_campaign_stats` entrega somente contagens, inclusive de leads já
  distribuídos, sem expor dados pessoais.
- ~~Adicionar `welcome_template_id` ao formulário de origem.~~ O SDR cadastra a
  origem e vincula agente/template existente; conteúdo do template continua sob
  admin/marketing.
- ~~Tratar update que afeta zero linhas como recusa, nunca como sucesso.~~
- ~~Tornar importação de remarketing transacional.~~ A RPC
  `import_remarketing_list` desfaz a lista inteira se qualquer contato falhar.
- ~~Autorizar o usuário antes de consultar secrets no broadcast do WhatsApp.~~
- ~~Exibir o corpo legível dos erros das Edge Functions, incluindo a credencial
  ausente da OpenAI.~~
- ~~Converter os sete `fixme` de Marketing/SDR em testes verdes.~~ O repositório
  inteiro está com zero `test.fixme`.

### Aceite

- Aporte gravado pela tela aparece no resumo após reload.
- CPL e quantidade de leads por campanha batem com a agregação do banco.
- Origem, agente e template permanecem vinculados após reload.
- Importação inválida não deixa lista órfã.
- Papel sem permissão recebe 403 antes de qualquer informação sobre secrets.

**Status local em 10/08/2026:** Sprint concluída pela migration `0031`. Os 25
cenários de Marketing/SDR passam pela interface e a suíte integral fecha em
134/134 E2E. A migration foi aplicada somente ao Supabase local; remoto aguarda
autorização e credenciais do cliente.

## Sprint 4 — integrações externas reais e automações

**Meta:** provar que cada integração sai do sistema, chega ao terceiro e retorna
quando aplicável.

### Pré-requisitos do cliente

- OpenAI: chave com limite de uso definido.
- Meta: acesso ao Business Manager, app, página, WABA, número, conta de anúncios
  de teste, App Secret e Verify Token.
- WhatsApp: template aprovado e destinatários de teste com consentimento.
- Brevo: chave, remetente verificado e DNS do domínio.
- IA de voz: contrato do payload, endpoint de retorno e segredo compartilhado.

### Entregas

- OpenAI: conversa real do agente SDR, timeout, limite e erro legível.
- Meta Lead Ads: registrar webhook, validar assinatura e fazer um lead real entrar
  na origem correta, no SDR ou na roleta.
- WhatsApp: registrar webhook de `messages`, testar resposta inbound, broadcast,
  aviso de timeout e idempotência.
- Brevo: enviar OTP e dossiê real com anexos; falha atualiza status e permite retry.
- IA de voz: receber evento assinado, rejeitar replay e fazer handoff de lead
  qualificado sem duplicação.
- Preencher o cofre pela tela, comprovar rotação sem redeploy e manter secrets
  fora do bundle e dos logs.
- Reativar `faceimob-notify-dispatch` somente após o teste real do WhatsApp.
- Inventariar N8N, migrar eventual fluxo ausente e desligá-lo quando a paridade
  estiver comprovada.

### Aceite

- Um cenário auditável e repetível passa para cada integração, com IDs externos
  registrados.
- `cron_jobs_health()` mostra jobs ativos, último sucesso e zero falhas não tratadas.
- Reexecutar o mesmo webhook/evento não duplica efeitos.

## Sprint 5 — gestão real de campanhas Meta Ads

**Meta:** entregar budget, pausar/ativar e copiar campanhas na conta real, não
apenas editar a tabela local `ad_campaigns`.

### Entregas

- Confirmar permissões, revisão do app e limitações impostas à empresa no Meta.
- Criar chamadas server-side para listar campanhas, conjuntos e anúncios.
- Sincronizar spend, budget e status com IDs externos e marca de última atualização.
- Implementar alteração de budget, pausa/ativação e cópia com confirmação.
- Registrar auditoria de quem executou cada mudança e a resposta da Meta.
- Tratar rate limit, token expirado, campanha arquivada e sucesso parcial.
- Testar primeiro em conta/campanha de homologação com orçamento controlado.

### Aceite

- Alteração feita no FACEIMOB aparece no painel da Meta e vice-versa após sync.
- Nenhuma chamada à Graph API ou token passa pelo navegador.
- Operação duplicada é idempotente ou explicitamente confirmada.
- Bloqueio externo da Meta fica visível como dependência, nunca como sucesso falso.

## Sprint 6 — todas as telas, papéis e qualidade

**Meta:** provar a superfície completa e remover dívida que esconde defeito.

### Entregas

- ~~Smoke positivo das rotas ainda sem cobertura suficiente:
  `/cca`, `/equipes`, `/links`, `/data`, `/settings`, `/admin/integrations`,
  `/admin/developers`, `/admin/daily-teams`, `/checkpoint`,
  `/admin/meta-ads` e `/admin/lead-automation`.~~ As 14 rotas novas passam; com
  os fluxos já existentes, todas as 21 rotas protegidas têm smoke positivo.
- Matriz de acesso por admin, diretor, gerente, corretor, CCA, SDR, marketing e
  usuário com dois papéis.
- CRUD essencial de cada tela, sempre comprovando banco e reload.
- Estados de carregamento, vazio, erro de rede, 401, 403, 409, 429 e 5xx.
- Varrer console, acessibilidade básica, teclado, títulos, labels, contraste e
  responsividade nas resoluções usadas na loja.
- ~~Zerar erros do ESLint no fonte; manter warnings apenas quando documentados.~~
  Em 10/08/2026: zero erros e sete warnings `react-refresh/only-export-components`
  em componentes que também exportam helpers/variantes. Eles afetam somente o
  hot reload de desenvolvimento; build e execução de produção não são afetados.
- ~~Eliminar todos os `fixme` de requisitos contratados e remover teste obsoleto.~~

### Aceite

- Pipeline completo de CI verde.
- E2E local e remoto verdes, sem erro inesperado no console.
- Toda rota prevista tem pelo menos um teste positivo e um teste de autorização.
- Nenhum botão crítico produz toast de sucesso sem comprovação da gravação.

## Sprint 7 — produção, observabilidade e piloto

**Meta:** colocar no ar com capacidade de detectar, explicar e recuperar falha.

### Entregas

- Backup e plano de rollback antes do deploy final.
- Aplicar migrations, Edge Functions, secrets, configuração Auth e frontend na
  ordem documentada.
- Configurar dados reais: usuários, papéis, equipes, turnos, IPs, grupos de
  distribuição, origens, metas, construtoras, etapas, templates e links públicos.
- Validar jobs de roleta, checkout, fila de leads, notificações e dossiês.
- Criar checklist diário simples: crons, fila presa, falhas de function, e-mails,
  WhatsApp, leads sem dono e envios em retry.
- Pilotar com um grupo pequeno durante três dias úteis cobrindo manhã, tarde e noite.
- Corrigir regressões do piloto e colher aceite formal do responsável do produto.

### Aceite

- Zero incidente crítico aberto e zero dado perdido no piloto.
- Métricas da tela batem com consultas de conferência do banco.
- Usuário responsável assina o checklist de aceite de cada módulo.
- Runbook de operação e suporte entregue.

## Caminho crítico e paralelização

Com uma pessoa, a ordem acima deve ser mantida. Com duas pessoas, depois da
Sprint 0 é possível trabalhar em dois trilhos:

- **Trilho A — backend/integrações:** RPCs públicas, check-in, RLS, SDR backend,
  webhooks, crons, Meta Graph API e deploy.
- **Trilho B — frontend/QA:** Diário/Checkpoint, CCA, Marketing/SDR UI, telas sem
  cobertura, acessibilidade e E2E.

Mesmo com duas pessoas, a Sprint 4 depende das credenciais e aprovações externas;
começar código sem esses acessos só cria uma falsa sensação de avanço.

## Responsabilidades que não podem ficar sem dono

| Responsável | Entrega |
|---|---|
| Produto/Douglas | Três decisões de produto, acessos externos e aceite do piloto |
| Engenharia | Código, migrations, testes, deploy, segurança e runbook |
| Admin Meta | App, webhooks, permissões, WABA, templates e conta de teste |
| Admin Brevo/DNS | Chave, domínio, remetente e SMTP |
| Fornecedor IA de voz | Payload, assinatura, eventos e ambiente de homologação |
| Operação FACEIMOB | Dados reais, usuários piloto e validação dos fluxos diários |

## Placar de encerramento

O acompanhamento semanal deve publicar apenas estes números:

- testes E2E: passados / pulados / falhos;
- rotas com smoke positivo / total;
- integrações homologadas com evento real / total;
- migrations locais não aplicadas no remoto;
- jobs com falha nas últimas 24 horas;
- incidentes críticos e altos abertos;
- decisões ou credenciais vencidas.

Se um item não pode ser demonstrado, ele não entra como concluído.
