import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RepasseDeLeads } from "./RepasseDeLeads";
import { RepasseDeNegocios } from "./RepasseDeNegocios";

/**
 * Aba Repasses de Equipes (18/11/2026): escolher o que repassar de quem saiu
 * — propostas (negócios, 0327) ou leads (0343) — e para quem dos ativos.
 */
export function Repasses() {
  const [tipo, setTipo] = useState<"propostas" | "leads">("propostas");
  return (
    <div className="space-y-4">
      <div className="flex w-fit rounded-xl border border-border p-0.5" role="group" aria-label="O que repassar">
        {([["propostas", "Propostas"], ["leads", "Leads"]] as const).map(([valor, rotulo]) => (
          <Button
            key={valor} type="button" size="sm" variant={tipo === valor ? "default" : "ghost"}
            aria-pressed={tipo === valor} onClick={() => setTipo(valor)}
          >
            {rotulo}
          </Button>
        ))}
      </div>
      {tipo === "propostas" ? <RepasseDeNegocios /> : <RepasseDeLeads />}
    </div>
  );
}
