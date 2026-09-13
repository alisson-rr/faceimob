import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BellRing, Loader2, RotateCcw, Send } from "lucide-react";
import { SectionCard } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import {
  PUSH_CATEGORIES,
  confirmPushSubscription,
  describePushError,
  disablePush,
  enablePush,
  getPushStatus,
  isCategoryOn,
  savePushPreference,
  type PushCategory,
  type PushStatus,
} from "@/lib/push";
import { listMyPushPreferences, sendTestPush } from "@/integrations/supabase/push";

/** O que este aparelho está fazendo, dito sem jargão. Cada estado diz o próximo passo. */
const STATUS_TEXT: Record<PushStatus, string> = {
  on: "Ligado neste aparelho. Os avisos chegam mesmo com o Faceimob fechado.",
  off: "Desligado neste aparelho.",
  local_on:
    "Ligado enquanto o Faceimob estiver aberto, mesmo minimizado. Com ele fechado, os avisos esperam no sino.",
  local_off:
    "Este aplicativo não recebe avisos com ele fechado. Ative para ver avisos do sistema enquanto ele estiver aberto em segundo plano.",
  blocked:
    "Os avisos estão bloqueados para este site. Libere no navegador (ícone ao lado do endereço → Notificações → Permitir) e recarregue a página.",
  ios_install:
    "No iPhone e no iPad, os avisos só funcionam com o Faceimob instalado: no Safari, toque em Compartilhar → Adicionar à Tela de Início, abra pelo ícone novo e ative aqui. Precisa do iOS 16.4 ou mais novo.",
  unsupported:
    "Este navegador não recebe avisos. Use Chrome, Edge, Firefox ou Safari atualizados; no iPhone, iOS 16.4 ou mais novo com o app instalado na Tela de Início.",
};

/**
 * Avisos no celular e no computador (push).
 *
 * Duas coisas diferentes, e a tela separa: ligar/desligar vale para ESTE
 * aparelho (a assinatura é do navegador), e as categorias valem para a conta
 * inteira (`push_preferences`). Quem entra por `#avisos` — atalho do sino — cai
 * direto nesta seção.
 */
