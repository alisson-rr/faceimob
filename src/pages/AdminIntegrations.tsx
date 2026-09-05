import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KeyRound, Loader2, ShieldCheck, ShieldAlert, Activity, AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState } from "@/components/shared";
import {
  listCronJobsHealth,
  listIntegrations,
  setIntegrationSecret,
  type CronJobHealth,
  type IntegrationRecord,
} from "@/integrations/supabase/integrations";
import {
  INTEGRATION_SLOTS, lerRemetentesDaSonda, slotKey, validarCredencial,
  type IntegrationSlot, type RemetenteBrevo,
} from "@/lib/integrationCatalog";
import { supabase } from "@/integrations/supabase/client";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { functionErrorMessage } from "@/lib/functionError";

/**
 * Nome de secret de edge function (`OPENAI_API_KEY`). O catálogo usa "—" nos
 * slots que só o banco lê (o cron busca direto no cofre): para esses não existe
 * retaguarda de ambiente e a tela não pode prometer uma.
 */
const ENV_FALLBACK = /^[A-Z][A-Z0-9_]*$/;

/**
 * Slots com "testar conexão": a function faz uma leitura pura no provedor com
 * a credencial que ela própria resolve (cofre à frente, `Deno.env` atrás). É a
 * única forma honesta de responder "a chave gravada funciona?" — e também
 * responde "qual valor está em uso", que o cofre sozinho não diz.
 *
 * Os demais slots ficam de fora porque não têm leitura barata e sem efeito:
 * testar o disparo de WhatsApp mandaria mensagem para alguém de verdade, e o
 * verify token do webhook só a Meta consegue provar (tela de Meta Ads).
 */
const PROBES: Record<string, { fn: string; body: Record<string, unknown> }> = {
  "openai::api_key": { fn: "sdr-agent-chat", body: { action: "probe" } },
  "meta::whatsapp_access_token": { fn: "sdr-whatsapp-broadcast", body: { action: "probe" } },
  "meta::whatsapp_phone_number_id": { fn: "sdr-whatsapp-broadcast", body: { action: "probe" } },
  // Leitura de /me na Graph API: prova o token da página sem publicar nada.
  // Era o slot mais caro de errar às cegas — sem ele o `meta-ads-webhook` grava
  // o lead sem nome de formulário nem campanha, e o único sinal é uma linha de
  // log dentro da function.
  "meta::page_access_token": { fn: "sdr-whatsapp-broadcast", body: { action: "probe_page_token" } },
  // Brevo: `/v3/senders` é leitura pura (nenhum e-mail sai) e responde as DUAS
  // perguntas do par — a chave é aceita? o remetente gravado está verificado
  // lá? É a única leitura possível de um valor que o cofre nunca devolve: em
  // 02/09/2026 `brevo/sender_email` guardava a própria chave de API (89
  // caracteres, sem arroba), a tela dizia "no cofre" e nada contradizia.
  // `validarCredencial` barra gravação NOVA; o valor já gravado só a sonda vê.
  "brevo::api_key": { fn: "submission-dispatch", body: { action: "probe" } },
  "brevo::sender_email": { fn: "submission-dispatch", body: { action: "probe" } },
};

/**
 * Slots sem teste possível, e por quê. Sem esta frase, quem olha a tela vê
 * "Testar conexão" em quatro cartões e a ausência dele nos outros parece
 * esquecimento — e o admin fica sem saber que aquele valor só será conferido
 * quando o terceiro recusar, em produção.
 */
