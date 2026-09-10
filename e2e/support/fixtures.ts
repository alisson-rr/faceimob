/**
 * Ferramentas compartilhadas pelos specs.
 *
 * `db` fala com o Supabase por PostgREST com service_role — usado para MONTAR
 * cenário e para CONFERIR o que a tela gravou, nunca para simular o que a tela
 * deveria fazer. Asserção que passa sem a tela ter feito nada não testa nada.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { resolveTarget } from "./target";
import { mintSession } from "./session";
import { E2E_USERS, type RoleKey } from "./users";

const target = resolveTarget();

const headers = () => ({
  apikey: target.serviceRoleKey,
  Authorization: `Bearer ${target.serviceRoleKey}`,
  "Content-Type": "application/json",
});

export const db = {
  async select<T = Record<string, unknown>>(query: string): Promise<T[]> {
    const res = await fetch(`${target.supabaseUrl}/rest/v1/${query}`, { headers: headers() });
    if (!res.ok) throw new Error(`select ${query} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  },
  async insert<T = Record<string, unknown>>(table: string, rows: unknown): Promise<T[]> {
    const res = await fetch(`${target.supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`insert ${table} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  },
  async update(query: string, patch: unknown): Promise<void> {
    const res = await fetch(`${target.supabaseUrl}/rest/v1/${query}`, {
      method: "PATCH", headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`update ${query} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
  async remove(query: string): Promise<void> {
    const res = await fetch(`${target.supabaseUrl}/rest/v1/${query}`, { method: "DELETE", headers: headers() });
    if (!res.ok) throw new Error(`delete ${query} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${target.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: headers(), body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`rpc ${fn} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json().catch(() => null as T);
  },
  /** id do perfil de um papel da suíte. */
  async profileIdOf(key: RoleKey): Promise<string> {
    const email = E2E_USERS.find((u) => u.key === key)!.email;
    const rows = await this.select<{ id: string }>(`profiles?email=eq.${encodeURIComponent(email)}&select=id`);
    if (!rows.length) throw new Error(`perfil de ${key} (${email}) não encontrado`);
    return rows[0].id;
  },
};

/**
 * Escrita pela via do administrador de verdade.
 *
 * `service_role` ignora RLS, mas NÃO ignora trigger: `profiles_guard_admin_columns`
 * (migration 0012) exige `is_admin()`, e para service_role `auth.uid()` é nulo.
 * Afrouxar a trava para o teste passar seria trocar a proteção antifraude do
 * check-in por conveniência — então o cenário usa o JWT do admin E2E, que é o
 * caminho real de quem libera o bypass de IP.
 */
let tokenDoAdmin: Promise<string> | null = null;
const autorizacaoDoAdmin = () => {
  tokenDoAdmin ??= mintSession(E2E_USERS.find((u) => u.key === "admin")!.email)
    .then((s) => s.access_token);
  return tokenDoAdmin;
};

export const comoAdmin = {
  async update(query: string, patch: unknown): Promise<void> {
    const token = await autorizacaoDoAdmin();
    const res = await fetch(`${target.supabaseUrl}/rest/v1/${query}`, {
      method: "PATCH",
      headers: { apikey: target.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`update (admin) ${query} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};

/** Marca única por execução: separa o que o teste criou do que já existia. */
export const runTag = () => `e2e-${process.env.E2E_RUN_ID ?? "local"}-${Math.random().toString(36).slice(2, 8)}`;

/** Espera o app terminar de carregar dados (a maioria das telas mostra "Carregando"). */
export async function aguardarCarregamento(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.getByText(/carregando/i).first()).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
}

/**
 * Nenhum erro de runtime no console é aceitável numa tela que "funciona".
 *
 * Exceção declarada, não silenciosa: um teste que PROVOCA rejeição de propósito
 * (IP inválido, RLS negando, integração sem credencial) faz o navegador logar
 * "Failed to load resource" — isso é a prova de que a rejeição aconteceu, não um
 * defeito. Esses testes declaram o que esperam com
 * `test.use({ errosEsperados: [/status of 403/] })`; qualquer erro fora da lista
 * continua reprovando.
 *
 * ARMADILHA DO PLAYWRIGHT (1.62): em `test.use`, o valor de uma opção passa por
 * `isFixtureTuple = Array.isArray(v) && typeof v[1] === "object"` — sem olhar as
 * chaves de `v[1]`. Como RegExp é `object`, uma lista com DOIS OU MAIS padrões é
 * lida como a tupla `[valorPadrão, opções]`: só o elemento 0 sobrevive e o resto
 * é descartado ANTES de chegar aqui. Por isso a forma obrigatória é sempre uma
 * lista de UM item, com alternância quando há mais de um padrão (`[/a|b/i]`).
 *
 * Aceitar o RegExp solto que sobra da truncagem seria pior que reprovar: o teste
 * rodaria com um padrão declarado a menos e ninguém saberia. Daí o guard abaixo.
 */
export const test = base.extend<{ errosEsperados: RegExp[]; semErroDeConsole: void }>({
  errosEsperados: [[], { option: true }],
  semErroDeConsole: [
    async ({ page, errosEsperados }, use) => {
      // Chegar aqui como não-array só acontece pela truncagem descrita acima: o
      // que sobrou de `[/a/, /b/]`. Falhar alto é a única defesa possível — a
      // fixture não tem como recuperar o padrão que o Playwright já jogou fora.
      if (!Array.isArray(errosEsperados)) {
        throw new Error(
          "errosEsperados: declare UMA lista com um único RegExp de alternância " +
            "(`[/a|b/i]`) — o Playwright descarta o 2º elemento de `[/a/, /b/]`.",
        );
      }
      const erros: string[] = [];
      const ignorar = (texto: string) =>
        // Ruído conhecido de ambiente, não defeito da aplicação.
        /favicon|ERR_INTERNET_DISCONNECTED|Download the React DevTools/i.test(texto) ||
        errosEsperados.some((padrao) => padrao.test(texto));

      page.on("console", (m) => {
        if (m.type() !== "error") return;
        if (!ignorar(m.text())) erros.push(m.text());
      });
      page.on("pageerror", (e) => {
        if (!ignorar(e.message)) erros.push(`pageerror: ${e.message}`);
      });
      await use();
      expect(erros, `erros de console:\n${erros.join("\n")}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
