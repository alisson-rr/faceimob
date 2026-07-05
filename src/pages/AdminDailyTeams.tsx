import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Link2, Copy, Plus, RefreshCw, Eye, EyeOff, Users, ShieldCheck, Globe } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

async function sha256(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomPin = () => Math.floor(100000 + Math.random() * 900000).toString();
const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const managerSlug = (teamName: string) => slugify(teamName.replace(/^equipe\s+/i, ""));

export default function AdminDailyTeams() {
  const qc = useQueryClient();
  const [newTeam, setNewTeam] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const { data: teams } = useQuery({
    queryKey: ["daily-teams"],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name, display_name, team_pins(active, pin_plain)")
        .order("name");
      return data ?? [];
    },
  });

  const { data: ips } = useQuery({
    queryKey: ["allowed-ips-mini"],
    queryFn: async () => {
      const { data } = await supabase.from("allowed_ips").select("id, ip, label, active").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const activeIps = (ips ?? []).filter((r: any) => r.active).length;
  const withPin = (teams ?? []).filter((t: any) => (Array.isArray(t.team_pins) ? t.team_pins[0]?.active : t.team_pins?.active)).length;

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

  const linkFor = (t: any) => `${window.location.origin}/daily/${managerSlug(t.display_name || t.name)}`;
  const copy = (text: string, label = "Link") => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado` });
  };

  return (
    <div className="space-y-3">
      {/* Header compacto */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> Diário — Links, PINs & IPs
          </h1>
          <p className="text-[11px] text-muted-foreground">Uma linha por equipe. Compartilhe o link com o gerente.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Ex.: Equipe Fulano" className="h-8 w-56 text-xs" />
          <Button size="sm" className="h-8" onClick={createTeam}><Plus className="h-3 w-3 mr-1" /> Nova equipe</Button>
          <Button asChild size="sm" variant="outline" className="h-8"><Link to="/admin/allowed-ips"><Globe className="h-3 w-3 mr-1" /> Gerenciar IPs</Link></Button>
        </div>
      </div>

      {/* KPIs em faixa fina */}
      <div className="grid grid-cols-3 gap-2">
        <KpiMini icon={Users}       label="Equipes"      value={teams?.length ?? 0} tone="text-cyan-300" />
        <KpiMini icon={ShieldCheck} label="Com PIN ativo" value={withPin}           tone="text-emerald-300" />
        <KpiMini icon={Globe}       label="IPs ativos"    value={activeIps}         tone="text-amber-300" />
      </div>

      {/* Linhas densas de equipes */}
      <Card className="border-border/50">
        <CardContent className="p-0 divide-y divide-border/40">
          {(teams ?? []).map((t: any) => {
            const pinRow = Array.isArray(t.team_pins) ? t.team_pins[0] : t.team_pins;
            const hasPin = !!pinRow?.active;
            const plain: string | null = pinRow?.pin_plain ?? null;
            const isShown = revealed[t.id];
            const link = linkFor(t);
            return (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2 hover:bg-primary/5">
                <div className="min-w-0 w-48">
                  <p className="text-xs font-semibold truncate">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{managerSlug(t.display_name || t.name)}</p>
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[10px] font-mono bg-muted/30 rounded px-2 py-1">
                  <Link2 className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate">{link.replace(/^https?:\/\//, "")}</span>
                  <button onClick={() => copy(link)} className="ml-auto hover:text-primary shrink-0" title="Copiar link">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 w-40 shrink-0">
                  <Badge variant={hasPin ? "default" : "outline"} className="text-[9px] h-4 px-1">
                    {hasPin ? "PIN" : "Sem PIN"}
                  </Badge>
                  {hasPin && plain && (
                    <>
                      <span className="font-mono text-xs tracking-widest">{isShown ? plain : "••••••"}</span>
                      <button onClick={() => setRevealed((p) => ({ ...p, [t.id]: !isShown }))} className="hover:text-primary" title={isShown ? "Ocultar" : "Mostrar"}>
                        {isShown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                      <button onClick={() => copy(plain!, "PIN")} className="hover:text-primary" title="Copiar PIN">
                        <Copy className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>

                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => regeneratePin(t.id)}>
                  <RefreshCw className="h-3 w-3 mr-1" /> {hasPin ? "Renovar" : "Gerar"}
                </Button>
              </div>
            );
          })}
          {(teams ?? []).length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">Nenhuma equipe cadastrada.</div>
          )}
        </CardContent>
      </Card>

      {/* Bloco compacto de IPs (top 6) */}
      <Card className="border-border/50">
        <CardContent className="p-0">
          <div className="px-3 py-2 flex items-center justify-between border-b border-border/40">
            <div className="text-xs font-semibold flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-primary" /> IPs autorizados (últimos)</div>
            <Link to="/admin/allowed-ips" className="text-[10px] text-primary hover:underline">Ver todos</Link>
          </div>
          <div className="divide-y divide-border/40">
            {(ips ?? []).slice(0, 6).map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <code className="font-mono">{r.ip}</code>
                <span className="text-muted-foreground truncate flex-1">{r.label || "—"}</span>
                <Badge variant={r.active ? "default" : "secondary"} className="text-[9px] h-4 px-1">{r.active ? "ativo" : "inativo"}</Badge>
              </div>
            ))}
            {(ips ?? []).length === 0 && (
              <div className="p-4 text-center text-[11px] text-muted-foreground">Nenhum IP cadastrado.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiMini({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="px-3 py-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <div className="min-w-0">
          <p className="text-[10px] uppercase text-muted-foreground leading-none">{label}</p>
          <p className={`text-lg font-bold leading-tight ${tone}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
