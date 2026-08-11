import { test, expect, aguardarCarregamento } from "../support/fixtures";

const rotas = [
  ["/pipeline", /^Pipeline$/i],
  ["/leads", /^Leads$/i],
  ["/checkin", /Check-in de Corretor/i],
  ["/cca", /Pipeline CCA/i],
  ["/equipes", /^Equipes$/i],
  ["/admin/developers", /Construtoras & CCA/i],
  ["/links", /^Links$/i],
  ["/data", /Gestão de dados/i],
  ["/settings", /^Configurações$/i],
  ["/admin/integrations", /^Integrações$/i],
  ["/admin/daily-teams", /Diário.*Links, PINs & IPs/i],
  ["/checkpoint", /Checkpoint Semanal/i],
  ["/admin/meta-ads", /Configuração do Meta Ads/i],
  ["/admin/lead-automation", /Automação de Leads/i],
] as const;

test.describe("Admin · rotas positivas", () => {
  for (const [path, heading] of rotas) {
    test(`abre ${path}`, async ({ page }) => {
      await page.goto(path);
      await aguardarCarregamento(page);

      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}/?$`));
      await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    });
  }
});
