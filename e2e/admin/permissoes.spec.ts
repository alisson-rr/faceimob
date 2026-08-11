import { test, expect, db, aguardarCarregamento } from "../support/fixtures";

/**
 * AdminPermissions: alterar uma permissão tem de SOBREVIVER ao recarregamento.
 *
 * A tela grava otimista — o switch vira antes da resposta. Uma auditoria já
 * encontrou telas que mostravam "salvo" sem gravar nada, então aqui a asserção
 * é dupla: a linha aparece em `role_permissions` E a tela continua marcada
 * depois de um F5 (que é quando a leitura vem do banco de novo).
 *
 * O papel escolhido é "Sócio" (`partner`) de propósito: nenhum usuário da suíte
 * tem esse papel, então mexer nele não muda o que outro agente está testando no
 * mesmo banco. E `menu.admin_developers` começa sem linha — ou seja, negado.
 */
const PAPEL = "partner";
const CODIGO = "menu.admin_developers";
const ROTULO = /Construtoras para Sócio/;

const linhaNoBanco = () =>
  db.select<{ allowed: boolean }>(
    `role_permissions?role=eq.${PAPEL}&permission=eq.${CODIGO}&select=allowed`,
  );

const apagarLinha = () =>
  db.remove(`role_permissions?role=eq.${PAPEL}&permission=eq.${CODIGO}`);

/** Estado inicial explícito: cada caso decide o seu, sem herdar do anterior. */
async function prepararLinha(allowed: boolean | null) {
  await apagarLinha();
  if (allowed !== null) {
    await db.insert("role_permissions", { role: PAPEL, permission: CODIGO, allowed });
  }
}

test.afterAll(apagarLinha);

test("conceder uma permissão grava no banco e sobrevive ao recarregar", async ({ page }) => {
  await prepararLinha(null); // sem linha = negado

  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);

  const chave = page.getByRole("switch", { name: ROTULO });
  await expect(chave).toBeVisible();
  await expect(chave).not.toBeChecked();

  await chave.click();
  await expect(chave).toBeChecked();

  await expect(async () => {
    expect(await linhaNoBanco()).toEqual([{ allowed: true }]);
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await aguardarCarregamento(page);
  await expect(page.getByRole("switch", { name: ROTULO })).toBeChecked();
});

test("revogar a mesma permissão também persiste", async ({ page }) => {
  await prepararLinha(true);

  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);

  const chave = page.getByRole("switch", { name: ROTULO });
  await expect(chave).toBeChecked();

  await chave.click();
  await expect(chave).not.toBeChecked();

  await expect(async () => {
    expect(await linhaNoBanco()).toEqual([{ allowed: false }]);
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await aguardarCarregamento(page);
  await expect(page.getByRole("switch", { name: ROTULO })).not.toBeChecked();
});
