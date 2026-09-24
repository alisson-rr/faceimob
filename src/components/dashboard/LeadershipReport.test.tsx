import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { LeadershipTables } from "./LeadershipReport";
import type { LeadershipRow } from "./leadershipData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("mostra diretores antes de gerentes com as duas metas e resultados independentes", async () => {
  const director: LeadershipRow = { id: "d", name: "Diretor A", role: "director", goal: 20, compensationGoal: 25, reached: 50,
    leads: 1234, agile: 27, business: 1, sales: 10, vgv: 1894395.06, off: 66 };
  const manager: LeadershipRow = { ...director, id: "g", name: "Gerente B", role: "manager", goal: null, compensationGoal: null, reached: null };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<LeadershipTables rows={[manager, director]} month="09/2026" />));
  expect([...container.querySelectorAll("h3")].map(h => h.textContent)).toEqual(["Diretores", "Gerentes"]);
  const tables = [...container.querySelectorAll("table")];
  expect([...tables[0].querySelectorAll("tbody td")].map(td => td.textContent)).toEqual([
    "25", "20", "50%", "1.234", "27", "1", "10", "R$ 1.894.395,06", "66",
  ]);
  expect([...tables[1].querySelectorAll("tbody td")].slice(0, 3).map(td => td.textContent)).toEqual(["—", "—", "—"]);
  await act(async () => root.unmount());
  container.remove();
});
