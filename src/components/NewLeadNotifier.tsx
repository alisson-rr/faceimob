import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BellRing, ExternalLink, HandMetal, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";
import { claimLead, formatCountdown } from "@/integrations/supabase/leads";
import { useCelebration } from "@/components/engagement/context";

/** Só o que o payload do realtime entrega — não é o `LeadRecord` decorado. */
type IncomingLead = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  attend_deadline: string | null;
  campaign_name: string | null;
  utm_source: string | null;
  form_id: string | null;
  created_at: string | null;
  distribution_group_id: string | null;
};

const GESTOR_ROLES = ["admin", "director", "manager", "marketing"];

/**
 * Quem ouve a fila inteira; os demais gestores, só os grupos deles. O diretor
 * saiu na 0141: a `leads_select` passou a entregar a ele só a fila geral e a
 * dos grupos da hierarquia, e o aviso não pode anunciar lead que ele não abre.
 */
const FILA_INTEIRA_ROLES = ["admin"];

/** Janela em que a mudança ainda é "acabou de acontecer". */
const FRESH_MS = 20_000;

/**
 * Idade do fato medida com o relógio do servidor.
 *
 * `commit_timestamp` é a hora do commit no Postgres e `assigned_at`/`created_at`
 * saem do mesmo relógio, então a comparação não depende da hora da máquina do
 * corretor — antes um micro em atraso deixava de anunciar leads legítimos e um
 * adiantado anunciava atribuição antiga.
 */
const isFresh = (iso: string | null | undefined, commitTimestamp?: string) => {
  if (!iso) return false;
  const reference = commitTimestamp ? new Date(commitTimestamp).getTime() : Date.now();
  if (!Number.isFinite(reference)) return false;
  return reference - new Date(iso).getTime() < FRESH_MS;
};

/**
 * Aviso global de lead (ata 23/07: "notificação independente de onde o corretor
 * esteja no sistema"). Duas situações:
 *
 *   · corretor — a roleta atribuiu um lead a ele: popup, som e o cronômetro da
 *     trava, com o botão "Atender" ali mesmo;
 *   · gestor — chegou lead novo na fila dos grupos dele.
 */
