---
paths:
  - "**/api/**/*"
  - "**/routes/**/*"
  - "**/controllers/**/*"
  - "**/*route*.{ts,tsx,js,jsx,py,go,java,cs}"
---

# Convenções de API

- Valide entrada na fronteira e devolva erros estruturados sem detalhes internos.
- Aplique autenticação e autorização no recurso; estar autenticado não implica ter acesso.
- Use o método e o status HTTP corretos e preserve contratos existentes por padrão.
- Operações sujeitas a repetição devem ser idempotentes quando o domínio exigir.
- Listagens potencialmente grandes precisam de paginação e limites.
- Não misture transporte, regra de negócio e persistência no mesmo bloco quando já houver limites estabelecidos no projeto.
- Documente somente contratos públicos e decisões não óbvias.
- Cubra pelo menos sucesso, entrada inválida, falta de autorização e falha esperada da dependência.
