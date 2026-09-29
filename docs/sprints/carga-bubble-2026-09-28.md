# Atualização do Bubble em produção — 28/09/2026

Aplicada em `app.faceimob.com.br` e verificada às 17:15 BRT. O usuário autorizou a aplicação em produção e o uso dos pontos de setembro como saldo inicial do ranking aberto.

## Resultado

| Item | Resultado |
|---|---:|
| Negócios novos | 111 |
| Negócios atualizados | 590 |
| Total de negócios após a carga | 7.691 |
| Novos perfis necessários aos vínculos | 4 |
| Anexos novos com binário | 1.041 |
| Comentários novos / atualizados | 548 / 283 |
| Históricos de anexos novos / atualizados | 300 / 136 |
| Saldo inicial no ranking aberto | 10.520 pontos para 74 pessoas |

Dos 112 IDs de negócios novos no Bubble, um corresponde ao `NEG-001224`, já lançado manualmente. CPF, nome, empreendimento, unidade e valor coincidiram. O ID e o código do FACEIMOB foram preservados e receberam o vínculo do Bubble.

O recorte contém registros modificados desde 01/09, inclusive negócios de competências anteriores. Registros ausentes foram preservados. Os vínculos foram recuperados das exportações anteriores e do mapa de importação existente. Os quatro perfis receberam suas equipes e papel de corretor; contas criadas pela API administrativa, sem envio de convite.

O saldo do ranking usa IDs estáveis e um evento de ajuste por pessoa. Uma futura atualização deve substituir esses saldos, preservando os eventos locais. O detalhamento por categoria continua no resultado da temporada importada; o saldo inicial não inventa datas individuais das atividades nem eventos de venda.

## Verificação

- Backup PostgreSQL completo, com catálogo validado: `/opt/faceimob/backups/pre-bubble-refresh-20260928.dump` (39.716.195 bytes).
- SHA-256 do backup: `88f6d34028a0cf6477b100e322c253be58855b680b801cf4543825b6e58aa589`.
- Ensaio integral com rollback seguido do commit do mesmo SQL. Chaves estrangeiras permaneceram ativas; gatilhos de efeitos colaterais foram suspensos e restaurados dentro da transação.
- Conferidos: 701 negócios do recorte, preservação dos demais, valores monetários, rateios de 100%, ausência de notificações da carga e estados dos gatilhos.
- A função `visible_game_ranking` retornou 10.520 pontos, sem divergência para nenhuma das 74 pessoas importadas.
- API de produção confirmou o negócio manual preservado e tamanho dos dois anexos amostrados.

## Exceções preservadas

- 12 comentários novos de dois clientes com mais de um negócio. A origem traz apenas o nome, sem vínculo suficiente para decidir com segurança. Permanecem no arquivo privado `preparados/comentarios-pendentes.json`.
- Um PDF retorna HTTP 200 com zero bytes tanto no CDN quanto na origem S3 do Bubble. Permanece em `failed-documents.json`; não foi marcado como documento transferido.
- Oito históricos sem arquivos foram ignorados conforme a regra do importador anterior.

## Arquivos da execução

Os exports e artefatos com dados pessoais ficam na pasta ignorada `DOCUMENTO/DADOS_BUBBLE/2026-09-28/`: `before.json`, `vinculos-recuperados.json`, `payload.json`, `applied-payload.json`, `RESULTADO.json`, os scripts de preparação e `apply.sql`. Não adicionar essa pasta ao Git.

`conferir-preparacao.mjs` valida os vínculos sem acessar o banco. `planejar.mjs` confere o conjunto recebido e reutiliza os conversores originais; `gerar-sql.mjs` inclui as verificações da transação. O SQL é específico desta execução e exige o estado anterior de 7.580 negócios, impedindo reaplicação acidental. Para a carga de 01/10, obter novo estado do banco e preparar um novo lote com a mesma estratégia incremental.