export default function NewLeadNotifier() {
  const { user, role, can } = useAuth();
  const profileId = user?.id || null;
  /**
   * Marketing está em `GESTOR_ROLES` (quem paga a campanha quer saber que ela
   * gerou lead), mas a matriz não dá `menu.leads` a esse papel: o botão "Abrir
   * leads" levava direto ao "Acesso não liberado" do guard de rota. Ou o botão
   * some, ou o banco passa a permitir — conceder a tela é decisão de produto,
   * então aqui o aviso chega sem a promessa que não se cumpre.
   */
  const podeAbrirLeads = can("menu.leads");
  const isGestor = GESTOR_ROLES.includes(role);
  const veFilaInteira = FILA_INTEIRA_ROLES.includes(role);
  const celebrate = useCelebration();

  const [lead, setLead] = useState<IncomingLead | null>(null);
  const [kind, setKind] = useState<"assigned" | "queued">("assigned");
  const [now, setNow] = useState(() => Date.now());
  const [claiming, setClaiming] = useState(false);
  const navigate = useNavigate();
  // Evita repetir o mesmo aviso quando o lead sofre outros UPDATEs na sequência.
  const notified = useRef<Set<string>>(new Set());
  // Grupos de distribuição em que a equipe visível do gestor está inscrita.
  const meusGrupos = useRef<Set<string> | null>(null);

  /**
   * DIÁLOGO SÓ PARA O QUE TEM PRAZO.
   *
   * Os dois avisos tinham o mesmo peso: qualquer um abria um `Dialog` modal.
   * Só que eles não são a mesma coisa.
   *
   *  · `assigned` — a roleta travou o lead com ESTE corretor e há um cronômetro
   *    correndo até ele voltar para a fila. Interromper é o certo: há uma ação
   *    ("Atender agora") que perde a validade sozinha.
   *  · `queued` — entrou lead na fila. O diálogo oferecia "Depois" e "Abrir
   *    leads", ou seja, nada que não coubesse num aviso.
   *
   * O custo do modal para o caso informativo é alto e foi medido: enquanto ele
   * está aberto o Radix marca TODO o resto da página com `aria-hidden`, então
   * quem usa leitor de tela perde a tela inteira por causa de um comunicado —
   * e o Playwright, pelo mesmo motivo, para de achar qualquer papel ARIA. Foi
   * assim que o teste de cadastro de lead quebrava de forma intermitente.
   *
   * Havia ainda o absurdo do dia a dia: o admin que acabava de digitar um lead
   * pela tela recebia um modal anunciando a chegada do lead que ele mesmo
   * cadastrou. `leads` não tem coluna de autor, então não dá para reconhecê-lo
   * pela linha — mas com o aviso em toast o problema deixa de existir.
   */
  const announce = useCallback((row: IncomingLead, nextKind: "assigned" | "queued") => {
    const key = `${nextKind}:${row.id}:${row.assigned_at || row.created_at || ""}`;
    if (notified.current.has(key)) return;
    notified.current.add(key);

    if (nextKind === "assigned") {
      setLead(row);
      setKind(nextKind);
    }
    celebrate("lead_new");
    toast({
      title: nextKind === "assigned" ? "🔔 Lead atribuído a você!" : "🔔 Novo lead na fila",
      description: `${row.full_name || "Sem nome"} — ${row.campaign_name || row.utm_source || "origem —"}`,
      // O destino que o diálogo oferecia, sem o diálogo. Só quando a pessoa
      // pode mesmo abrir a tela: `menu.leads` não é dado ao marketing, e o
      // botão levava direto ao "Acesso não liberado" do guard de rota.
      action: nextKind === "queued" && podeAbrirLeads
        ? { label: "Abrir leads", onClick: () => navigate("/leads") }
        : undefined,
    });
  }, [celebrate, navigate, podeAbrirLeads]);

  /**
   * Carrega os grupos do gestor uma vez. `profiles` já é filtrada pelo RLS
   * (`auth_visible_profiles`), então a lista que volta é exatamente a equipe
   * dele — sem ela, o gerente recebia popup de todo lead da casa.
   */
  useEffect(() => {
    if (!isGestor || veFilaInteira) return;
    let cancelado = false;
    void (async () => {
      const { data: visiveis } = await supabase.from("profiles").select("id");
      const ids = (visiveis ?? []).map((row) => row.id);
      if (!ids.length) { if (!cancelado) meusGrupos.current = new Set(); return; }
      const { data: membros } = await supabase
        .from("distribution_group_members")
        .select("group_id")
        .in("profile_id", ids)
        .eq("active", true);
      if (!cancelado) meusGrupos.current = new Set((membros ?? []).map((row) => row.group_id));
    })();
    return () => { cancelado = true; };
  }, [isGestor, veFilaInteira]);

  useEffect(() => {
    if (!profileId) return;

    const channel = supabase.channel(`lead-alerts-${profileId}`);

    // Atribuição pela roleta. `payload.old` só traz a PK (replica identity
    // default), então não há como comparar o status anterior: o corte é
    // "atribuído a mim, aguardando atendimento e recém-atribuído".
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "leads", filter: `assigned_to=eq.${profileId}` },
      (payload) => {
        const row = payload.new as IncomingLead;
        if (row?.status !== "assigned") return;
        if (!isFresh(row.assigned_at, payload.commit_timestamp)) return;
        announce(row, "assigned");
      },
    );

    // Um lead pode ser criado já com corretor (realocação/importação dirigida):
    // o INSERT também precisa avisar o dono.
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "leads", filter: `assigned_to=eq.${profileId}` },
      (payload) => {
        const row = payload.new as IncomingLead;
        if (row?.status !== "assigned") return;
        announce(row, "assigned");
      },
    );

    if (isGestor) {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads" },
        (payload) => {
          const row = payload.new as IncomingLead;
          if (row?.assigned_to) return; // já tem dono: o aviso é dele
          if (!isFresh(row.created_at, payload.commit_timestamp)) return;
          // Fila geral (sem grupo) é de todo mundo; fila específica é só de
          // quem tem gente no grupo. Enquanto os grupos não carregaram, o
          // gestor só recebe o que é da fila geral.
          if (!veFilaInteira && row.distribution_group_id) {
            if (!meusGrupos.current?.has(row.distribution_group_id)) return;
          }
          announce(row, "queued");
        },
      );
    }

    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profileId, isGestor, veFilaInteira, announce]);

  useEffect(() => {
    if (!lead) return;
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [lead]);

  const secondsLeft = lead?.attend_deadline
    ? Math.max(0, Math.ceil((new Date(lead.attend_deadline).getTime() - now) / 1000))
    : null;

  const attend = async () => {
    if (!lead) return;
    setClaiming(true);
    try {
      await claimLead(lead.id);
      setLead(null);
      // O toast e o som saem da comemoração de `lead_claimed`, disparada pelo
      // realtime de `lead_events` no EngagementLayer. Sem `menu.leads` o
      // destino é a home do papel ("/" resolve em `HomeRedirect`), não uma tela
      // que o guard nega logo depois de o atendimento ter dado certo.
      navigate(podeAbrirLeads ? "/leads" : "/");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível atender",
        description: describeError(err, "o lead pode ter voltado à fila ou outro corretor assumiu antes"),
      });
      setLead(null);
    } finally {
      setClaiming(false);
    }
  };

  const assigned = kind === "assigned";

  return (
    <Dialog open={!!lead} onOpenChange={(v) => !v && setLead(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary animate-pulse" />
            {assigned ? "Lead atribuído a você!" : "Novo lead na fila"}
          </DialogTitle>
          <DialogDescription>
            {assigned
              ? "Clique em Atender para travar o lead com você e parar o cronômetro."
              : "Um lead novo entrou na fila de distribuição."}
          </DialogDescription>
        </DialogHeader>
        {lead && (
          <div className="space-y-2 py-2">
            <p className="text-lg font-semibold">{lead.full_name || "Sem nome"}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {(lead.campaign_name || lead.utm_source) && (
                <Badge variant="outline">{lead.campaign_name || lead.utm_source}</Badge>
              )}
              {lead.form_id && <Badge variant="outline">📋 {lead.form_id}</Badge>}
              {lead.phone && <Badge variant="outline">{lead.phone}</Badge>}
            </div>
            {/* Cronômetro neutro até o último minuto: âmbar é o botão "Atender
                agora", e a mesma cor no relógio passava a significar duas
                coisas no mesmo diálogo. No fim ele fica vermelho. */}
            {assigned && secondsLeft !== null && (
              <p className={cn(
                "text-sm font-semibold flex items-center gap-1",
                secondsLeft <= 60 ? "text-destructive" : "text-foreground",
              )}>
                <Timer className="h-4 w-4" />
                {secondsLeft > 0
                  ? `${formatCountdown(secondsLeft)} para atender antes de voltar à fila`
                  : "Prazo estourado — o lead está voltando para a fila"}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setLead(null)}>Depois</Button>
          {assigned ? (
            <Button variant="highlight" onClick={attend} disabled={claiming || secondsLeft === 0}>
              <HandMetal className="h-4 w-4 mr-1" /> {claiming ? "Atendendo..." : "Atender agora"}
            </Button>
          ) : podeAbrirLeads ? (
            <Button onClick={() => { setLead(null); navigate("/leads"); }}>
              <ExternalLink className="h-4 w-4 mr-1" /> Abrir leads
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
