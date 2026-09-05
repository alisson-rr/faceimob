import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from "@/components/shared";
import {
  AlertTriangle, Check, Copy, ExternalLink, Facebook, KeyRound, Loader2, Plug, ShieldAlert, ShieldCheck, Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { listIntegrations, setIntegrationSecret, type IntegrationRecord } from "@/integrations/supabase/integrations";
import { INTEGRATION_SLOTS, slotKey, validarCredencial, type IntegrationSlot } from "@/lib/integrationCatalog";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-ads-webhook`;
/** O SDR só responde no WhatsApp se ESTE webhook também estiver assinado, no
 *  mesmo app da Meta, no campo `messages`. Faltava no passo a passo. */
const INBOUND_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-inbound-webhook`;
const META_SLOTS = INTEGRATION_SLOTS.filter((s) => s.provider === "meta");
const VERIFY_LABEL = "webhook_verify_token";
/**
 * O que o `meta-ads-webhook` precisa para validar o handshake e completar o
 * lead. As chaves de WhatsApp são de outra function e não travam o webhook.
 */
const REQUIRED_FOR_WEBHOOK = new Set(["page_access_token", VERIFY_LABEL]);
const QUERY_KEY = ["integrations"];

/**
 * 32 bytes do `crypto` em base64url (43 caracteres, sem `+ / =`): a Meta manda
 * o valor de volta em `hub.verify_token` na query string, e assim ele não
 * precisa de escape em lugar nenhum.
 */
function generateVerifyToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function CopyField({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar", { description: "Selecione o campo e copie manualmente." });
    }
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" />
        <Button variant="outline" size="icon" onClick={onCopy} aria-label={`Copiar ${label}`}>
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {hint}
    </div>
  );
}

/**
 * Campo de credencial no lugar onde ela é pedida.
 *
 * O passo a passo desta tela cita `page_access_token` e `app_secret` e mandava
 * o admin para /admin/integrations no meio do fluxo — sai da tela, cola a
 * chave, volta e reencontra o passo. Aqui é o MESMO caminho de gravação
 * (`set_integration_secret`) e a MESMA validação de formato do catálogo, então
 * não há uma segunda fonte de verdade: só o formulário está perto do texto que
 * explica de onde a chave vem.
 */
