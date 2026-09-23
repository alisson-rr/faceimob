# Ajustes de Pipeline, CCA e equipes — 22/09/2026

Implementados localmente a partir dos 16 itens do cliente e do print do Bubble. A referência orienta a disposição e os destaques; os tokens de cor atuais do FACEIMOB foram preservados. Nenhuma publicação, mudança no banco remoto ou mensagem real foi realizada.

## Comportamento entregue

- **Pipeline (1, 2, 5, 6, 15):** linhas alternadas, cabeçalho destacado, células inteiras na cor da construtora e pódio com gradientes ouro/prata/bronze. O primeiro colocado permanece maior e ao centro no desktop; no celular a leitura segue primeiro, segundo e terceiro. Os KPIs compartilhados ganharam faixas e fundos suaves com a paleta existente, nos dois temas.
- **Painel do ranking (3):** resultados e propostas do próprio corretor, da equipe do gerente ou da diretoria. O diretor pode selecionar cada gerência e sua equipe própria. A proposta abre o editor existente. Corretor vê seu VGV rateado; gestores, o VGV do recorte. O período é o de criação dos negócios, indicado no painel. A RLS continua limitando os dados entregues pelo banco.
- **Sócios (4):** cartões dos diretores ativos com a quantidade de propostas abertas no período substituem o pódio. Clicar recorta o Pipeline da diretoria; “Todos os diretores” limpa esse recorte.
- **Rolagem (7):** comportamento suave nos contêineres roláveis, respeitando a preferência por movimento reduzido e mantendo a rolagem nativa.
- **Dashboard (8):** rankings de diretores, gerentes e geral nessa ordem. O geral reúne os participantes com vendas dos três papéis, sem contar a mesma pessoa duas vezes no mesmo negócio. Quem acumula papel de gestor recebe o VGV da equipe, conforme os rankings específicos.
- **E-mails (9):** mudanças efetivas de Status 1 ou Status 2 do Pipeline enfileiram mensagens ao corretor, gerente e diretor responsáveis ativos, incluindo o autor se for responsável. Endereços iguais são deduplicados. O e-mail informa antes/depois. Reutiliza a fila e o worker Brevo, com controle independente em Administração → Integrações. Movimentos originados na CCA conservam seu aviso próprio e não duplicam o e-mail do Pipeline.
- **CCA (10, 11, 16):** fila por chegada à esteira, mais antigos primeiro, com desempate estável; CPF junto ao nome; contador de dias completos no status; síntese Esteira Ágil com quantidade e maior espera; setas para reorganizar colunas com gravação atômica e validação da lista no banco.
- **Equipes (12):** ativos primeiro, suspensos/desligados no grupo nativo recolhido ao final; cabeçalhos mostram ativos e inativos, inclusive na performance por equipe.
- **Switches (13):** ligado verde e desligado vermelho, preservando rótulo e estado acessível.
- **Permissão (14):** “Alterar Status 2” na matriz de funcionalidades, aplicada na tabela, formulário, confirmação de perda e banco. A leitura permanece disponível; OFF/DISTRATO continuam exigindo a permissão adicional. Ações da CCA mantêm sua autorização específica. Os papéis que já editavam recebem a permissão inicialmente, para permitir revogação sem interromper a operação existente.

## Tempo de casos antigos

Sem histórico confiável de entrada em cada status, não foi inventada uma data retroativa. Casos anteriores à migration mostram dias **na esteira** a partir de `submitted_at`. Depois do próximo movimento passam a registrar dias **no status**. Editar notas não reinicia o contador; trocar de coluna ou reenviar reinicia.

## Validação

- 1.533 testes Vitest passaram; os testes afetados pelos últimos ajustes de texto/dados foram executados novamente.
- Typecheck completo e build de produção passaram. Lint sem erros; permanecem os 16 avisos de Fast Refresh já existentes.
- `deno check --no-lock` passou para `cca-email-dispatch`.
- 136 migrations e o seed foram aplicados em PostgreSQL 18 temporário separado. Os 77 arquivos de asserts SQL passaram, incluindo permissão revogada, três destinatários, mudanças reais/sem mudanças, separação da fila CCA, expiração, relógio e reordenação atômica. Foram usados os stubs Supabase do harness do repositório; não é validação dos serviços remotos.
- Navegador com os componentes reais e dados fictícios: temas claro/escuro, larguras 1440 e 390, clique no diretor, seleção de equipe própria, abertura de propostas, inativos recolhidos/expandidos, switches e contador/CPF no CCA. Nenhum erro de página registrado. Evidências locais em `test-results/pipeline-preview/`.
- Grafo de código atualizado.

## Publicação pendente

1. Aplicar as migrations `0156_cca_tempo_e_ordem` e `0157_pipeline_status2_email` antes do frontend novo. Regenerar `src/integrations/supabase/types.ts` pelo Supabase; as pontes tipadas atuais permitem compilar sem editar o arquivo gerado manualmente.
2. Publicar a função `cca-email-dispatch` atualizada e o app. O cron de envio existente é reutilizado.
3. Conferir a conexão/remetente Brevo e ativar **Enviar e-mail nas movimentações do Pipeline** em Administração → Integrações. A opção nasce desligada e não envia movimentos antigos. A configuração de e-mails da CCA é independente.
4. Conferir os recortes com contas reais de corretor, gerente, diretor e sócio após a publicação. Nenhum envio real foi usado na validação local.
