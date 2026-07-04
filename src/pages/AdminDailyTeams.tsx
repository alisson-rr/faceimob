import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Link2, Copy, Plus, RefreshCw, Eye, EyeOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

async function sha256(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function slugify(s: string) {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function managerSlug(teamName: string) {
  // "Equipe Alexandre Chaves" -> "alexandre-chaves"
  return slugify(teamName.replace(/^equipe\s+/i, ""));
}

export default function AdminDailyTeams() {
  const qc = useQueryClient();
  const [newTeam, setNewTeam] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const { data: teams } = useQuery({
    queryKey: ["daily-teams"],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name, team_pins(active, pin_plain)")
        .order("name");
      return data ?? [];
    },
  });

  const createTeam = async () => {
    if (!newTeam.trim()) return;
    const { error } = await supabase.from("teams").insert({ name: newTeam.trim() });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setNewTeam("");
    toast({ title: "Equipe criada" });
    qc.invalidateQueries({ queryKey: ["daily-teams"] });
  };

  const regeneratePin = async (teamId: string) => {
    const pin = randomPin();
    const pin_hash = await sha256(pin);
    const { error } = await supabase
      .from("team_pins")
      .upsert({ team_id: teamId, pin_hash, pin_plain: pin, active: true }, { onConflict: "team_id" });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setRevealed((prev) => ({ ...prev, [teamId]: true }));
    toast({ title: "PIN gerado", description: pin });
    qc.invalidateQueries({ queryKey: ["daily-teams"] });
  };

  const linkFor = (t: any) => `${window.location.origin}/daily/${t.id}/${managerSlug(t.name)}`;

  const copy = (text: string, label = "Link") => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado` });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Diário das Equipes — Links & PINs</h1>
        <p className="text-xs text-muted-foreground">Cada equipe tem um link amigável (com o nome do gerente) e um PIN. Compartilhe com o gerente.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Nova equipe</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Ex.: Equipe Fulano de Tal" className="max-w-sm text-xs" />
          <Button size="sm" onClick={createTeam}><Plus className="h-3 w-3 mr-1" /> Criar</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(teams ?? []).map((t: any) => {
          const pinRow = Array.isArray(t.team_pins) ? t.team_pins[0] : t.team_pins;
          const hasPin = !!pinRow?.active;
          const plain: string | null = pinRow?.pin_plain ?? null;
          const isShown = revealed[t.id];
          const link = linkFor(t);
          return (
            <Card key={t.id} className="border-primary/20">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{t.name}</CardTitle>
                  <Badge variant={hasPin ? "default" : "outline"} className="text-[10px]">
                    {hasPin ? "PIN ativo" : "Sem PIN"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-mono bg-muted/30 rounded p-2">
                  <Link2 className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate flex-1">{link.replace(/^https?:\/\//, "")}</span>
                  <button onClick={() => copy(link)} className="hover:text-primary shrink-0" title="Copiar link">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>

                {hasPin && (
                  <div className="flex items-center gap-2 text-xs bg-primary/5 border border-primary/20 rounded p-2">
                    <KeyRound className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground">PIN:</span>
                    <span className="font-mono font-bold tracking-widest flex-1">
                      {isShown && plain ? plain : "••••••"}
                    </span>
                    {plain && (
                      <>
                        <button onClick={() => setRevealed((p) => ({ ...p, [t.id]: !isShown }))} className="hover:text-primary" title={isShown ? "Ocultar" : "Mostrar"}>
                          {isShown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                        <button onClick={() => copy(plain!, "PIN")} className="hover:text-primary" title="Copiar PIN">
                          <Copy className="h-3 w-3" />
                        </button>
                      </>
                    )}
                    {!plain && <span className="text-[10px] text-muted-foreground">gere novamente para exibir</span>}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(link)}>
                    <Copy className="h-3 w-3 mr-1" /> Copiar link
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => regeneratePin(t.id)}>
                    <RefreshCw className="h-3 w-3 mr-1" /> {hasPin ? "Renovar PIN" : "Gerar PIN"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
