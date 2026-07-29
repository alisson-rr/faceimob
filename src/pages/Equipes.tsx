import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, Pencil, Link2, Search, Crown, Shield, UserCog, User, Loader2, Eye, EyeOff, Copy, Check, KeyRound } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { listPeople } from "@/integrations/supabase/newSchema";

import { BrokerEditModal, type EditableBroker } from "@/components/BrokerEditModal";

interface BrokerRow {
  id: string;
  name: string;
  role: string;
  manager_id: string | null;
  director_id: string | null;
  active: boolean;
  user_id: string | null;
  email?: string | null;
  avatar_url?: string | null;
  monthly_goal?: number | null;
  yearly_goal?: number | null;
}

const initials = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase();

function GoalRow({ broker, onSaved }: { broker: BrokerRow; onSaved: () => void }) {
  const [monthly, setMonthly] = useState(String(broker.monthly_goal ?? 0));
  const [yearly, setYearly] = useState(String(broker.yearly_goal ?? 0));
  const [saving, setSaving] = useState(false);
  const dirty = Number(monthly) !== Number(broker.monthly_goal ?? 0) || Number(yearly) !== Number(broker.yearly_goal ?? 0);
  const save = async () => {
    setSaving(true);
    const now = new Date();
    const periods = [
      {
        period_type: "month",
        period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
        target: Number(monthly || 0),
      },
      {
        period_type: "year",
        period: `${now.getFullYear()}-01-01`,
        target: Number(yearly || 0),
      },
    ];
    let error: any = null;
    for (const goal of periods) {
      const existing = await (supabase as any)
        .from("goals")
        .select("id")
        .eq("scope", "profile")
        .eq("profile_id", broker.id)
        .eq("period_type", goal.period_type)
        .eq("period", goal.period)
        .eq("metric", "vgv")
        .maybeSingle();
      const result = existing.data
        ? await (supabase as any).from("goals").update({ target: goal.target }).eq("id", existing.data.id)
        : await (supabase as any).from("goals").insert({
            scope: "profile",
            profile_id: broker.id,
            period_type: goal.period_type,
            period: goal.period,
            metric: "vgv",
            target: goal.target,
          });
      if (result.error) {
        error = result.error;
        break;
      }
    }
    setSaving(false);
    if (error) return toast({ title: "Erro ao salvar meta", description: error.message, variant: "destructive" });
    toast({ title: "Meta salva" });
    onSaved();
  };
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] uppercase text-muted-foreground shrink-0">Metas R$</span>
      <Input type="number" value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="mês" className="h-6 text-[11px] px-2" title="Meta mensal (R$)" />
      <Input type="number" value={yearly} onChange={e => setYearly(e.target.value)} placeholder="ano" className="h-6 text-[11px] px-2" title="Meta anual (R$)" />
      <Button size="sm" variant={dirty ? "default" : "ghost"} className="h-6 px-2 text-[10px]" onClick={save} disabled={saving || !dirty}>
        {saving ? "..." : "Salvar"}
      </Button>
    </div>
  );
}

