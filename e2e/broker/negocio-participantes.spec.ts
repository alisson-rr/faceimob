/** Corretor enxerga os gerentes vinculados ao próprio negócio, inclusive vários. */
import { test, expect, db, runTag } from "../support/fixtures";
import {
  abrirDetalhe,
  abrirPipeline,
  buscar,
  limparNegocios,
  seletor,
  semearNegocio,
} from "../helpers/negocio";

const marca = runTag();
const cliente = `Gerentes Visíveis ${marca}`;

test.afterAll(async () => limparNegocios(marca));

test("mostra todos os gerentes do negócio sem abrir o cadastro da empresa", async ({ page }) => {
  const brokerId = await db.profileIdOf("broker");
  const segundoGerenteId = await db.profileIdOf("director");
  const negocio = await semearNegocio({ cliente, brokerId });

  // O primeiro gerente entra pelo autofill da equipe; o segundo prova a relação N:N.
  await db.insert("deal_participants", {
    deal_id: negocio.id,
    profile_id: segundoGerenteId,
    role: "manager",
  });

  await abrirPipeline(page);
  await buscar(page, cliente);
  const modal = await abrirDetalhe(page, cliente);

  await expect(seletor(modal, "Gerente 1 (Obrigatório)")).toContainText("E2E Gerente");
  await expect(seletor(modal, "Gerente 2 (opcional)")).toContainText("E2E Diretor");
});
