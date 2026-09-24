import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DealRow } from "./data";
import { GradeAnual } from "./GradeAnualCard";

vi.mock("recharts", async original => ({ ...await original<typeof import("recharts")>(), ResponsiveContainer: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("abre com vendas em destaque e mantém vendas e VGV visíveis ao alternar a medida", async () => {
  const deals = [{ id: "a", outcome: "won", month_base: "02/2025", deal_value: 100_000 },
    { id: "b", outcome: "won", month_base: "02/2025", deal_value: 200_000 }] as DealRow[];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<GradeAnual deals={deals} />));
  const buttons = [...container.querySelectorAll("button")];
  const sales = buttons.find(b => b.textContent === "Vendas")!;
  const vgv = buttons.find(b => b.textContent === "VGV")!;
  const year = () => [...container.querySelectorAll("tbody tr")].find(row => row.querySelector("th")?.textContent === "2025")!;
  expect(sales.getAttribute("aria-pressed")).toBe("true");
  expect(year().querySelectorAll("td")[1].textContent).toMatch(/2 vendasR\$\s300\.000/);
  expect(year().lastElementChild?.textContent).toMatch(/2 vendasR\$\s300\.000/);
  await act(async () => vgv.click());
  expect(vgv.getAttribute("aria-pressed")).toBe("true");
  expect(year().querySelectorAll("td")[1].textContent).toMatch(/R\$\s300\.0002 vendas/);
  expect(year().lastElementChild?.textContent).toMatch(/R\$\s300\.0002 vendas/);
  await act(async () => root.unmount());
  container.remove();
});
