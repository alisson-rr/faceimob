import { test, expect, aguardarCarregamento } from "../support/fixtures";

/**
 * A porta de entrada, sem sessão.
 *
 * A ata de 23/07 pediu login por código no e-mail para tirar senha do banco.
 * A decisão de 25/08 (`docs/sprints/decisoes.md`, Tarefa A) somou o login por
 * **senha** de volta: o código depende de SMTP configurado, e a demonstração ao
 * cliente não podia depender de caixa postal. Os dois caminhos convivem — a
 * senha mora no GoTrue (hash bcrypt), nunca em `public.profiles`, que é o que a
 * ata de fato proibia.
 *
 * O que este arquivo cobra: os dois caminhos existem na tela, a troca entre
 * eles funciona, e nenhuma das duas recusas conta ao visitante se o e-mail
 * está cadastrado.
 */
test.describe("login", () => {
  test("oferece senha por padrão e código como alternativa", async ({ page }) => {
    await page.goto("/login");
    await aguardarCarregamento(page);

    // Caminho padrão: e-mail + senha.
    await expect(page.getByPlaceholder("seu@email.com")).toBeVisible();
    await expect(page.getByPlaceholder("Sua senha")).toBeVisible();
    await expect(page.getByRole("button", { name: /^entrar$/i })).toBeVisible();

    // Alternativa: código de seis dígitos por e-mail.
    await page.getByRole("button", { name: /receber código por e-mail/i }).click();
    await expect(page.getByRole("button", { name: /enviar código/i })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // E dá para voltar — quem não tem SMTP não fica preso no caminho do código.
    await page.getByRole("button", { name: /entrar com senha/i }).click();
    await expect(page.getByPlaceholder("Sua senha")).toBeVisible();
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

  // O GoTrue responde 400 para credencial inválida. O erro no console é do
  // protocolo; o que se cobra é a tela não deixar o motivo real escapar.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 4\d\d/i] });

    test("senha errada não distingue e-mail inexistente de senha inválida", async ({ page }) => {
      await page.goto("/login");
      await aguardarCarregamento(page);

      await page.getByPlaceholder("seu@email.com").fill("nao.existe@faceimob.test");
      await page.getByPlaceholder("Sua senha").fill("valor-invalido-de-teste");
      await page.getByRole("button", { name: /^entrar$/i }).click();

      // Mensagem única de propósito: a tela não pode virar um verificador de
      // quem trabalha na empresa.
      await expect(page.getByText(/e-mail ou senha inválidos/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/não cadastrad|inexistente|invalid login credentials/i)).toHaveCount(0);
      await expect(page).toHaveURL(/\/login/);
    });

    test("código para e-mail desconhecido não revela se a conta existe", async ({ page }) => {
      await page.goto("/login");
      await aguardarCarregamento(page);
      await page.getByRole("button", { name: /receber código por e-mail/i }).click();

      await page.getByPlaceholder("seu@email.com").fill("nao.existe@faceimob.test");
      await page.getByRole("button", { name: /enviar código/i }).click();

      await expect(page.getByText(/se este e-mail estiver cadastrado|código/i).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/signup|not allowed|não cadastrad|inexistente/i)).toHaveCount(0);
    });
  });
});
