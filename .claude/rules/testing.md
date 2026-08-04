---
paths:
  - "**/*.{test,spec}.{ts,tsx,js,jsx,py}"
  - "**/tests/**/*"
  - "**/__tests__/**/*"
---

# Testes

- Teste comportamento e contrato público, não detalhes internos de implementação.
- Para bugs, prefira uma reprodução que falhe antes da correção quando isso for prático.
- Mantenha testes deterministas, independentes e sem rede ou relógio real por padrão.
- Não use mock para reimplementar a própria regra que deveria ser testada, amenos que seja solicitado pelo usuario.
- Reaproveite fixtures e helpers existentes antes de criar novos.
- Cubra o caminho feliz e as fronteiras de maior risco; não multiplique casos equivalentes.
- Uma falha precisa dizer qual comportamento quebrou, sem depender da ordem de execução.
- Rode primeiro o teste focado e amplie a suíte somente quando o risco justificar.