const SEM_TESTE: Record<string, string> = {
  "meta::app_secret": "Não há como testar sozinho: ele só é exercitado quando a Meta assina um evento de verdade. O sinal de valor errado é o webhook recusar o POST com 401.",
  "meta::webhook_verify_token": "Quem confere é a Meta, no botão “Verificar e Salvar” do painel. A tela de Admin · Meta Ads gera o token e faz o mesmo handshake.",
  "meta::whatsapp_notify_template": "É o NOME de um template aprovado, não uma chave — quem confere é a Meta, no envio. Sem ele o worker manda texto livre, que a Meta recusa com o código 131047 quando o corretor nunca escreveu para o número da empresa.",
  "voice_ai::webhook_secret": "Segredo compartilhado com a plataforma de voz: só o webhook dela pode provar que confere.",
  "supabase::functions_url": "Lida só pelo pg_cron. A aba “Saúde dos jobs” mostra se as chamadas estão passando.",
  "supabase::service_role_key": "É a chave que o cron manda no header dos workers. A aba “Saúde dos jobs” é o teste: falha de autenticação aparece como execução com erro.",
};

/** Corpo que uma sonda devolve. `remetentes` fica `unknown`: vem da rede e quem
 *  o valida é `lerRemetentesDaSonda`. */
type SondaResposta = {
  ok?: boolean;
  error?: string;
  phone?: string;
  name?: string;
  models?: number;
  remetente?: string;
  remetentes?: unknown;
};

/**
 * Corpo JSON da sonda, venha ela como 2xx ou como recusa.
 *
 * A recusa é 5xx com o motivo NO CORPO — e, no Brevo, com a lista de remetentes
 * que a conta aceita. `supabase.functions.invoke` transforma não-2xx em erro e
 * zera `data`: ler só a mensagem jogava fora justamente a saída que a tela tem
 * a oferecer para "remetente inválido".
 */
const corpoDaSonda = async (data: unknown, error: unknown): Promise<SondaResposta | null> => {
  if (!error) return (data ?? null) as SondaResposta | null;
  try {
    return (await (error as { context?: Response }).context?.clone().json()) ?? null;
  } catch {
    // Resposta sem corpo JSON (rede, 502 do gateway): quem responde é
    // `functionErrorMessage`, com a mensagem do SDK.
    return null;
  }
};

/** Nome legível dos canais de notificação, para a fila represada. */
const CANAL: Record<string, string> = {
  in_app: "No app (sino)",
  email: "E-mail",
  whatsapp: "WhatsApp",
};

type FilaLinha = {
  channel: string;
  pendentes: number;
  com_erro: number;
  mais_antiga: string | null;
  ultimo_erro: string | null;
  max_tentativas: number;
};

/**
 * A RPC entrou na 0082 e ainda não está no `types.ts` gerado (que é regerado
 * por `supabase gen types`, não editado à mão). Mesmo recorte usado em
 * `AdminDailyTeams`/`DailyReport` para RPC nova.
 */
const lerFilaDeNotificacoes = () =>
  (supabase.rpc as unknown as (
    fn: "notification_queue_health",
  ) => Promise<{ data: FilaLinha[] | null; error: { code?: string; message: string } | null }>)(
    "notification_queue_health",
  );

const revogarCredencial = (provider: string, label: string) =>
  (supabase.rpc as unknown as (
    fn: "revoke_integration_secret",
    args: { p_provider: string; p_label: string },
  ) => Promise<{ data: boolean | null; error: { code?: string; message: string } | null }>)(
    "revoke_integration_secret",
    { p_provider: provider, p_label: label },
  );