export default function Equipes() {
  const { role, user } = useAuth();
  const canEdit = role === "admin" || role === "director";

  const [rows, setRows] = useState<BrokerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [teamsByMgr, setTeamsByMgr] = useState<Record<string, { id: string; display_name: string | null }>>({});
  const [teamNameDrafts, setTeamNameDrafts] = useState<Record<string, string>>({});

  // individual edit — full profile modal
  const [profileEdit, setProfileEdit] = useState<EditableBroker | null>(null);

  // bulk assign
  const [bulk, setBulk] = useState<{ column: "manager" | "broker" } | null>(null);
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkFilter, setBulkFilter] = useState("");
  const [saving, setSaving] = useState(false);

  // Admin-only: credentials of each broker/manager/director
  const [creds, setCreds] = useState<Record<string, { email: string | null; password: string | null }>>({});
  const [showPw, setShowPw] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const isAdmin = role === "admin";

  const togglePw = (id: string) =>
    setShowPw(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const copyValue = async (key: string, val: string) => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    } catch {}
  };

  const CredLine = ({ id }: { id: string }) => {
    if (!isAdmin) return null;
    const c = creds[id];
    if (!c || (!c.email && !c.password)) return null;
    const visible = showPw.has(id);
    return (
      <div className="flex items-center gap-1 mt-1 rounded-md bg-background/60 border border-border/30 px-1.5 py-1">
        <KeyRound className="h-3 w-3 text-primary shrink-0" />
        <code className="text-[10px] truncate flex-1" title={c.email || ""}>{c.email || "—"}</code>
        <span className="text-muted-foreground text-[10px]">·</span>
        <code className="text-[10px] font-mono">{c.password ? (visible ? c.password : "••••••••") : "—"}</code>
        {c.password && (
          <button type="button" onClick={() => togglePw(id)} className="text-muted-foreground hover:text-foreground p-0.5" title={visible ? "Ocultar" : "Mostrar"}>
            {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        )}
        {c.password && (
          <button type="button" onClick={() => copyValue(`pw-${id}`, c.password!)} className="text-muted-foreground hover:text-foreground p-0.5" title="Copiar senha">
            {copiedKey === `pw-${id}` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    );
  };

  const load = async () => {
    setLoading(true);
    try {
      const people = await listPeople();
      setRows(people.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.role,
        manager_id: person.manager_id,
        director_id: person.director_id,
        active: person.active,
        user_id: person.id,
        email: person.email,
        avatar_url: person.avatar_url,
      })));
    } catch (error: any) {
      toast({ title: "Erro ao carregar equipe", description: error.message, variant: "destructive" });
    }
    const { data: teamsData } = await (supabase as any).from("teams").select("id,manager_id,name");
    const map: Record<string, { id: string; display_name: string | null }> = {};
    const drafts: Record<string, string> = {};
    (teamsData || []).forEach((t: any) => {
      if (t.manager_id) {
        map[t.manager_id] = { id: t.id, display_name: t.name };
        drafts[t.manager_id] = t.name ?? "";
      }
    });
    setTeamsByMgr(map);
    setTeamNameDrafts(drafts);
    setLoading(false);
  };

  const saveTeamName = async (managerId: string, managerName: string) => {
    const name = (teamNameDrafts[managerId] ?? "").trim();
    const existing = teamsByMgr[managerId];
    if (existing) {
      const { error } = await supabase.from("teams").update({ name: name || managerName }).eq("id", existing.id);
      if (error) return toast({ title: "Falha ao salvar", description: error.message, variant: "destructive" });
      setTeamsByMgr(p => ({ ...p, [managerId]: { ...existing, display_name: name || null } }));
    } else {
      const { data, error } = await supabase.from("teams").insert({ manager_id: managerId, name: name || managerName } as any).select("id").single();
      if (error) return toast({ title: "Falha ao criar equipe", description: error.message, variant: "destructive" });
      setTeamsByMgr(p => ({ ...p, [managerId]: { id: data.id, display_name: name || null } }));
    }
    toast({ title: "Nome da equipe salvo" });
  };

  useEffect(() => { load(); }, []);

  // Admin: fetch credentials for all brokers so they can be shown on each card
  useEffect(() => {
    if (!isAdmin || rows.length === 0) return;
    const map: Record<string, { email: string | null; password: string | null }> = {};
    rows.forEach((row) => {
      map[row.id] = { email: row.email || null, password: null };
    });
    setCreds(map);
  }, [isAdmin, rows]);



  const directors = useMemo(() => rows.filter(r => r.role === "director"), [rows]);
  const managers = useMemo(() => rows.filter(r => r.role === "manager"), [rows]);
  const brokers = useMemo(() => rows.filter(r => r.role === "broker"), [rows]);
  const ccas = useMemo(() => rows.filter(r => r.role === "cca"), [rows]);


  // "meu perfil": broker vinculado ao user logado
  const myBroker = useMemo(() => rows.find(r => r.user_id === user?.id) || null, [rows, user]);

  // Director "scope": if role=director, only its own subtree
  const myScopeDirectorId = useMemo(() => {
    if (role !== "director") return null;
    return myBroker?.id ?? null;
  }, [role, myBroker]);

  const inScope = (b: BrokerRow) => {
    if (role === "admin") return true;
    if (!myScopeDirectorId) return false;
    if (b.role === "director") return b.id === myScopeDirectorId;
    if (b.role === "manager") return b.director_id === myScopeDirectorId;
    return b.director_id === myScopeDirectorId;
  };

  const filter = (list: BrokerRow[]) =>
    list.filter(b => (search ? b.name.toLowerCase().includes(search.toLowerCase()) : true));

  const openEdit = async (_type: "manager" | "broker", m: BrokerRow) => {
    const { data } = await (supabase as any).from("profiles")
      .select("id,full_name,email,phone,avatar_url,status")
      .eq("id", m.id).maybeSingle();
    const merged = {
      ...(data as any),
      name: data?.full_name,
      celular: data?.phone,
      role: m.role,
      manager_id: m.manager_id,
      director_id: m.director_id,
      active: data?.status === "active",
      user_id: m.id,
      login_email: data?.email,
      login_email_confirmed: true,
    };
    setProfileEdit(merged || (m as any));
  };

  const openBulk = (column: "manager" | "broker") => {
    setBulk({ column }); setBulkTarget(""); setBulkSelected(new Set()); setBulkFilter("");
  };

  useEffect(() => {
    if (!bulk || !bulkTarget) { setBulkSelected(new Set()); return; }
    const preSelected = bulk.column === "broker"
      ? brokers.filter(b => b.manager_id === bulkTarget).map(b => b.id)
      : managers.filter(m => m.director_id === bulkTarget).map(m => m.id);
    setBulkSelected(new Set(preSelected));
  }, [bulk, bulkTarget, brokers, managers]);

  const applyBulk = async () => {
    if (!bulk || !bulkTarget || bulkSelected.size === 0) return;
    setSaving(true);
    const ids = Array.from(bulkSelected);
    if (bulk.column === "broker") {
      const { data: targetTeam, error: teamError } = await (supabase as any)
        .from("teams")
        .select("id")
        .eq("manager_id", bulkTarget)
        .eq("active", true)
        .maybeSingle();
      if (teamError || !targetTeam) {
        setSaving(false);
        return toast({ title: "Erro", description: teamError?.message || "O gerente não possui uma equipe ativa.", variant: "destructive" });
      }
      for (const profileId of ids) {
        await (supabase as any)
          .from("team_members")
          .update({ left_at: new Date().toISOString().slice(0, 10) })
          .eq("profile_id", profileId)
          .is("left_at", null);
        const { error } = await (supabase as any)
          .from("team_members")
          .insert({ team_id: targetTeam.id, profile_id: profileId });
        if (error) {
          setSaving(false);
          return toast({ title: "Erro", description: error.message, variant: "destructive" });
        }
      }
    } else {
      const { error } = await (supabase as any)
        .from("teams")
        .update({ director_id: bulkTarget })
        .in("manager_id", ids);
      if (error) { setSaving(false); return toast({ title: "Erro", description: error.message, variant: "destructive" }); }
    }
    setSaving(false);
    toast({ title: `${ids.length} vínculo(s) atualizados` });
    setBulk(null);
    load();
  };

  const bulkOptions = bulk?.column === "broker" ? managers : directors;
  const bulkList = filter(bulk?.column === "broker" ? brokers : managers).filter(b => inScope(b));
  const bulkFiltered = bulkList.filter(b => b.name.toLowerCase().includes(bulkFilter.toLowerCase()));

  // Team performance
  const teamStats = useMemo(() => {
    return managers.filter(inScope).map(m => {
      const team = brokers.filter(b => b.manager_id === m.id);
      const director = directors.find(d => d.id === m.director_id);
      return { manager: m, director, size: team.length, brokers: team };
    }).sort((a, b) => b.size - a.size);
  }, [managers, brokers, directors, role, myScopeDirectorId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Equipes
          </h1>
          <p className="text-xs text-muted-foreground">
            Perfil, hierarquia e performance — tudo em uma tela
          </p>
        </div>
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Buscar pessoa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs w-64"
          />
        </div>
      </div>

      {/* Meu Perfil */}
      <Card className="glass border-primary/30">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="h-4 w-4 text-primary" /> Meu Perfil
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {myBroker ? (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold text-primary">
                {initials(myBroker.name)}
              </div>
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div><span className="text-muted-foreground">Nome</span><p className="font-medium">{myBroker.name}</p></div>
                <div><span className="text-muted-foreground">Função</span><p className="font-medium capitalize">{myBroker.role}</p></div>
                <div><span className="text-muted-foreground">Gerente</span><p className="font-medium">{managers.find(m => m.id === myBroker.manager_id)?.name ?? "—"}</p></div>
                <div><span className="text-muted-foreground">Diretor</span><p className="font-medium">{directors.find(d => d.id === myBroker.director_id)?.name ?? "—"}</p></div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Seu usuário não está vinculado a um corretor cadastrado.</p>
          )}
        </CardContent>
      </Card>

      {/* Hierarquia */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Diretores */}
          <Card className="border-blue-500/30">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-blue-400 flex items-center gap-2">
                <Crown className="h-4 w-4" /> Diretores ({filter(directors).filter(inScope).length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[520px] overflow-y-auto">
              {filter(directors).filter(inScope).map(d => {
                const dirManagers = managers.filter(m => m.director_id === d.id);
                const sumMonthly = dirManagers.reduce((s, m) => s + Number(m.monthly_goal || 0), 0);
                const sumYearly = dirManagers.reduce((s, m) => s + Number(m.yearly_goal || 0), 0);
                const monthsLeft = 12 - new Date().getMonth();
                const perMonthLeft = sumYearly > 0 ? sumYearly / 12 : 0;
                return (
                  <div key={d.id} className="p-2 rounded-lg border border-border/30 bg-blue-500/5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">{initials(d.name)}</div>
                      <span className="text-xs font-medium flex-1 truncate">{d.name}</span>
                      <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400">{dirManagers.length} ger.</Badge>
                      {canEdit && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit("manager", d)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <div className="p-1.5 rounded bg-background/60 border border-border/30">
                        <p className="text-muted-foreground uppercase text-[9px]">Meta mês (Σ ger.)</p>
                        <p className="font-bold text-blue-400">{sumMonthly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</p>
                      </div>
                      <div className="p-1.5 rounded bg-background/60 border border-border/30">
                        <p className="text-muted-foreground uppercase text-[9px]">Meta ano (Σ ger.)</p>
                        <p className="font-bold text-blue-400">{sumYearly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</p>
                      </div>
                    </div>
                    {sumYearly > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        Meses restantes: <strong className="text-foreground">{monthsLeft}</strong> · Ritmo/mês: <strong className="text-foreground">{perMonthLeft.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</strong>
                      </p>
                    )}
                    <CredLine id={d.id} />

                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Gerentes */}
          <Card className="border-cyan-500/30">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-cyan-400 flex items-center gap-2">
                <UserCog className="h-4 w-4" /> Gerentes ({filter(managers).filter(inScope).length})
              </CardTitle>
              {canEdit && (
                <Button size="sm" variant="outline" className="h-7 text-[11px] border-cyan-500/40 text-cyan-400" onClick={() => openBulk("manager")}>
                  <Link2 className="h-3 w-3 mr-1" /> Vincular em massa
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[520px] overflow-y-auto">
              {filter(managers).filter(inScope).map(m => {
                const dir = directors.find(d => d.id === m.director_id);
                return (
                  <div key={m.id} className="p-2 rounded-lg border border-border/30 bg-cyan-500/5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400">{initials(m.name)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{m.name}</p>
                        <p className={cn("text-[10px] truncate", dir ? "text-blue-400" : "text-muted-foreground")}>
                          {dir ? `↑ ${dir.name}` : "Sem diretor"}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400">
                        {brokers.filter(b => b.manager_id === m.id).length}
                      </Badge>
                      {canEdit && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit("manager", m)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] uppercase text-muted-foreground shrink-0">Equipe</span>
                        <Input
                          value={teamNameDrafts[m.id] ?? ""}
                          onChange={(e) => setTeamNameDrafts(p => ({ ...p, [m.id]: e.target.value }))}
                          onBlur={() => {
                            const current = teamsByMgr[m.id]?.display_name ?? "";
                            if ((teamNameDrafts[m.id] ?? "") !== current) saveTeamName(m.id, m.name);
                          }}
                          placeholder={`Equipe ${m.name.split(" ")[0]}`}
                          className="h-6 text-[11px] px-2"
                        />
                      </div>
                    )}
                    {canEdit && <GoalRow broker={m} onSaved={load} />}
                    <CredLine id={m.id} />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Corretores */}
          <Card className="border-emerald-500/30">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-emerald-400 flex items-center gap-2">
                <Users className="h-4 w-4" /> Corretores ({filter(brokers).filter(inScope).length})
              </CardTitle>
              {canEdit && (
                <Button size="sm" variant="outline" className="h-7 text-[11px] border-emerald-500/40 text-emerald-400" onClick={() => openBulk("broker")}>
                  <Link2 className="h-3 w-3 mr-1" /> Vincular em massa
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[520px] overflow-y-auto">
              {filter(brokers).filter(inScope).map(b => {
                const mgr = managers.find(m => m.id === b.manager_id);
                return (
                  <div key={b.id} className="p-2 rounded-lg border border-border/30 bg-emerald-500/5 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">{initials(b.name)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{b.name}</p>
                        <p className={cn("text-[10px] truncate", mgr ? "text-cyan-400" : "text-muted-foreground")}>
                          {mgr ? `↑ ${mgr.name}` : "Sem gerente"}
                        </p>
                      </div>
                      {canEdit && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit("broker", b)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <CredLine id={b.id} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* CCAs */}
      <Card className="border-amber-500/30">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-amber-400 flex items-center gap-2">
            <Shield className="h-4 w-4" /> CCAs ({filter(ccas).length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filter(ccas).map(c => (
            <div key={c.id} className="p-2 rounded-lg border border-border/30 bg-amber-500/5 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-400">{initials(c.name)}</div>
                <p className="text-xs font-medium flex-1 truncate">{c.name}</p>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit("broker", c)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <CredLine id={c.id} />
            </div>
          ))}
          {filter(ccas).length === 0 && (
            <p className="text-xs text-muted-foreground col-span-full">Nenhum CCA cadastrado. Crie um perfil com função "cca" para gerenciar aqui.</p>
          )}
        </CardContent>
      </Card>


      {/* Performance por Equipe */}
      <Card className="glass">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Performance por Equipe
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            {teamStats.map(t => (
              <div key={t.manager.id} className="shrink-0 w-[280px] snap-start p-3 rounded-lg border border-border/30 bg-secondary/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400">{initials(t.manager.name)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{t.manager.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{t.director?.name ?? "—"}</p>
                  </div>
                  <Badge className="text-[10px] bg-emerald-600/20 text-emerald-400 border-emerald-500/30 shrink-0">{t.size}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.brokers.map(b => (
                    <span key={b.id} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/40 border border-border/30">{b.name.split(" ")[0]}</span>
                  ))}
                  {t.brokers.length === 0 && <span className="text-[10px] text-muted-foreground">Sem corretores</span>}
                </div>
              </div>
            ))}
            {teamStats.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma equipe cadastrada.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Profile edit modal */}
      <BrokerEditModal
        open={!!profileEdit}
        broker={profileEdit}
        managers={managers.map(m => ({ id: m.id, name: m.name }))}
        directors={directors.map(d => ({ id: d.id, name: d.name }))}
        isAdmin={role === "admin"}
        onClose={() => setProfileEdit(null)}
        onSaved={() => { setProfileEdit(null); load(); }}
      />


      {/* Bulk assign dialog */}
      <Dialog open={!!bulk} onOpenChange={(o) => !o && setBulk(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              {bulk?.column === "broker" ? "Vincular corretores a um gerente" : "Vincular gerentes a um diretor"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              1) Escolha o superior. 2) Marque quem deve pertencer a ele. 3) Aplique.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Select value={bulkTarget} onValueChange={setBulkTarget}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder={bulk?.column === "broker" ? "Escolher gerente..." : "Escolher diretor..."} />
              </SelectTrigger>
              <SelectContent>
                {bulkOptions.filter(inScope).map(o => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {bulkTarget && (
              <>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input placeholder="Filtrar..." value={bulkFilter} onChange={e => setBulkFilter(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{bulkSelected.size} selecionado(s) de {bulkFiltered.length}</span>
                  <div className="flex gap-2">
                    <button className="hover:text-primary" onClick={() => setBulkSelected(new Set(bulkFiltered.map(b => b.id)))}>Todos</button>
                    <button className="hover:text-primary" onClick={() => setBulkSelected(new Set())}>Nenhum</button>
                  </div>
                </div>
                <ScrollArea className="h-72 rounded-md border border-border/40">
                  <div className="divide-y divide-border/30">
                    {bulkFiltered.map(m => {
                      const checked = bulkSelected.has(m.id);
                      return (
                        <label key={m.id} className="flex items-center gap-2 p-2 hover:bg-secondary/40 cursor-pointer text-xs">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setBulkSelected(prev => {
                                const next = new Set(prev);
                                v ? next.add(m.id) : next.delete(m.id);
                                return next;
                              });
                            }}
                          />
                          <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold">{initials(m.name)}</div>
                          <span className="flex-1 truncate">{m.name}</span>
                          {bulk?.column === "broker" && m.manager_id && m.manager_id !== bulkTarget && (
                            <span className="text-[10px] text-amber-400">
                              já em {managers.find(x => x.id === m.manager_id)?.name.split(" ")[0]}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulk(null)}>Cancelar</Button>
            <Button size="sm" onClick={applyBulk} disabled={saving || !bulkTarget || bulkSelected.size === 0}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Aplicar ({bulkSelected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
