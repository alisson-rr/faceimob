/**
 * O que o papel `marketing` alcança.
 *
 * Vale como teste porque a divergência é real e cara: `lead_sources` e
 * `whatsapp_templates` só aceitam escrita de `admin` e `marketing` (migrations
 * 0003 e 0008), mas a configuração dessas duas coisas mora dentro de /sdr, e
 * `menu.sdr` não foi concedido a `marketing` (migration 0015). Quem pode
 * escrever não entra na tela; quem entra na tela (`sdr`) não pode escrever.
 */
import { test, expect, aguardarCarregamento } from "../support/fixtures";

test.describe("Marketing · alcance do papel", () => {
  test("abre a própria tela de marketing", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);
    await expect(page.getByRole("heading", { name: /marketing/i })).toBeVisible();
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
  });

  test("é barrado no módulo SDR com recusa honesta, não com tela vazia", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);

    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
    await expect(page.getByText(/não tem permissão para esta tela/i)).toBeVisible();
    // E não renderiza nada do módulo por baixo do aviso.
    await expect(page.getByRole("tab", { name: /agentes/i })).toHaveCount(0);
  });
});