export default function AdminIntegrations() {
  const { toast } = useToast();
  // Mesma regra do banco: `list_integrations`/`set_integration_secret` guardam
  // por `has_permission('settings.integrations')`, e `can()` já embute o admin.
  // Gatear por `isAdmin` escondia o campo de quem o banco deixaria gravar.
  const { can } = useAuth();
  const podeGravar = can("settings.integrations");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [stored, setStored] = useState<IntegrationRecord[]>([]);
  // Mensagem + causa. A rota é gateada por `menu.admin_integrations`, código
  // DIFERENTE do `settings.integrations` que guarda a RPC: quem tem só o menu
  // entra na tela e `list_integrations()` recusa com 42501. Sem separar a
  // causa, a negação virava "não consegui ler o cofre" com um "Tentar de novo"
  // que nunca ia passar.
  const [cofreErro, setCofreErro] = useState<{ mensagem: string; negado: boolean } | null>(null);
  const [jobs, setJobs] = useState<CronJobHealth[]>([]);
  const [jobsErro, setJobsErro] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [testando, setTestando] = useState<string | null>(null);
  // `remetentes` só o Brevo preenche: é a lista que a conta aceita, e sem ela a
  // recusa "remetente inválido" não tem caminho de saída na tela.
  const [testes, setTestes] = useState<
    Record<string, { ok: boolean; texto: string; remetentes: RemetenteBrevo[] }>
  >({});
  // Credencial em vias de ser revogada. Revogar apaga o valor: precisa de
  // confirmação com o efeito escrito, não de um clique solto ao lado do campo.
  const [revogando, setRevogando] = useState<IntegrationSlot | null>(null);
  const [revogandoAgora, setRevogandoAgora] = useState(false);
  // Fila de notificações represada. A RLS de `notifications` é de dono e só
  // `in_app`: nenhum admin enxergava as mensagens de WhatsApp esperando
  // credencial — 312 delas hoje, e o único jeito de saber era o console do
  // banco. É a prova, na mesma tela, de que a chave que falta ali embaixo é o
  // que trava a fila aqui em cima.
  const [fila, setFila] = useState<FilaLinha[]>([]);
  const [filaErro, setFilaErro] = useState<string | null>(null);
  // Aba controlada: o "Tentar de novo" volta a tela para o estado de
  // carregamento, e sem isso o retry da aba de jobs devolvia o admin para a de
  // credenciais.
  const [tab, setTab] = useState("secrets");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // A saúde do cron é informativa: se falhar, não pode derrubar o cofre —
      // mas o erro vai para a aba dela em vez de virar uma lista vazia.
      const [integrations, health, filaRes] = await Promise.all([
        listIntegrations(),
        listCronJobsHealth().then(
          (rows) => { setJobsErro(null); return rows; },
          (e) => {
            setJobsErro(describeError(e, "Não foi possível ler a saúde dos jobs."));
            return [] as CronJobHealth[];
          },
        ),
        // Informativa como a saúde do cron: falha dela não pode derrubar o
        // cofre, que é o motivo de a pessoa ter aberto a tela.
        lerFilaDeNotificacoes(),
      ]);
      setStored(integrations);
      setJobs(health);
      if (filaRes.error) {
        setFila([]);
        setFilaErro(describeError(filaRes.error, "Não foi possível ler a fila de notificações."));
      } else {
        setFila(filaRes.data ?? []);
        setFilaErro(null);
      }
      setCofreErro(null);
    } catch (e) {
      // Sem a leitura do cofre, todo slot apareceria como "não configurado" —
      // mentira quando a credencial existe e quem falhou foi a consulta.
      setStored([]);
      // `dbError` guarda o erro do Postgres em `.db`; 42501 é a recusa da
      // própria RPC, não uma falha passageira de rede.
      const codigo = (e as { db?: { code?: string | null } })?.db?.code;
      setCofreErro({
        mensagem: describeError(e, "Não foi possível carregar as integrações."),
        negado: codigo === "42501",
      });
    } finally {
      setLoading(false);
    }
  }, []);

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
    // O cofre nunca devolve o valor, então erro de colagem só apareceria no log
    // da function que consome — foi assim que `brevo/sender_email` passou a
    // guardar a chave de API. Validar aqui é a única fronteira que enxerga o
    // que a pessoa digitou.
    const formato = INTEGRATION_SLOTS.find((s) => s.provider === provider && s.label === label)?.formato;
    const problema = validarCredencial(formato, secret);
    if (problema) {
      return toast({ title: "Valor não confere com o campo", description: problema, variant: "destructive" });
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

  /**
   * Revogar: apaga o segredo e desliga a linha (`revoke_integration_secret`,
   * migration 0082). Existia só `set_integration_secret`, então tirar do ar uma
   * chave vazada exigia console do banco — a coluna `active` estava lá e
   * nenhuma RPC a alcançava.
   *
   * `private.get_integration_secret` filtra por `active`, então a próxima
   * leitura de uma function já não encontra o valor. Instância quente pode
   * segurar o valor em cache por alguns minutos: o texto do diálogo diz isso.
   */
  const revogar = async (slot: IntegrationSlot) => {
    setRevogandoAgora(true);
    try {
      const { data, error } = await revogarCredencial(slot.provider, slot.label);
      if (error) throw error;
      // `false` = não havia linha. Dizer "revogada" nesse caso seria inventar
      // um efeito que não houve.
      if (data === false) {
        toast({ title: "Nada a revogar", description: "Esta credencial não estava cadastrada no cofre." });
      } else {
        toast({
          title: "Credencial revogada",
          description: "O valor foi apagado e a linha está inativa. Instâncias já aquecidas podem levar alguns minutos para parar de usá-la.",
        });
      }
      setTestes((prev) => { const p = { ...prev }; delete p[slotKey(slot.provider, slot.label)]; return p; });
      setRevogando(null);
      await load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Não foi possível revogar",
        description: describeError(e, "Falha ao revogar a credencial no cofre."),
      });
    } finally {
      setRevogandoAgora(false);
    }
  };

  const testar = async (k: string) => {
    const probe = PROBES[k];
    if (!probe) return;
    setTestando(k);
    try {
      const { data, error } = await supabase.functions.invoke(probe.fn, { body: probe.body });
      const corpo = await corpoDaSonda(data, error);
      // O detalhe é o que o cofre não consegue dizer: QUAL valor está em uso.
      // Para o Brevo é o ponto todo da sonda — o slot do remetente guardava uma
      // chave de API e a tela repetia "no cofre" sem nada contradizer.
      const detalhe = corpo?.phone
        ? ` — número ${corpo.phone}${corpo.name ? ` (${corpo.name})` : ""}`
        : corpo?.remetente
          ? ` — remetente ${corpo.remetente}, verificado na Brevo`
          : typeof corpo?.models === "number"
            ? ` — ${corpo.models} modelos disponíveis`
            : "";
      // A function devolve 5xx com a frase pronta ("Credencial ausente: ...");
      // `functionErrorMessage` é a retaguarda para resposta sem corpo JSON.
      const texto = corpo?.ok
        ? `Credencial aceita${detalhe}.`
        : corpo?.error?.trim()
          ? corpo.error
          : await functionErrorMessage(error, "Não foi possível testar esta credencial.");
      setTestes((prev) => ({
        ...prev,
        [k]: { ok: corpo?.ok === true, texto, remetentes: lerRemetentesDaSonda(corpo) },
      }));
    } catch (e) {
      const texto = await functionErrorMessage(e, "Não foi possível testar esta credencial.");
      setTestes((prev) => ({ ...prev, [k]: { ok: false, texto, remetentes: [] } }));
    } finally {
      setTestando(null);
    }
  };

  // `can()` espelha `has_permission()`, então quem não grava também não lê o
  // cofre: nos dois casos o "Tentar de novo" repetiria a mesma recusa.
  const semPermissao = !!cofreErro && (cofreErro.negado || !podeGravar);

  // A fila que está parada POR CREDENCIAL — não qualquer fila. `in_app` é
  // entregue pelo próprio app e vive com pendências sem que isso seja defeito;
  // o que importa aqui é o canal que depende de uma chave de terceiro e gravou
  // o motivo. Sem esse recorte, o aviso apareceria sempre e viraria decoração.
  const filaTravada = fila.find((f) => f.channel !== "in_app" && f.pendentes > 0 && !!f.ultimo_erro) ?? null;

  if (loading) {
    return (
      <div role="status" aria-busy className="grid place-items-center py-24 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Carregando integrações...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden /> Integrações
        </h1>
        <p className="text-xs text-muted-foreground">
          As chaves ficam em <code>private.integration_credentials</code>, num schema que
          a API REST não expõe. O valor nunca volta para a tela — só o estado.
        </p>
        {/* Estava escrito só na tela de Meta Ads, e vale para todo slot: quem
            troca uma chave aqui e testa no segundo seguinte pode ver a antiga
            responder. Sem o aviso, a conclusão natural é "a gravação falhou". */}
        <p className="text-xs text-muted-foreground">
          Gravar ou revogar vale sem redeploy, mas <b>instâncias já aquecidas podem levar alguns minutos</b> para
          largar o valor anterior — um teste logo após a troca ainda pode responder com a credencial antiga.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="secrets" className="text-xs">Credenciais</TabsTrigger>
          <TabsTrigger value="cron" className="text-xs">Saúde dos jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="secrets" className="space-y-3 mt-4">
          {cofreErro && (
            // Recusa por permissão não ganha botão de repetir: tentar de novo
            // com o mesmo perfil devolve o mesmo 42501. O que resolve é um
            // administrador conceder o código, e é isso que o texto pede.
            semPermissao ? (
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
                description={cofreErro.mensagem}
                action={<Button onClick={() => void load()}>Tentar de novo</Button>}
              />
            )
          )}
          {!cofreErro && filaTravada && (
            // A fila é a consequência VISÍVEL da credencial que falta logo
            // abaixo. Antes, o cron gravava o motivo em `notifications.
            // last_error` a cada minuto e nenhuma tela lia — o admin via os
            // slots vazios sem saber que havia mensagem de cliente esperando.
            <div role="status" className="rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {filaTravada.pendentes} notificação(ões) de {CANAL[filaTravada.channel] ?? filaTravada.channel} esperando envio
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                A mais antiga é de {dateTime(filaTravada.mais_antiga)}. Último motivo registrado pelo worker:{" "}
                <b>{filaTravada.ultimo_erro}</b>. Cadastrada a credencial abaixo, a fila drena sozinha na próxima
                execução do cron — nada precisa ser reenviado à mão.
              </p>
            </div>
          )}
          {!cofreErro && !podeGravar && (
            // O cofre foi lido, então o banco liberou — e `can()` não. É o que
            // acontece quando um admin pré-visualiza outro papel (o JWT segue
            // sendo o dele) ou quando a matriz local ficou para trás de uma
            // concessão. Campo desabilitado sem explicação parece tela quebrada.
            <p role="status" className="text-xs text-warning">
              Sem a permissão &quot;Gerenciar integrações&quot;: dá para ver o estado do cofre, não para gravar.
            </p>
          )}
          {!cofreErro && INTEGRATION_SLOTS.map((slot) => {
            const k = slotKey(slot.provider, slot.label);
            const current = storedByKey.get(k);
            const configured = !!current?.has_secret;
            return (
              // Onze blocos com os mesmos controles: sem nome, o leitor de tela
              // anuncia "Salvar" onze vezes sem dizer de qual credencial.
              <Card key={k} role="group" aria-label={slot.title} className="border-border/50">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <ShieldCheck className={configured ? "h-4 w-4 text-success" : "h-4 w-4 text-muted-foreground"} aria-hidden />
                      {slot.title}
                    </span>
                    <Badge variant={configured ? "default" : "outline"}>
                      {configured ? "no cofre" : "não configurado"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {slot.help} <span className="opacity-70">· lida por <code>{slot.usedBy}</code></span>
                  </p>
                  {!configured && (
                    // O slot vazio dizia "usando secret X" como se a chave
                    // estivesse garantida no ambiente. `getSecret` só TENTA o
                    // `Deno.env` depois do cofre e ninguém promete que o secret
                    // existe: sem os dois, a function falha.
                    <p className="text-xs text-warning">
                      {ENV_FALLBACK.test(slot.envName)
                        ? <>Nada no cofre. A function ainda tenta o secret <code>{slot.envName}</code> do ambiente como retaguarda; se ele também não existir, a chamada falha.</>
                        : <>Nada no cofre. Este slot só é lido daqui — sem cadastro, a rotina que depende dele não roda.</>}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      aria-label={slot.title}
                      placeholder={configured ? "Digite para substituir" : "Colar credencial"}
                      value={drafts[k] ?? ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                      disabled={!podeGravar}
                      className="h-9 font-mono text-xs"
                    />
                    {/* O rótulo fica ao lado do spinner: trocar o conteúdo por
                        um ícone `aria-hidden` deixava onze botões sem nome
                        acessível durante a gravação. O título vai em `sr-only`
                        porque "Salvar" sozinho se repete em cada slot. */}
                    <Button
                      size="sm"
                      onClick={() => save(slot.provider, slot.label)}
                      disabled={!podeGravar || saving === k || !(drafts[k] ?? "").trim()}
                    >
                      {saving === k
                        ? <><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Salvando…</>
                        : "Salvar"}
                      <span className="sr-only"> {slot.title}</span>
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      Última atualização: {dateTime(current?.updated_at)}
                    </p>
                    {PROBES[k] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => testar(k)}
                        disabled={testando === k}
                      >
                        {testando === k
                          ? <><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Testando…</>
                          : "Testar conexão"}
                        <span className="sr-only"> {slot.title}</span>
                      </Button>
                    )}
                    {/* Revogar só aparece quando há o que revogar: botão para um
                        slot vazio prometeria um efeito que a RPC não teria. */}
                    {podeGravar && configured && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-destructive"
                        onClick={() => setRevogando(slot)}
                      >
                        <Ban className="h-3 w-3" aria-hidden /> Revogar
                        <span className="sr-only"> {slot.title}</span>
                      </Button>
                    )}
                  </div>
                  {!PROBES[k] && SEM_TESTE[k] && (
                    <p className="text-xs text-muted-foreground">
                      <b>Sem teste automático.</b> {SEM_TESTE[k]}
                    </p>
                  )}
                  {testes[k] && (
                    <p role="status" className={`text-xs ${testes[k].ok ? "text-success" : "text-destructive"}`}>
                      {testes[k].texto}
                    </p>
                  )}
                  {/* Sem esta lista, "remetente inválido" é um beco: a Brevo só
                      aceita endereço verificado na conta dela e o admin não
                      tinha por onde descobrir qual. A sonda traz `/v3/senders`
                      junto do veredito — este bloco é o que faz a meia
                      credencial deixar de ser invisível. */}
                  {testes[k]?.remetentes.length > 0 && (
                    <div className="rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-xs">
                      <p className="text-muted-foreground">A Brevo aceita estes remetentes:</p>
                      <ul className="mt-1 space-y-0.5">
                        {testes[k].remetentes.map((r) => (
                          <li key={r.email} className="font-mono">
                            {r.email}
                            {!r.ativo && (
                              <span className="ml-1 font-sans text-warning">
                                (cadastrado, mas ainda não verificado)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {!testes[k].ok && (
                        <p className="mt-1 text-destructive">
                          O valor gravado em <code>brevo/sender_email</code> não é nenhum deles. Grave um destes
                          endereços no campo <b>Brevo — remetente</b> para os disparos saírem.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="cron" className="space-y-3 mt-4">
          {jobsErro ? (
            <EmptyState
              tone="danger"
              icon={AlertTriangle}
              title="Não consegui ler a saúde dos jobs"
              description={jobsErro}
              action={<Button onClick={() => void load()}>Tentar de novo</Button>}
            />
          ) : jobs.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="p-4 text-xs text-muted-foreground">
                {/* Não fixa a contagem: eram três, hoje são dez, e um número
                    escrito aqui envelhece a cada job novo — quem abrir a aba num
                    ambiente que PERDEU jobs compararia contra o número errado e
                    concluiria que está tudo certo. */}
                Nenhum job visível. Em produção, esperam-se várias linhas
                <code> faceimob-*</code>. Lista vazia também aparece para quem não é
                administrador.
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50">
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  {/* Duas tabelas nesta mesma aba (esta e a da fila de
                      notificações): sem nome, o leitor de tela anuncia as duas
                      como "tabela" e não há como se referir a uma delas. */}
                  <caption className="sr-only">Jobs agendados no banco</caption>
                  <thead>
                    <tr className="border-b border-border/40 text-muted-foreground">
                      <th scope="col" className="p-2 text-left font-medium">Job</th>
                      <th scope="col" className="p-2 text-left font-medium">Cadência</th>
                      <th scope="col" className="p-2 text-center font-medium">Ativo</th>
                      <th scope="col" className="p-2 text-left font-medium">Última execução</th>
                      <th scope="col" className="p-2 text-center font-medium">Falhas 24h</th>
                      <th scope="col" className="p-2 text-center font-medium">Execuções 24h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.job_name} className="border-b border-border/10">
                        <td className="p-2 font-medium flex items-center gap-1">
                          {j.active && j.failures_24h === 0
                            ? <CheckCircle2 className="h-3 w-3 text-success" aria-hidden />
                            : <AlertTriangle className="h-3 w-3 text-warning" aria-hidden />}
                          {j.job_name}
                        </td>
                        <td className="p-2 font-mono">{j.schedule}</td>
                        <td className="p-2 text-center">{j.active ? "sim" : "não"}</td>
                        <td className="p-2">{dateTime(j.last_run_at)} <span className="text-muted-foreground">{j.last_status ?? ""}</span></td>
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
            <Activity className="h-3 w-3" aria-hidden />
            Sem estes jobs a roleta não gira: a trava de 5 minutos nunca libera o lead.
          </p>

          {/* O cron pode estar verde e a fila parada mesmo assim: o worker roda,
              tenta enviar, falha por falta de credencial e grava o motivo. As
              duas leituras juntas são o que distingue "o job não roda" de "o
              job roda e a Meta não deixa passar". */}
          <Card className="border-border/50">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Fila de notificações</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {filaErro ? (
                <p className="text-xs text-destructive">{filaErro}</p>
              ) : fila.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma notificação esperando envio. Lista vazia também aparece para quem não tem a permissão
                  &quot;Gerenciar integrações&quot;.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <caption className="sr-only">Notificações pendentes por canal</caption>
                    <thead>
                      <tr className="border-b border-border/40 text-muted-foreground">
                        <th scope="col" className="p-2 text-left font-medium">Canal</th>
                        <th scope="col" className="p-2 text-center font-medium">Esperando</th>
                        <th scope="col" className="p-2 text-center font-medium">Com erro</th>
                        <th scope="col" className="p-2 text-left font-medium">Mais antiga</th>
                        <th scope="col" className="p-2 text-left font-medium">Último motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fila.map((f) => (
                        <tr key={f.channel} className="border-b border-border/10 align-top">
                          <td className="p-2 font-medium">{CANAL[f.channel] ?? f.channel}</td>
                          <td className="p-2 text-center tabular-nums">{f.pendentes}</td>
                          <td className={`p-2 text-center tabular-nums ${f.com_erro > 0 ? "text-warning font-semibold" : ""}`}>{f.com_erro}</td>
                          <td className="p-2 whitespace-nowrap">{dateTime(f.mais_antiga)}</td>
                          <td className="p-2 break-words text-muted-foreground">{f.ultimo_erro || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!revogando} onOpenChange={(aberto) => { if (!aberto && !revogandoAgora) setRevogando(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar “{revogando?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O valor é <b>apagado</b> do cofre e a credencial fica inativa — não há como recuperá-lo pela tela; para
              voltar atrás é preciso colar a chave de novo. Quem depende dela para de funcionar:{" "}
              <code>{revogando?.usedBy}</code>. Instâncias já aquecidas podem levar alguns minutos para parar de usar
              o valor antigo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revogandoAgora}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={revogandoAgora}
              onClick={(e) => { e.preventDefault(); if (revogando) void revogar(revogando); }}
            >
              {revogandoAgora ? "Revogando…" : "Revogar credencial"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
