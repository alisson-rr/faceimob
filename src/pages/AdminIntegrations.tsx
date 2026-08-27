import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyRound, Loader2, ShieldCheck, Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  listCronJobsHealth,
  listIntegrations,
  setIntegrationSecret,
  type CronJobHealth,
  type IntegrationRecord,
} from "@/integrations/supabase/integrations";
import { INTEGRATION_SLOTS, slotKey } from "@/lib/integrationCatalog";
import { describeError } from "@/lib/supabaseError";

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
};

export default function AdminIntegrations() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [stored, setStored] = useState<IntegrationRecord[]>([]);
  const [jobs, setJobs] = useState<CronJobHealth[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // A saúde do cron é informativa: se falhar, não pode derrubar o cofre.
      const [integrations, health] = await Promise.all([
        listIntegrations(),
        listCronJobsHealth().catch(() => [] as CronJobHealth[]),
      ]);
      setStored(integrations);
      setJobs(health);
    } catch (e) {
      toast({
        title: "Falha ao carregar integrações",
        description: describeError(e, "Não foi possível carregar as integrações."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const storedByKey = useMemo(
    () => new Map(stored.map((s) => [slotKey(s.provider, s.label), s])),
    [stored],
  );

  const save = async (provider: string, label: string) => {
    const k = slotKey(provider, label);
    const secret = (drafts[k] ?? "").trim();
    if (!secret) {
      return toast({ title: "Informe a credencial", variant: "destructive" });
    }
    setSaving(k);
    try {
      await setIntegrationSecret(provider, label, secret);
      // Limpa o campo: o valor não volta do servidor e não deve ficar na tela.
      setDrafts((prev) => ({ ...prev, [k]: "" }));
      await load();
      toast({
        title: "Credencial salva no cofre",
        description: "As functions passam a usar este valor sem redeploy.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: describeError(e, "Não foi possível salvar a credencial no cofre."),
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-24 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando integrações...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> Integrações
        </h1>
        <p className="text-xs text-muted-foreground">
          As chaves ficam em <code>private.integration_credentials</code>, num schema que
          a API REST não expõe. O valor nunca volta para a tela — só o estado.
        </p>
      </div>

      <Tabs defaultValue="secrets">
        <TabsList>
          <TabsTrigger value="secrets" className="text-xs">Credenciais</TabsTrigger>
          <TabsTrigger value="cron" className="text-xs">Saúde dos jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="secrets" className="space-y-3 mt-4">
          {INTEGRATION_SLOTS.map((slot) => {
            const k = slotKey(slot.provider, slot.label);
            const current = storedByKey.get(k);
            const configured = !!current?.has_secret;
            return (
              <Card key={k} className="border-border/50">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <ShieldCheck className={configured ? "h-4 w-4 text-success" : "h-4 w-4 text-muted-foreground"} />
                      {slot.title}
                    </span>
                    <Badge variant={configured ? "default" : "outline"}>
                      {configured ? "no cofre" : `usando secret ${slot.envName}`}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {slot.help} <span className="opacity-70">· lida por <code>{slot.usedBy}</code></span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      aria-label={slot.title}
                      placeholder={configured ? "Digite para substituir" : "Colar credencial"}
                      value={drafts[k] ?? ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                      disabled={!isAdmin}
                      className="h-9 font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      onClick={() => save(slot.provider, slot.label)}
                      disabled={!isAdmin || saving === k || !(drafts[k] ?? "").trim()}
                    >
                      {saving === k ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Última atualização: {formatDate(current?.updated_at ?? null)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="cron" className="space-y-3 mt-4">
          {jobs.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="p-4 text-xs text-muted-foreground">
                Nenhum job visível. Em produção, espera-se três linhas
                <code> faceimob-*</code>. Lista vazia também aparece para quem não é
                administrador.
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50">
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-muted-foreground">
                      <th className="p-2 text-left font-medium">Job</th>
                      <th className="p-2 text-left font-medium">Cadência</th>
                      <th className="p-2 text-center font-medium">Ativo</th>
                      <th className="p-2 text-left font-medium">Última execução</th>
                      <th className="p-2 text-center font-medium">Falhas 24h</th>
                      <th className="p-2 text-center font-medium">Execuções 24h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.job_name} className="border-b border-border/10">
                        <td className="p-2 font-medium flex items-center gap-1">
                          {j.active && j.failures_24h === 0
                            ? <CheckCircle2 className="h-3 w-3 text-success" />
                            : <AlertTriangle className="h-3 w-3 text-warning" />}
                          {j.job_name}
                        </td>
                        <td className="p-2 font-mono">{j.schedule}</td>
                        <td className="p-2 text-center">{j.active ? "sim" : "não"}</td>
                        <td className="p-2">{formatDate(j.last_run_at)} <span className="text-muted-foreground">{j.last_status ?? ""}</span></td>
                        <td className={`p-2 text-center ${j.failures_24h > 0 ? "text-destructive font-semibold" : ""}`}>{j.failures_24h}</td>
                        <td className="p-2 text-center">{j.runs_24h}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Sem estes jobs a roleta não gira: a trava de 5 minutos nunca libera o lead.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
