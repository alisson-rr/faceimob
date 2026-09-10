/**
 * Faxina do fim da suíte: devolve o banco alvo ao estado anterior.
 *
 * Existe por causa do `e2e:remote`. `provisionE2EUsers()` cria dez contas e duas
 * equipes no banco APONTADO — que no remoto é a homologação, com os dados da
 * demonstração. Sem o inverso, "E2E Corretor" ficava nas listas de equipe e
 * cinco corretores de teste entravam na contagem de staff que o cliente vê.
 *
 * **O que ele cobre e o que NÃO cobre — medido, não deduzido** (Playwright
 * 1.62.1, ver handoff-P):
 *
 *   · suíte verde, suíte vermelha e `Error: No tests found` → roda. ✅
 *   · **Ctrl+C no meio da execução → NÃO roda.** ❌ Com um `CTRL_C_EVENT` de
 *     verdade entregue ao processo, o Playwright morreu sem imprimir resumo e
 *     sem chamar a faxina: o banco ficou com as 10 contas e as 2 equipes.
 *   · **`--global-timeout` estourando → NÃO roda.** ❌ A limpeza herda o MESMO
 *     `deadline` da execução (`taskRunner.ts`), que já venceu.
 *   · morte súbita (`taskkill /F`, SIGKILL, terminal fechado no X) → não roda.
 *
 * Como o buraco não fecha aqui, ele é fechado onde dói: o único spec que mexe
 * na temporada aberta do game não roda no alvo remoto (`admin/fechamento-mes`).
 * Depois de uma interrupção, o remédio é uma linha — está no `e2e/README.md`.
 */
import { deprovisionE2EUsers } from "./support/users";

export default async function globalTeardown() {
  const { usuarios, equipes } = await deprovisionE2EUsers();
  console.log(`\n[e2e] faxina: ${usuarios} usuário(s) e ${equipes} equipe(s) removidos`);
}
