import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Globe, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { checkIpAllowed } from "@/integrations/supabase/checkin";

type Ip = { id: string; ip_range: string; label: string; active: boolean; created_at: string };

export default function AdminAllowedIps() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Ip[]>([]);
  const [ip, setIp] = useState("");
  const [label, setLabel] = useState("");
  const [myIp, setMyIp] = useState<string | null>(null);
  // `ip_is_allowed` avalia faixa CIDR e bypass do perfil — comparar strings na
  // tela diria "não cadastrado" para um IP já coberto por 200.150.10.0/24.
  const [myIpCovered, setMyIpCovered] = useState<boolean | null>(null);

  const load = async () => {
    const { data } = await supabase.from("allowed_ips").select("*").order("created_at", { ascending: false });
    setRows((data as any) || []);
  };
  useEffect(() => {
    load();
    fetch("https://api.ipify.org?format=json").then((r) => r.json()).then((d) => setMyIp(d.ip)).catch(() => {});
  }, []);

  const add = async () => {
    if (!ip.trim()) return;
    const ipRange = ip.trim().includes("/") ? ip.trim() : `${ip.trim()}/32`;
    const { error } = await supabase.from("allowed_ips").insert({
      ip_range: ipRange,
      label: label.trim() || "IP autorizado",
    });
    if (error) return toast.error(error.message);
    toast.success("IP autorizado.");
    setIp(""); setLabel(""); load();
  };
  // Reavalia a cobertura sempre que a lista ou o IP detectado mudam.
  useEffect(() => {
    if (!myIp || !user?.id) { setMyIpCovered(null); return; }
    checkIpAllowed(myIp, user.id).then(setMyIpCovered).catch(() => setMyIpCovered(null));
  }, [myIp, user?.id, rows]);

  const remove = async (id: string) => {
    if (!confirm("Remover este IP?")) return;
    const { error } = await supabase.from("allowed_ips").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };
  const toggle = async (row: Ip) => {
    const { error } = await supabase.from("allowed_ips").update({ active: !row.active }).eq("id", row.id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Globe className="h-6 w-6" /> IPs autorizados para check-in</h1>
        <p className="text-sm text-muted-foreground">Apenas usuários conectados a partir destes IPs poderão fazer check-in.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Adicionar IP</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button size="sm" variant="secondary" onClick={async () => {
              try {
                const d = await fetch("https://api.ipify.org?format=json").then(r => r.json());
                setMyIp(d.ip);
                setIp(d.ip);
                toast.success(`Seu IP: ${d.ip}`);
              } catch { toast.error("Não foi possível detectar o IP."); }
            }}>
              <Globe className="h-4 w-4 mr-1" /> Descobrir meu IP
            </Button>
            {myIp && (
              <span className="text-muted-foreground">
                atual: <code className="px-1 py-0.5 bg-muted rounded">{myIp}</code>
              </span>
            )}
            {myIp && myIpCovered === true && (
              <span className="text-emerald-500 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> já coberto por uma faixa cadastrada
              </span>
            )}
            {myIp && myIpCovered === false && (
              <span className="text-amber-500 flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" /> não coberto — o check-in daqui seria barrado
              </span>
            )}
          </div>
          <div className="flex flex-col md:flex-row gap-2">
            <Input placeholder="Ex: 200.150.10.5" value={ip} onChange={(e) => setIp(e.target.value)} />
            <Input placeholder="Descrição (ex: Escritório sede)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button onClick={add}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Lista ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border rounded-lg p-3">
                <code className="font-mono text-sm">{r.ip_range}</code>
                <span className="text-sm text-muted-foreground flex-1">{r.label || "—"}</span>
                <Badge variant={r.active ? "default" : "secondary"} className="cursor-pointer" onClick={() => toggle(r)}>
                  {r.active ? "ativo" : "inativo"}
                </Badge>
                <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {rows.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">Nenhum IP cadastrado.</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
