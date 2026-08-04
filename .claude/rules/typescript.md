---
paths:
  - "**/*.{ts,tsx,js,jsx}"
---

# TypeScript, JavaScript e React

- Preserve o modo estrito e prefira tipos inferidos localmente a anotações redundantes.
- Evite `any`, casts e `!`; use-os apenas com uma justificativa verificável na fronteira.
- Tipos não validam dados em runtime: valide API, formulário, webhook, storage e variável de ambiente.
- Trate promises e erros explicitamente; paralelize apenas operações independentes.
- Respeite os limites entre servidor e cliente e não envie segredos ou dependências server-only ao bundle.
- Em React, derive valores durante a renderização em vez de sincronizá-los com estado e efeito.
- Componentes interativos precisam de semântica nativa, teclado, foco e nome acessível.
- Reutilize componentes e utilitários existentes; não crie wrapper que apenas renomeia uma API nativa.