export default function PushSettings() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const secaoRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Map<PushCategory, boolean> | null>(null);
  const [prefsErro, setPrefsErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<PushCategory | null>(null);
  const [testando, setTestando] = useState(false);
  // "Ligado" sai da assinatura do navegador, que o logout mantém; a linha no
  // servidor volta pela ressincronização do login, que falha em silêncio. Sem
  // confirmar aqui, a tela prometeria aviso que não chega.
  const [semRegistro, setSemRegistro] = useState<string | null>(null);

  const lerStatus = useCallback(async () => {
    let atual: PushStatus;
    try {
      atual = await getPushStatus();
      setStatus(atual);
    } catch (err) {
      setStatus("off");
      setErro(describePushError(err, "Não foi possível ler o estado dos avisos neste aparelho."));
      return;
    }
    if (atual !== "on") return;
    try {
      await confirmPushSubscription();
      setSemRegistro(null);
    } catch (err) {
      setSemRegistro(describePushError(err, "O servidor não confirmou o registro deste aparelho."));
    }
  }, []);

  const lerPreferencias = useCallback(async () => {
    setPrefsErro(null);
    try {
      const rows = await listMyPushPreferences();
      setPrefs(new Map(rows.map((row) => [row.category, row.enabled])));
    } catch (err) {
      // Sem isto os interruptores apareceriam no padrão — uma afirmação falsa
      // para quem já tinha desligado alguma categoria.
      setPrefsErro(describeError(err, "Não foi possível carregar o que você escolheu receber."));
    }
  }, []);

  useEffect(() => { void lerStatus(); }, [lerStatus]);
  useEffect(() => { if (user?.id) void lerPreferencias(); }, [user?.id, lerPreferencias]);

  useEffect(() => {
    if (hash === "#avisos") secaoRef.current?.scrollIntoView({ block: "start" });
  }, [hash]);

  const ativar = async () => {
    setBusy(true);
    setErro(null);
    setSemRegistro(null);
    try {
      const next = await enablePush();
      setStatus(next);
      if (next === "on" || next === "local_on") {
        toast({ title: "Avisos ativados neste aparelho", description: "Use “Enviar teste” para ver como eles chegam." });
      }
    } catch (err) {
      setErro(describePushError(err, "Não foi possível ativar os avisos. Tente de novo."));
      await lerStatus();
    } finally {
      setBusy(false);
    }
  };

  const desativar = async () => {
    setBusy(true);
    setErro(null);
    try {
      setStatus(await disablePush());
    } catch (err) {
      setErro(describePushError(err, "Não foi possível desligar os avisos. Tente de novo."));
      await lerStatus();
    } finally {
      setBusy(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    try {
      await sendTestPush();
      toast({
        title: "Teste enviado",
        description: "O aviso deve aparecer neste aparelho em alguns segundos. Se não aparecer, confira se o sistema permite notificações do navegador.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível enviar o teste",
        description: describeError(err, "Tente de novo em instantes."),
      });
    } finally {
      setTestando(false);
    }
  };

  const trocar = async (category: PushCategory, enabled: boolean) => {
    if (!user?.id || !prefs) return;
    setSalvando(category);
    try {
      await savePushPreference(user.id, category, enabled);
      setPrefs((atual) => new Map(atual).set(category, enabled));
    } catch (err) {
      // O interruptor só muda depois de o banco confirmar: nada de pintar
      // escolha que não foi gravada.
      toast({
        variant: "destructive",
        title: "Não foi possível salvar",
        description: describeError(err, "A escolha anterior continua valendo. Tente de novo."),
      });
    } finally {
      setSalvando(null);
    }
  };

  const pendente = status === "on" && semRegistro !== null;
  const ligado = (status === "on" && !pendente) || status === "local_on";

  return (
    <div id="avisos" ref={secaoRef} className="scroll-mt-4">
      <SectionCard
        title="Avisos no celular e no computador"
        description="Lead novo e prazo de atendimento avisam mesmo com você fora da tela do Faceimob."
        icon={BellRing}
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" aria-live="polite" className="text-sm">
              {status === null
                ? "Verificando este aparelho..."
                : pendente
                  ? "Este aparelho não está registrado no servidor: os avisos não chegam aqui até o registro dar certo."
                  : STATUS_TEXT[status]}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              {(status === "off" || status === "local_off" || pendente) && (
                <Button onClick={() => void ativar()} disabled={busy} className="gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BellRing className="h-4 w-4" aria-hidden />}
                  {busy ? "Ativando..." : pendente ? "Registrar de novo" : "Ativar neste aparelho"}
                </Button>
              )}
              {status === "on" && (
                <Button variant="outline" onClick={() => void desativar()} disabled={busy}>
                  {busy ? "Desligando..." : "Desativar neste aparelho"}
                </Button>
              )}
              {ligado && (
                <Button variant="outline" onClick={() => void testar()} disabled={testando} className="gap-2">
                  <Send className="h-4 w-4" aria-hidden />
                  {testando ? "Enviando..." : "Enviar teste"}
                </Button>
              )}
            </div>
          </div>

          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          {pendente && <p role="alert" className="text-sm text-destructive">{semRegistro}</p>}

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">O que avisar</legend>
            <p className="text-xs text-muted-foreground">
              Vale para todos os aparelhos em que você ativou.
              {status === "local_on" && " Para silenciar este computador, desligue as categorias."}
            </p>
            {prefsErro ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-sm text-destructive">{prefsErro}</p>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void lerPreferencias()}>
                  <RotateCcw className="h-3 w-3" aria-hidden /> Tentar de novo
                </Button>
              </div>
            ) : !prefs ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Carregando...
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {PUSH_CATEGORIES.map((categoria) => {
                  const id = `push-${categoria.id}`;
                  return (
                    <li key={categoria.id} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <Label htmlFor={id}>{categoria.label}</Label>
                        <p id={`${id}-desc`} className="text-xs text-muted-foreground">{categoria.description}</p>
                      </div>
                      <Switch
                        id={id}
                        aria-describedby={`${id}-desc`}
                        checked={isCategoryOn(prefs, categoria.id)}
                        disabled={salvando !== null}
                        onCheckedChange={(enabled) => void trocar(categoria.id, enabled)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        </div>
      </SectionCard>
    </div>
  );
}
