import { test, expect, aguardarCarregamento } from "../support/fixtures";

/**
 * `/admin/daily-teams` pela sessão de um CORRETOR.
 *
 * A tela emite PIN e desativa link público de qualquer equipe sob o dono: é a
 * chave da porta da frente do Diário. `role_permissions` só libera
 * `menu.admin_daily_teams` para admin e diretor (0062), e nada provava que a
 * ROTA respeita isso — `broker/visibilidade.spec.ts` cobre `/admin/permissions`
 * e `/admin/integrations`, não esta.
 *
 * Esconder o item do menu não protege nada: o cenário digita a URL, que é o
 * caminho de quem tem o link.
 */
test.describe("corretor · Diário — links e PINs", () => {
  test("URL direta de /admin/daily-teams é negada", async ({ page }) => {
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();

    // A tela não pode renderizar por baixo do aviso: o que ela mostra (slug e
    // saúde do link) já é metade do segredo, e os botões gravam.
    await expect(page.getByRole("heading", { name: /diário — links, pins & ips/i })).toHaveCount(0);
    for (const proibido of [/criar link/i, /gerar pin/i, /renovar pin/i, /desativar/i, /nova equipe/i]) {
      await expect(page.getByRole("button", { name: proibido })).toHaveCount(0);
    }
  });

  test("o menu não oferece o caminho — e a tela de IPs também é negada", async ({ page }) => {
    await page.goto("/dashboard");
    await aguardarCarregamento(page);
    await expect(page.getByRole("link", { name: /diário — links/i })).toHaveCount(0);

    // `allowed_ips` é a outra metade da regra de check-in e sai da mesma tela.
    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
  });
});
