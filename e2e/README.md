# Testes de ponta a ponta

Suíte Playwright que exercita as telas com **sessão real**, uma por papel.

## Como rodar

```bash
npm run db:start          # sobe o Supabase local (uma vez)
npm run db:reset          # aplica as 31 migrations + seeds
npm run e2e               # roda tudo
```

Último placar local (10/08/2026): **134/134 testes passaram**, sem `fixme`.

Recortes úteis:

```bash
npm run e2e -- --project=broker        # só a visão do corretor
npm run e2e -- --project=anonimo       # só o que roda sem sessão
npm run e2e:ui                         # modo interativo
npm run e2e:report                     # abre o último relatório HTML
```

Contra o projeto de homologação, em vez do local:

```bash
npm run e2e:remote
```

Isso exige `SUPABASE_SERVICE_ROLE_KEY` no ambiente (Supabase → Project Settings →
API → service_role). Ela **nunca** entra no repositório. No alvo local não é
preciso segredo nenhum: a chave do CLI é de demonstração e sai de
`supabase status`.

## Vídeo de demonstração

```bash
npm run demo     # gera demo/fila-de-leads.webm
```

Roteiro da fila de leads — check-in, posição na fila, lead novo caindo pela
roleta, trava de 5 minutos, "Atender" — com o passo desacelerado e vídeo ligado.
É o mesmo app, banco e sessão dos testes: cada etapa confere no banco antes de
seguir, então uma demonstração que "funciona só na tela" falha em vez de virar
vídeo. Fora de janela de turno o roteiro abre uma janela temporária e a remove
no final.

Para gravar **ao vivo contra a homologação** (usuário real, app do `npm run
dev`), os três comandos do kit aceitam `--remote` (exige
`SUPABASE_SERVICE_ROLE_KEY` no ambiente, como o `e2e:remote`) e `--email=` para
apontar outro corretor:

```bash
npm run demo:preparar -- --remote
npm run demo:lead -- --remote
npm run demo:limpar -- --remote
```

## Por que não existe login falso aqui

A tela de login não tem senha — a ata de 23/07 pediu acesso por código no e-mail
justamente para tirar senha do banco. Havia três saídas ruins e uma boa:

| Caminho | Consequência |
|---|---|
| Desligar a autenticação nos testes | Sem JWT não há `auth.uid()`, e o RLS — que é o porteiro de tudo neste projeto — deixa de ser exercitado. A suíte passaria com um corretor enxergando a empresa inteira. |
| Usuário "fake" | Mesmo problema: ou o RLS bloqueia tudo, ou seria preciso afrouxar o RLS para o teste, e aí o teste não vale nada. |
| Voltar o login por senha | Contraria a ata de 23/07 e a decisão de 02/08 registrada em `docs/sprints/decisoes.md`. Uma senha a mais no sistema é uma senha a mais para vazar. |
| **Pedir o código à Admin API** | É o caminho usado aqui. |

`generate_link` devolve o `email_otp` de seis dígitos **sem enviar e-mail**, e
`/auth/v1/verify` troca esse código por sessão — exatamente a chamada que
`Login.tsx` faz. O login testado é o de produção; só a entrega do e-mail é
pulada. O JWT é real, o RLS vale, e não existe porta dos fundos no código da
aplicação.

## Usuários

Os dez usuários `e2e.*@faceimob.test` são criados pelo próprio preparo
(`e2e/support/users.ts`) e cobrem a hierarquia inteira:

| Project | Papel | Serve para |
|---|---|---|
| `admin` | admin | visão total, telas de administração |
| `director` | director | diretor da Equipe E2E Alfa |
| `manager` | manager | gerente da Alfa |
| `broker` | broker | corretor da Alfa |
| `brokerRival` | broker | corretor da Beta — prova o isolamento |
| `brokerThird` | broker | terceiro corretor usado no rodízio da demonstração |
| `cca` | cca | esteira de crédito |
| `sdr` | sdr | módulo de SDR |
| `marketing` | marketing | campanhas e aportes |
| `dual` | director + broker | papel N:N da ata de 23/07 |
| `anonimo` | — | login, diário público, checkpoint |

As contas `seed.*@example.invalid` **não servem** para isto: elas são banidas de
propósito no `seeds/010` ("não servem para login").

## Como um spec escolhe a visão

Pelo diretório: `e2e/broker/algo.spec.ts` roda autenticado como corretor.
`e2e/anonimo/` roda sem sessão.

## O que a suíte cobra de si mesma

- Uma fixture automática **falha o teste se a tela logar erro no console**. Um
  teste que provoca rejeição de propósito (IP inválido, RLS negando, integração
  sem credencial) declara o que espera — e só isso passa:

  ```ts
  test.describe(() => {
    test.use({ errosEsperados: [/status of 403/i] });
    test("cadastro negado pela RLS avisa na tela", async ({ page }) => { /* ... */ });
  });
  ```

- `comoAdmin.update()` escreve com o JWT do admin, não com `service_role`.
  Serve para o que passa por trigger de autorização (liberar bypass de IP, por
  exemplo): `service_role` ignora RLS mas **não** ignora trigger, e afrouxar a
  trava para o teste passar seria trocar a proteção antifraude por conveniência.
- O preparo valida cada sessão abrindo uma rota protegida: se o formato de
  armazenamento do supabase-js mudar, a falha aparece no setup com a causa
  escrita, não como 200 testes vermelhos sem explicação.
- `npm run typecheck` inclui `tsconfig.e2e.json` — Playwright transpila TS sem
  checar tipo, então sem isso um erro de tipo só apareceria em execução.
