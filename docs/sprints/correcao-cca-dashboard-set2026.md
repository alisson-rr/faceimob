# CCA e relatório de lideranças — 24/09/2026

Implementação local autorizada após o cliente esclarecer a mensagem de erro do CCA e o significado de “Neg”. Paleta atual preservada. Não publicado no ambiente remoto.

## CCA

A consulta somente de leitura ao banco configurado (`limit=0`) confirmou `42703: column cca_cases.stage_entered_at does not exist`. O frontend da rodada anterior passou a selecionar a coluna da migration 0156 antes de ela existir no banco.

`loadCcaBoard` agora repete a consulta sem essa coluna somente para esse erro específico. Mantém período, paginação e ordem de chegada. Outros erros continuam sendo apresentados. Sem o relógio por status, o cartão identifica o tempo como “na esteira”, usando a entrada original; não inventa uma data de mudança de status. A 0156 continua necessária para registrar o tempo de cada status.

## Dashboard

- **Faturamento por mês e por ano:** abre com quantidade de vendas em destaque; cada mês e total anual mostram vendas e VGV juntos. O seletor só troca o destaque e a escala das barras. Rótulos das barras e tooltip incluem os números; meses futuros continuam vazios.
- **Relatório de diretores e gerentes:** duas tabelas na Visão geral, nessa ordem, seguindo o mês selecionado. Colunas da referência: Meta Remuneração, Meta, % batido, responsável, Leads, Ágil, Negócio, Vendas, VGV e Off. Usa tabelas acessíveis com rolagem interna no celular e cores do design system.
- Negócios atribuídos aos diretores/gerentes registrados no próprio negócio, contados uma vez por pessoa, pelo mês-base. Vendas usam o mesmo desfecho do Dashboard; VGV é integral por gestor, como no ranking existente. Ágil conta Esteira Ágil. Negócio reconhece o status já cadastrado `08. VIROU NEGÓCIO`, além de Negócio/Negócio fechado; não inclui Análise p/ virar negócio. Off reconhece status OFF.
- Leads: contagem exata no banco pela data de criação em São Paulo e responsáveis da equipe atual, incluindo o próprio gestor. Não usa a amostra dos últimos 1.000 leads do Dashboard. Mantém as políticas de acesso existentes.
- Meta própria tem prioridade; sem ela, soma metas de todas as equipes lideradas somente quando todas estiverem cadastradas. Ausência não equivale a zero. Percentual = vendas / meta operacional.
- Meta Remuneração não foi importada do Bubble, conforme `docs/importacao/perfil/metas.md`. A migration **0158** permite `goals.metric = 'sales_comp'`, separado de `sales`, sem alterar valores existentes ou permissões. Sem cadastro, mostra “—”. Não foi criado editor nem feita importação de metas nesta entrega.

## Validação e publicação

- Typecheck, lint (sem erros; 16 avisos preexistentes) e build aprovados.
- Suíte completa: 1.544 testes aprovados. Regressões específicas cobrem CCA sem a coluna, preservação de erros, contagem de vendas/VGV, múltiplas equipes, metas independentes, período e contagem de leads acima de 1.000.
- Migration 0158 e `supabase/tests/99_meta_remuneracao.sql` aprovados em PostgreSQL 18 isolado; teste usa rollback. Nenhuma escrita remota.
- Navegador com componentes reais, sessão/dados fictícios: Dashboard integrado, relatório e gráfico nos dois temas, troca de mês e destaque; 390 px sem overflow da página. CCA carregou após reproduzir o erro da coluna ausente; requisições confirmaram a segunda consulta sem ela. Sem erro JavaScript.
- Evidências locais, ignoradas pelo Git: `test-results/dashboard-fix-preview/`, `test-results/cca-dashboard-vitest.json` e `test-results/cca-dashboard-build.log`.

O frontend pode ser publicado sem a 0158: metas de remuneração ausentes aparecem como “—”. Para cadastrar essa meta, aplicar a 0158. Para ativar o relógio por status e os demais recursos da rodada anterior, seguir a ordem de publicação de `ajustes-pipeline-set2026.md` (0156/0157); esta correção elimina a dependência da 0156 para abrir a esteira.
