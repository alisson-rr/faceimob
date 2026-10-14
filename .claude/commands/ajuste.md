Pedido de ajuste: `$ARGUMENTS`

Siga este roteiro, nesta ordem. Não pule o passo 1.

1. **Entenda antes de mexer.** Em uma frase, diga qual tela, qual número ou texto e o que o usuário quer que mude. Se houver print, nomeie a tela que ele mostra. Se faltar uma decisão que muda a solução, pergunte; senão, siga com a suposição mais segura e diga qual foi.
2. **Veja se já existe.** Rode `git fetch` e `git log origin/main --oneline -15` e procure o assunto no histórico. Se alguém (ou outra sessão) já fez, diga isso em vez de refazer.
3. **Leia o código.** Ache o ponto compartilhado mais estreito (use `graphify query` quando houver grafo). Confira nomes de tabela e coluna nas migrations antes de escrever qualquer SQL.
4. **Mude o mínimo.** Sem refatorar fora do pedido e sem trocar regra de negócio sem avisar.
5. **Prove.** Rode o teste focado e `npm run typecheck`. Para bug, deixe um teste que falhava antes.
6. **Entregue curto.** Resultado primeiro, em linguagem simples. O que mudou, o que foi testado, o que NÃO foi verificado e o próximo passo do usuário. Para publicar, o usuário usa `/publicar`.

Não mexa em produção (banco, deploy, merge) neste comando.
