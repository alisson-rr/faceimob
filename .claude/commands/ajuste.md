Pedido de ajuste: `$ARGUMENTS`

Siga este roteiro, nesta ordem. Não pule o passo 1.

1. **Entenda antes de mexer.** Em uma frase, diga qual tela, qual número ou texto e o que o usuário quer que mude. Se houver print, nomeie a tela que ele mostra. Se faltar uma decisão que muda a solução, pergunte; senão, siga com a suposição mais segura e diga qual foi.
2. **Veja se já existe, só quando fizer sentido.** Se o pedido parece algo que já foi feito, rode `git log origin/main --oneline -15` e procure o assunto. Se já existe, diga isso em vez de refazer. Para pedido novo e claro, pule este passo.
3. **Leia o código.** Procure direto com Grep e Glob (este projeto não tem grafo: não verifique `graphify`). Ache o ponto compartilhado mais estreito. Confira nomes de tabela e coluna nas migrations antes de escrever qualquer SQL.
4. **Mude o mínimo.** Sem refatorar fora do pedido e sem trocar regra de negócio sem avisar. Antes de editar um arquivo, **leia o trecho exato** e copie-o sem alterar: editar de memória dá "Error editing file" e gasta voltas. Faça todas as mudanças de um mesmo arquivo seguidas.
5. **Prove.** Rode o teste focado e `npm run typecheck`. Para bug, deixe um teste que falhava antes.
6. **Entregue curto.** Resultado primeiro, em linguagem simples. O que mudou, o que foi testado, o que NÃO foi verificado e o próximo passo do usuário. Para publicar, o usuário usa `/publicar`.

Não mexa em produção (banco, deploy, merge) neste comando.
