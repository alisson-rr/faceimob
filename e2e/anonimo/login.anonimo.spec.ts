import { test, expect, aguardarCarregamento } from "../support/fixtures";

/**
 * A porta de entrada, sem sessão.
 *
 * A ata de 23/07 pediu login por código no e-mail justamente para tirar senha
 * do banco — então "não existe campo de senha" é requisito, não detalhe visual.
 */
test.describe("login", () => {
  test("pede e-mail e avisa que não há senha", async ({ page }) => {
    await page.goto("/login");
    await aguardarCarregamento(page);

    await expect(page.getByPlaceholder("seu@email.com")).toBeVisible();
    await expect(page.getByRole("button", { name: /enviar código/i })).toBeVisible();
    await expect(page.getByText(/não usamos senha/i)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("rota protegida sem sessão manda para o login", async ({ page }) => {
    await page.goto("/pipeline");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByPlaceholder("seu@email.com")).toBeVisible();
  });

  test("guarda de rota não cai com variação de caixa nem barra final", async ({ page }) => {
    for (const rota of ["/Pipeline", "/pipeline/", "/ADMIN/permissions"]) {
      await page.goto(rota);
      await page.waitForURL(/\/login/, { timeout: 15_000 });
    }
  });

  // O GoTrue recusa o envio com 422 ("signups not allowed for otp"). O erro no
  // console é do protocolo; o que se cobra é a tela NÃO deixar isso escapar.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 422/i] });

  test("e-mail desconhecido não revela se a conta existe", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("seu@email.com").fill("nao.existe@faceimob.test");
    await page.getByRole("button", { name: /enviar código/i }).click();

    // Mensagem propositalmente genérica: confirmar a existência do e-mail seria
    // entregar a lista de usuários para quem tentar adivinhar.
    await expect(page.getByText(/se este e-mail estiver cadastrado|código/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // E o motivo real não pode vazar em lugar nenhum da tela.
    await expect(page.getByText(/signup|not allowed|não cadastrad|inexistente/i)).toHaveCount(0);
  });

  });
});