function SecretField({ slot, configured, podeGravar, onSaved }: {
  slot: IntegrationSlot;
  configured: boolean;
  /** `settings.integrations`: o mesmo código que guarda `set_integration_secret`
   *  no banco. Sem ele, gravar volta 42501 — o campo tem de nascer desabilitado
   *  em vez de oferecer um "Salvar" que o banco recusa. */
  podeGravar: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const id = useId();
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    const secret = valor.trim();
    const problema = validarCredencial(slot.formato, secret);
    if (problema) return toast.error("Valor não confere com o campo", { description: problema });
    setSalvando(true);
    try {
      await setIntegrationSecret(slot.provider, slot.label, secret);
      // O valor não volta do servidor e não pode ficar na tela depois de salvo.
      setValor("");
      await onSaved();
      toast.success("Credencial salva no cofre", { description: "As functions passam a usar este valor sem redeploy." });
    } catch (e) {
      toast.error("Não foi possível salvar", { description: describeError(e, "Falha ao gravar no cofre.") });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex gap-2 pt-1">
      <Label htmlFor={id} className="sr-only">{slot.title}</Label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        disabled={!podeGravar}
        placeholder={podeGravar ? (configured ? "Digite para substituir" : "Colar credencial") : "Sem permissão para gravar"}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="h-9 font-mono text-xs"
      />
      <Button size="sm" disabled={!podeGravar || salvando || !valor.trim()} onClick={salvar}>
        {salvando ? <><Loader2 className="animate-spin" aria-hidden /> Salvando…</> : "Salvar"}
        <span className="sr-only"> {slot.title}</span>
      </Button>
    </div>
  );
}

// Sem número no título: o círculo ao lado já numera.
const STEPS = [
  {
    t: "Acesse o Meta for Developers",
    d: "Entre em developers.facebook.com, crie (ou selecione) um App do tipo Business.",
    link: "https://developers.facebook.com/apps/",
  },
  {
    t: "Adicione o produto Webhooks",
    d: "No painel do App → 'Adicionar produto' → Webhooks. Selecione o objeto 'Page'.",
  },
  {
    t: "Configure o Callback",
    d: "Cole a Callback URL e o Verify Token gerado acima. Clique em 'Verificar e Salvar' — a Meta só aceita se o token do cofre for o mesmo.",
  },
  {
    t: "Assine o campo leadgen",
    d: "Na lista de campos da Page, marque 'leadgen' e clique em Subscribe.",
  },
  {
    t: "Assine também o campo messages (SDR por WhatsApp)",
    d: "No produto WhatsApp → Configuração, aponte o Callback de mensagens para a URL do whatsapp-inbound-webhook "
      + "(abaixo), com o MESMO Verify Token, e marque o campo 'messages'. Sem isso o robô recebe o lead mas nunca "
      + "enxerga a resposta dele.",
  },
  {
    t: "Conecte sua Página do Facebook",
    d: "No produto 'Marketing API' → Ferramentas → Lead Ads Testing, associe sua Página e envie um lead de teste.",
    link: "https://developers.facebook.com/tools/lead-ads-testing",
  },
  {
    t: "Valide no CRM",
    d: "O lead aparecerá em Pipeline → aba Leads e no Dashboard → aba Leads em segundos.",
  },
];

export default function MetaAdsSetup() {
  const queryClient = useQueryClient();
  // A rota é gateada por `menu.admin_lead_automation`; o cofre guarda por
  // `settings.integrations` (migration 0044). São códigos diferentes: quem tem
  // só o do menu abre esta tela e leva 42501 em `list_integrations` e em
  // `set_integration_secret`. Mesma regra da tela irmã (Admin · Integrações) —
  // `can()` já embute o admin.
  const { can } = useAuth();
  const podeGravar = can("settings.integrations");
  const integrations = useQuery({ queryKey: QUERY_KEY, queryFn: listIntegrations });
  // Só existe nesta sessão: o cofre grava e nunca devolve o valor.
  const [issued, setIssued] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Resultado do teste de alcance da Callback URL, nesta sessão.
  const [probe, setProbe] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [probing, setProbing] = useState(false);

  const issue = useMutation({
    mutationFn: async () => {
      const token = generateVerifyToken();
      await setIntegrationSecret("meta", VERIFY_LABEL, token);
      return token;
    },
    onSuccess: async (token) => {
      setIssued(token);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Verify Token salvo no cofre", { description: "Copie agora e cole no painel da Meta." });
    },
    onError: (e) => {
      toast.error("Não foi possível salvar o Verify Token", {
        description: describeError(e, "Falha ao gravar no cofre."),
      });
    },
  });

  /**
   * "Testar Callback URL": faz o mesmo handshake GET que a Meta faz.
   *
   * Com o token recém-gerado nesta sessão, o teste é de ponta a ponta — 200 com
   * o desafio ecoado prova que a function lê o cofre. Sem ele (o cofre nunca
   * devolve o valor), o teste ainda vale: 403 prova que a URL está no ar e
   * recusando token errado, que é o esperado.
   */
  const testarCallback = async () => {
    setProbing(true);
    setProbe(null);
    const desafio = crypto.randomUUID().slice(0, 12);
    const url = `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(issued ?? "token-de-teste")}`
      + `&hub.challenge=${desafio}`;
    try {
      const res = await fetch(url);
      const corpo = (await res.text()).trim();
      if (res.ok && corpo === desafio) {
        setProbe({ tone: "success", text: "A Meta consegue verificar: a URL respondeu ao handshake com o Verify Token do cofre." });
      } else if (res.status === 403) {
        setProbe({
          tone: issued ? "danger" : "warning",
          text: issued
            ? "A URL está no ar, mas recusou o token recém-gerado. Aguarde um minuto (instâncias já aquecidas guardam o valor antigo) e teste de novo."
            : "A URL está no ar e recusou um token de teste — é o comportamento correto. O valor real só pode ser conferido pelo painel da Meta, porque o cofre não devolve o que gravou.",
        });
      } else {
        setProbe({ tone: "danger", text: `A URL respondeu ${res.status}. A function pode não estar publicada.` });
      }
    } catch (e) {
      setProbe({ tone: "danger", text: `Não consegui alcançar a URL: ${e instanceof Error ? e.message : "falha de rede"}.` });
    } finally {
      setProbing(false);
    }
  };

  const stored = new Map((integrations.data ?? []).map((r) => [slotKey(r.provider, r.label), r]));
  const record = (label: string): IntegrationRecord | undefined => stored.get(slotKey("meta", label));
  const configured = (label: string) => !!record(label)?.has_secret;
  const missing = META_SLOTS.filter((s) => REQUIRED_FOR_WEBHOOK.has(s.label) && !configured(s.label));
  // `data` e não `isSuccess`: se a releitura após gravar falhar, o status vira
  // "error" com os dados antigos mantidos — e o token recém-gerado, que só
  // existe nesta sessão, precisa continuar na tela até o admin copiar.
  const loaded = integrations.data !== undefined;
  const ready = loaded && missing.length === 0;
  const verify = record(VERIFY_LABEL);

  // Recusa por permissão não ganha "Tentar de novo": o mesmo perfil devolve o
  // mesmo 42501 para sempre. `dbError` guarda o erro original em `.db`.
  const negado = (integrations.error as { db?: { code?: string } } | null)?.db?.code === "42501";

  const badge = integrations.isError
    ? <StatusBadge tone="danger" icon={AlertTriangle}>Cofre indisponível</StatusBadge>
    : loaded
      ? ready
        ? <StatusBadge tone="success" icon={ShieldCheck}>Webhook pronto</StatusBadge>
        : <StatusBadge tone="warning" icon={AlertTriangle}>Falta credencial</StatusBadge>
      : <StatusBadge tone="neutral">Verificando cofre…</StatusBadge>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Configuração do Meta Ads"
        eyebrow="Administração"
        icon={Facebook}
        description="Conecte seus formulários de Lead Ads para receber leads em tempo real no CRM."
        actions={badge}
      />

      {integrations.isPending && <LoadingState variant="list" rows={3} label="Carregando credenciais…" />}

      {integrations.isLoadingError && (
        negado || !podeGravar ? (
          <EmptyState
            icon={ShieldAlert}
            title="Sem permissão para gerenciar integrações"
            description={
              <>
                Seu perfil abre esta tela pelo menu, mas o cofre exige a permissão
                {" "}&quot;Gerenciar integrações&quot;. Peça a um administrador em
                {" "}<strong>Admin · Permissões</strong>.
              </>
            }
          />
        ) : (
          <EmptyState
            tone="danger"
            icon={AlertTriangle}
            title="Não consegui ler o cofre"
            description={describeError(integrations.error, "Não foi possível consultar as credenciais da integração.")}
            // Sem `disabled`/spinner: sem dados, o refetch volta o status a "pending" e
            // o esqueleto acima substitui este bloco — o botão some antes de um 2º clique.
            action={<Button onClick={() => void integrations.refetch()}>Tentar de novo</Button>}
          />
        )
      )}

      {loaded && (
        <>
          {!podeGravar && (
            // O cofre foi lido, então o banco liberou a LEITURA — e `can()` não
            // libera a escrita. Campo desabilitado sem explicação parece tela
            // quebrada; a frase é a mesma de Admin · Integrações.
            <p role="status" className="text-xs text-warning">
              Sem a permissão &quot;Gerenciar integrações&quot;: dá para ver o estado do cofre e copiar as URLs, não
              para gravar credencial nem gerar o Verify Token.
            </p>
          )}
          {!ready && (
            <div role="status" className="rounded-2xl border border-warning/25 bg-warning/10 px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> O webhook ainda não valida
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Falta no cofre: {missing.map((s) => s.title).join(" · ")}. O Verify Token é gerado nesta tela; as
                demais têm campo próprio em “Credenciais da Meta no cofre”, logo abaixo — não é preciso sair daqui.
              </p>
            </div>
          )}

          <SectionCard
            title="Credenciais do Webhook"
            icon={Webhook}
            description="O que vai no painel da Meta, em Webhooks → Page → Callback."
          >
            <div className="space-y-5">
              <CopyField
                label="Callback URL"
                value={WEBHOOK_URL}
                hint={
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={testarCallback} disabled={probing}>
                      {probing ? <><Loader2 className="animate-spin" aria-hidden /> Testando…</> : "Testar Callback URL"}
                    </Button>
                    {probe && (
                      <span
                        role="status"
                        className={`text-xs ${probe.tone === "success" ? "text-success" : probe.tone === "warning" ? "text-warning" : "text-destructive"}`}
                      >
                        {probe.text}
                      </span>
                    )}
                  </div>
                }
              />

              <CopyField
                label="Callback URL (mensagens do WhatsApp)"
                value={INBOUND_URL}
                hint={
                  <p className="text-xs text-muted-foreground">
                    Assine esta URL no campo <code>messages</code> do app do WhatsApp, com o mesmo Verify Token. É por
                    ela que a resposta do lead chega ao agente de IA.
                  </p>
                }
              />

              {issued ? (
                <CopyField
                  label="Verify Token"
                  value={issued}
                  hint={
                    <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Copie agora: ele não será mostrado de novo.
                    </p>
                  }
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verify Token</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {verify?.has_secret ? (
                      <>
                        <StatusBadge tone="success" icon={Check}>Configurado</StatusBadge>
                        <span className="text-xs text-muted-foreground">definido em {dateTime(verify.updated_at)}</span>
                      </>
                    ) : (
                      <StatusBadge tone="warning">Não configurado</StatusBadge>
                    )}
                    <Button
                      size="sm"
                      variant={verify?.has_secret ? "outline" : "default"}
                      disabled={!podeGravar || issue.isPending}
                      onClick={() => (verify?.has_secret ? setConfirmOpen(true) : issue.mutate())}
                    >
                      {issue.isPending
                        ? <><Loader2 className="animate-spin" aria-hidden /> Salvando…</>
                        : verify?.has_secret ? "Gerar novo" : "Gerar e salvar"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    O cofre não devolve o valor gravado. Se o token se perdeu, gere outro e cole de novo no painel da Meta.
                  </p>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Credenciais da Meta no cofre"
            icon={KeyRound}
            description="Só o estado aparece aqui — o valor nunca volta para a tela."
            footer={
              <>
                O mesmo cofre aparece, com teste de conexão e revogação, em{" "}
                <Link to="/admin/integrations" className="font-medium text-primary hover:underline">Admin → Integrações</Link>.
              </>
            }
          >
            <ul className="divide-y divide-border">
              {META_SLOTS.map((slot) => {
                const ok = configured(slot.label);
                const required = REQUIRED_FOR_WEBHOOK.has(slot.label);
                return (
                  <li key={slot.label} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {slot.title}
                          {required && <span className="ml-2 text-xs text-muted-foreground">necessário para o webhook</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{slot.help}</p>
                      </div>
                      <StatusBadge tone={ok ? "success" : required ? "warning" : "neutral"} icon={ok ? Check : undefined}>
                        {ok ? "Configurado" : "Não configurado"}
                      </StatusBadge>
                    </div>
                    {/* O Verify Token tem gerador próprio acima: um campo de
                        colagem aqui convidaria a inventar um valor à mão e a
                        perder o que a tela já gerou. */}
                    {slot.label !== VERIFY_LABEL && (
                      <SecretField
                        slot={slot}
                        configured={ok}
                        podeGravar={podeGravar}
                        onSaved={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </>
      )}

      <SectionCard title="Passo a passo">
        <div className="space-y-3 text-sm">
          {STEPS.map((s, i) => (
            <div key={s.t} className="flex gap-3 rounded-xl border border-border p-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                {i + 1}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{s.t}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.d}</p>
                {s.link && (
                  <a
                    href={s.link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Abrir <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Escrito na tela porque a ausência silenciosa vira expectativa: a ata
          pede gestão de campanha (orçamento, pausar, duplicar anúncio) e esta
          tela faz só o RECEBIMENTO de leads. Decisão de 02/09/2026 — a própria
          ata registra que a verificação de empresa de imóveis impede automação
          total, e entregar meio caminho gera promessa que a Meta não deixa
          cumprir. */}
      <SectionCard title="O que esta tela não faz" icon={AlertTriangle}>
        <p className="text-sm text-muted-foreground">
          Aqui se configura o <b>recebimento</b> de leads do Lead Ads. Gerenciar campanha pela Meta — orçamento,
          pausar, copiar ou duplicar anúncio — <b>não</b> está nesta entrega e continua no Gerenciador de Anúncios da
          Meta. O motivo: a verificação de empresa exigida para o setor imobiliário limita o que a API permite
          automatizar, e um painel pela metade prometeria controle que a Meta não entrega.
        </p>
      </SectionCard>

      <SectionCard title="Formato esperado (fallback direto)" icon={Plug}>
        <p className="mb-2 text-xs text-muted-foreground">
          Se preferir enviar leads via POST direto (Zapier, Make, N8N), use a mesma URL com este JSON:
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
          Este caminho é <b>público de propósito</b> — é a entrada de formulário de site. Por isso o lead recebido
          assim vai sempre para a roleta, mesmo que a origem tenha agente de IA: sem prova de quem enviou, um POST
          com <code>{"{name, phone, source}"}</code> faria o WhatsApp da empresa disparar template para um número
          escolhido por quem chamou e abriria conversa que consome crédito da OpenAI. A resposta traz
          <code> origem_verificada: false</code> nesses casos. Para o lead entrar na IA, o evento precisa vir
          assinado pela Meta (<b>app secret</b> cadastrado em Integrações) — a integração oficial do Lead Ads.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border bg-muted p-3 font-mono text-xs text-muted-foreground">
{`POST ${WEBHOOK_URL}
Content-Type: application/json

{
  "name": "João Silva",
  "phone": "51999999999",
  "email": "joao@email.com",
  "source": "Meta Ads"
}`}
        </pre>
      </SectionCard>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar um novo Verify Token?</AlertDialogTitle>
            <AlertDialogDescription>
              A assinatura já feita continua entregando leads, mas qualquer nova verificação no painel da Meta só
              passa com o valor novo — copie e cole lá em seguida. O token antigo pode continuar valendo por alguns
              minutos nas instâncias já aquecidas; se a Meta recusar logo após a troca, aguarde e verifique de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => issue.mutate()}>Gerar novo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
