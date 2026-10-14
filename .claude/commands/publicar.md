Publique a mudança atual: commit, PR, merge e acompanhamento do deploy. Observação do usuário: `$ARGUMENTS`

Digitar este comando é a autorização para commit, push, PR e merge desta mudança. Nada além dela.

1. Confira `git status` e `git diff`. Se houver arquivo fora do escopo do pedido, pare e pergunte.
2. Rode a validação mínima (`/check`). Se algo falhar por causa da mudança, corrija antes; se for falha antiga, diga qual e siga só com a autorização do usuário.
3. Nunca trabalhe na `main`. Se estiver nela, crie uma branch com nome descritivo. Atualize a branch com `git fetch origin main` e `git rebase origin/main` (ou merge, se já houver commits publicados nela).
4. Faça o commit com mensagem em português, curta, dizendo o efeito para o usuário. Envie com `git push -u origin <branch>`. Nunca use `--force` na `main`.
5. Abra o PR com `gh pr create`: título curto, corpo com "O que muda" e "Validação" (o que rodou e o que NÃO foi verificado).
6. Faça o merge com `gh pr merge --squash`. Se houver revisão obrigatória pendente, pare e avise.
7. Acompanhe o deploy do merge (`gh run list` / `gh run watch`) até concluir. Não avise "publicado" antes de o deploy terminar com sucesso.
8. Resuma em 3 linhas: o que mudou, se o deploy passou e o que o usuário precisa conferir na tela.

Se a mudança traz migration (`supabase/migrations`), diga que ela roda no deploy e o que conferir depois.
