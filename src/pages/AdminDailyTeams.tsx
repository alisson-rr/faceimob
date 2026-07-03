import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Link2, Copy, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

async function sha256(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default function AdminDailyTeams() {
  const qc = useQueryClient();
  const [newTeam, setNewTeam] = useState("");
  const [revealedPin, setRevealedPin] = useState<{ team: string; pin: string } | null>(null);

  const { data: teams } = useQuery({
    queryKey: ["daily-teams"],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name, team_pins(active)")
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

  const regeneratePin = async (teamId: string, teamName: string) => {
    const pin = randomPin();
    const pin_hash = await sha256(pin);
    const { error } = await supabase
      .from("team_pins")
      .upsert({ team_id: teamId, pin_hash, active: true }, { onConflict: "team_id" });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setRevealedPin({ team: teamName, pin });
    qc.invalidateQueries({ queryKey: ["daily-teams"] });
  };

  const copyLink = (teamId: string) => {
    const url = `${window.location.origin}/daily/${teamId}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copiado", description: url });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Diário das Equipes — Links & PINs</h1>
        <p className="text-xs text-muted-foreground">Gere o PIN e o link público para cada gerente preencher os dados diários.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Nova equipe</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Nome da equipe" className="max-w-sm text-xs" />
          <Button size="sm" onClick={createTeam}><Plus className="h-3 w-3 mr-1" /> Criar</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(teams ?? []).map((t: any) => {
          const hasPin = Array.isArray(t.team_pins) ? t.team_pins.some((p: any) => p.active) : !!t.team_pins?.active;
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
                <div className="flex items-center gap-2 text-[10px] font-mono bg-muted/30 rounded p-2 truncate">
                  <Link2 className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate">/daily/{t.id}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => copyLink(t.id)}>
                    <Copy className="h-3 w-3 mr-1" /> Copiar link
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => regeneratePin(t.id, t.name)}>
                    <RefreshCw className="h-3 w-3 mr-1" /> {hasPin ? "Renovar PIN" : "Gerar PIN"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {revealedPin && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={() => setRevealedPin(null)}>
          <Card className="max-w-md w-full border-primary/50" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">PIN gerado para {revealedPin.team}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">⚠️ Copie agora — não será exibido novamente.</p>
              <div className="text-4xl font-black text-center tracking-[0.4em] py-4 bg-primary/10 rounded-lg border border-primary/40">
                {revealedPin.pin}
              </div>
              <Button className="w-full" onClick={() => { navigator.clipboard.writeText(revealedPin.pin); toast({ title: "PIN copiado" }); }}>
                <Copy className="h-3 w-3 mr-1" /> Copiar PIN
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setRevealedPin(null)}>Fechar</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
