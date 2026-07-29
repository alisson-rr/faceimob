import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Link2, Copy, Plus, RefreshCw, Eye, EyeOff, Users, ShieldCheck, Globe, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { listPeople } from "@/integrations/supabase/newSchema";

const randomPin = () => Math.floor(100000 + Math.random() * 900000).toString();
const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const managerSlug = (teamName: string) => slugify(teamName.replace(/^equipe\s+/i, ""));
const DAILY_PUBLIC_ORIGIN = "https://crm-faceimob.com.br";

export default function AdminDailyTeams() {
  const qc = useQueryClient();
  const [newTeam, setNewTeam] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [generatedPins, setGeneratedPins] = useState<Record<string, string>>({});

  const { data: teams } = useQuery({
    queryKey: ["daily-teams"],
    queryFn: async () => {
      const [{ data: teamRows }, { data: linkRows }] = await Promise.all([
        (supabase as any).from("teams").select("id,name,active").order("name"),
        (supabase as any).from("public_links").select("id,team_id,slug,active,pin_hash").eq("kind", "daily_team"),
      ]);
      const links = new Map(((linkRows as any[]) || []).map(link => [link.team_id, link]));
      return ((teamRows as any[]) || []).map(team => ({ ...team, public_link: links.get(team.id) || null }));
    },
  });

  const { data: ips } = useQuery({
    queryKey: ["allowed-ips-mini"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("allowed_ips").select("id,ip_range,label,active").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: directors } = useQuery({
    queryKey: ["directors-public-links"],
    queryFn: async () => {
      const people = await listPeople();
      const directors = people.filter(person => person.active && person.roles.includes("director"));
      const { data: links } = await (supabase as any).from("public_links")
        .select("id,director_id,slug").eq("kind", "director_checkpoint");
      const byDirector = new Map(((links as any[]) || []).map(link => [link.director_id, link]));
      const result = [];
      for (const director of directors) {
        let link = byDirector.get(director.id);
        if (!link) {
          const { data } = await (supabase as any).from("public_links").insert({
            kind: "director_checkpoint",
            director_id: director.id,
            slug: `diretor-${managerSlug(director.name)}`,
            active: true,
          }).select("id,director_id,slug").single();
          link = data;
        }
        result.push({ ...director, public_slug: link?.slug || `diretor-${managerSlug(director.name)}` });
      }
      return result;
    },
  });

  const activeIps = (ips ?? []).filter((r: any) => r.active).length;
  const withPin = (teams ?? []).filter((t: any) => t.public_link?.active && t.public_link?.pin_hash).length;

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
    const team = (teams ?? []).find((row: any) => row.id === teamId) as any;
    let linkId = team?.public_link?.id;
    if (!linkId) {
      const { data, error } = await (supabase as any).from("public_links").insert({
        kind: "daily_team",
        team_id: teamId,
        slug: managerSlug(team?.name || teamId),
        active: true,
      }).select("id").single();
      if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
      linkId = data.id;
    }
    const { error } = await (supabase as any).rpc("set_public_link_pin", { p_link_id: linkId, p_pin: pin });
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setGeneratedPins(prev => ({ ...prev, [teamId]: pin }));
    setRevealed((prev) => ({ ...prev, [teamId]: true }));
    toast({ title: "PIN gerado", description: pin });
    qc.invalidateQueries({ queryKey: ["daily-teams"] });
  };

  const linkFor = (t: any) => `${DAILY_PUBLIC_ORIGIN}/daily/${t.public_link?.slug || managerSlug(t.name)}?v=public`;
  const adminLinkFor = (t: any) => `${window.location.origin}/daily/${t.public_link?.slug || managerSlug(t.name)}`;
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
            const hasPin = !!t.public_link?.active && !!t.public_link?.pin_hash;
            const plain: string | null = generatedPins[t.id] ?? null;
            const isShown = revealed[t.id];
            const link = linkFor(t);
            return (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2 hover:bg-primary/5">
                <div className="min-w-0 w-48">
                  <p className="text-xs font-semibold truncate">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{t.public_link?.slug || managerSlug(t.name)}</p>
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
                  {plain && (
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

                <Button asChild size="sm" variant="outline" className="h-7 px-2" title="Abrir daily como admin (sem PIN)">
                  <a href={adminLinkFor(t)} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Ver</a>
                </Button>
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

      {/* Links públicos de Diretores */}
      <Card className="border-border/50">
        <CardContent className="p-0">
          <div className="px-3 py-2 flex items-center justify-between border-b border-border/40">
            <div className="text-xs font-semibold flex items-center gap-2"><Link2 className="h-3.5 w-3.5 text-primary" /> Links públicos — Diretores (Checkpoint Semanal)</div>
          </div>
          <div className="divide-y divide-border/40">
            {(directors ?? []).map((d: any) => {
              const dlink = `${DAILY_PUBLIC_ORIGIN}/diretor/${d.public_slug}`;
              return (
                <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                  <div className="w-48 truncate font-semibold">{d.name}</div>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5 font-mono bg-muted/30 rounded px-2 py-1">
                    <Link2 className="h-3 w-3 text-primary shrink-0" />
                    <span className="truncate">{dlink.replace(/^https?:\/\//, "")}</span>
                    <button onClick={() => copy(dlink)} className="ml-auto hover:text-primary shrink-0" title="Copiar link">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-7 px-2">
                    <a href={dlink} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Ver</a>
                  </Button>
                </div>
              );
            })}
            {(directors ?? []).length === 0 && (
              <div className="p-4 text-center text-[11px] text-muted-foreground">Nenhum diretor cadastrado.</div>
            )}
          </div>
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
                <code className="font-mono">{r.ip_range}</code>
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
