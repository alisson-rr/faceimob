import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { EDITABLE_ROLES } from "@/integrations/supabase/permissions";
import { EMPTY_DETAILS, authErrorMessage, buildPersonSave, getPersonDetails, savePerson, suggestEmail, type PersonSave, type ProfileDetails, type ProfileStatus } from "@/integrations/supabase/people";
import type { NewAppRole } from "@/integrations/supabase/newSchema";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { date } from "@/lib/format";
import { Camera, KeyRound, Loader2, Copy, Check, IdCard, Sparkles } from "lucide-react";
import logoWhite from "@/assets/logo-faceimob-white.png";

type Manager = { id: string; name: string };
type Director = { id: string; name: string };

/** O que Equipes já tem em mãos ao abrir o modal. A ficha (CPF, CRECI…) e os
 *  papéis completos o próprio modal carrega — a lista só conhece o papel principal. */
export type EditableBroker = {
  id: string;
  name: string | null;
  full_name?: string | null;
  email?: string | null;
  role?: string | null;
  manager_id?: string | null;
  director_id?: string | null;
  active?: boolean | null;
  /** `profiles.status` cru: `active` não distingue suspenso de desligado. */
  status?: ProfileStatus | null;
  user_id?: string | null;
  avatar_url?: string | null;
  celular?: string | null;
  login_email?: string | null;
  login_email_confirmed?: boolean | null;
};

type FormState = EditableBroker & ProfileDetails & { roles: NewAppRole[] };

/**
 * Papéis de operação que não convivem com "Corretor".
 *
 * `handle_new_auth_user` (0002) concede `broker` a TODO perfil novo e nunca o
 * retira, então {broker, sdr} é indistinguível de um SDR comum — e a 0053 já
 * tira desse conjunto a criação manual de negócio. Deixar os dois marcados só
 * produz recusa silenciosa mais tarde.
 */
const SUBSTITUEM_CORRETOR: NewAppRole[] = ["sdr", "cca", "marketing"];

/** `EDITABLE_ROLES` deixa admin de fora de propósito (tela de permissões);
 *  aqui o admin precisa aparecer, porque é aqui que ele é concedido. */
const ROLE_OPTIONS: { value: NewAppRole; label: string }[] = [
  ...EDITABLE_ROLES.map(({ value, label }) => ({ value, label })),
  { value: "admin", label: "Administrador" },
];

const today = () => new Date().toISOString().slice(0, 10);

type RespostaAcesso = {
  error?: string;
  email?: string;
  user_id?: string;
  login_ready?: boolean;
  access?: string;
};

/**
 * A única porta para a edge function de acesso.
 *
 * Os dois botões da ficha que mexem no Auth (trocar o e-mail de login e
 * bloquear/devolver a entrada) passam por aqui: o cabeçalho, a leitura do erro
 * e a tradução da recusa do GoTrue são os mesmos, e duplicá-los deixaria os
 * dois caminhos divergirem no dia em que um deles mudasse.
 */
async function chamarProvisionamento(body: Record<string, unknown>): Promise<RespostaAcesso> {
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess?.session?.access_token;
  if (!accessToken) throw new Error("Sessão expirada. Faça login novamente.");

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provision-broker-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as RespostaAcesso;
  if (!response.ok) throw new Error(authErrorMessage(data.error || `Falha na função (${response.status})`));
  if (data.error) throw new Error(authErrorMessage(data.error));
  return data;
}

export function BrokerEditModal({
  open, broker, managers, directors, onClose, onSaved, isAdmin, podeMudarSituacao = false,
}: {
  open: boolean;
  broker: EditableBroker | null;
  managers: Manager[];
  directors: Director[];
  onClose: () => void;
  onSaved: () => void;
  isAdmin: boolean;
  /**
   * Quem pode suspender/reativar este colaborador: o admin e o GESTOR dele
   * (`profiles_guard_admin_columns` só libera `status` nesses dois ramos). Para
   * os demais — inclusive o diretor editando a própria ficha — o Switch ficava
   * na tela e o banco devolvia 42501.
   */
  podeMudarSituacao?: boolean;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  /**
   * O estado do banco no momento em que a ficha abriu.
   *
   * Comparar com a PROP `broker` era comparar com o que a lista adivinhou: pelo
   * caminho de recuperação do e-mail duplicado ela chuta `active: true` e
   * `manager_id: null` para uma pessoa que já existe. Quem decide "mudou" é
   * isto aqui, preenchido por `getPersonDetails`.
   */
  const [baseline, setBaseline] = useState<EditableBroker | null>(null);
  // Salvar só libera com a ficha carregada: gravar antes apagaria CPF, CRECI… com vazio.
  const [details, setDetails] = useState<"loading" | "ready" | "failed">("loading");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  /** Foto escolhida e ainda não enviada — o upload acontece no Salvar. */
  const [novaFoto, setNovaFoto] = useState<{ file: File; preview: string } | null>(null);
  const [creds, setCreds] = useState<{ email: string; loginReady: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Aviso de uma linha quando marcar SDR/CCA/Marketing desmarca "Corretor". */
  const [avisoPapel, setAvisoPapel] = useState<string | null>(null);
  /** Confirmação do desligamento definitivo — a única ação sem volta da ficha. */
  const [confirmarDesligamento, setConfirmarDesligamento] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCreds(null);
    setNovaFoto(null);
    setAvisoPapel(null);
    setConfirmarDesligamento(false);
    if (!broker) { setForm(null); setBaseline(null); return; }
    let alive = true;
    setForm({ ...EMPTY_DETAILS, roles: [], ...broker });
    setBaseline(null);
    setDetails("loading");
    getPersonDetails(broker.id)
      .then(({ details, roles, identity }) => {
        if (!alive) return;
        // O banco por cima do palpite da lista. Sem isto, a ficha aberta pelo
        // 409 de e-mail já em uso mostrava "Ativo" ligado para quem estava
        // suspenso e apagava telefone e foto no primeiro Salvar.
        const real: EditableBroker = {
          ...broker,
          full_name: identity.full_name ?? broker.full_name ?? broker.name,
          name: identity.full_name ?? broker.name,
          email: identity.email ?? broker.email,
          login_email: identity.email ?? broker.login_email,
          celular: identity.phone,
          avatar_url: identity.avatar_url,
          active: identity.active,
          status: identity.status,
          manager_id: identity.manager_id,
          director_id: identity.director_id,
        };
        setBaseline(real);
        setForm((previous) => previous ? { ...previous, ...details, ...real, roles } : previous);
        setDetails("ready");
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setDetails("failed");
        toast({ title: "Erro ao carregar a ficha", description: describeError(error, "Não foi possível carregar os dados do colaborador."), variant: "destructive" });
      });
    return () => { alive = false; };
  }, [broker]);

  // Mesmo limite de `src/pages/Settings.tsx`, repetido aqui de propósito: são
  // dois formulários independentes e o bucket `avatars` não valida nada. Sem
  // isto a ficha aceitava PDF de 40 MB e só o upload reclamava, em inglês.
  const escolherFoto = (file: File) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      return toast({ title: "Formato não aceito", description: "Envie uma imagem JPG, PNG ou WebP.", variant: "destructive" });
    }
    if (file.size > 5 * 1024 * 1024) {
      return toast({ title: "Imagem muito grande", description: "Envie uma imagem de até 5 MB.", variant: "destructive" });
    }
    // `createObjectURL` segura o arquivo em memória até ser revogado.
    setNovaFoto((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior.preview);
      return { file, preview: URL.createObjectURL(file) };
    });
  };

  const descartarFoto = () => {
    setNovaFoto((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior.preview);
      return null;
    });
  };

  if (!form) return null;
  const upd = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(previous => previous ? { ...previous, [key]: value } : previous);

  const toggleRole = (role: NewAppRole, checked: boolean) => {
    if (!checked) {
      setAvisoPapel(null);
      return upd("roles", form.roles.filter(r => r !== role));
    }
    // Marcar SDR, CCA ou Marketing tira "Corretor" e DIZ que tirou. Quem quiser
    // os dois é só marcar Corretor de novo — nada aqui impede.
    const tiraCorretor = SUBSTITUEM_CORRETOR.includes(role) && form.roles.includes("broker");
    const rotulo = ROLE_OPTIONS.find(r => r.value === role)?.label ?? role;
    setAvisoPapel(tiraCorretor
      ? `"Corretor" foi desmarcado: ${rotulo} e Corretor juntos viram recusa silenciosa na criação de negócio. Marque Corretor de novo se ela também atende.`
      : null);
    const semCorretor = tiraCorretor ? form.roles.filter(r => r !== "broker") : form.roles;
    upd("roles", [...semCorretor, role]);
  };

  const managesTeam = form.roles.includes("manager");
  // `team_members_one_active` é UNIQUE(profile_id) WHERE left_at is null: uma
  // pessoa está em UMA equipe. Para um gerente, essa equipe é a que ele lidera —
  // mandá-lo para outra fecha a filiação na própria e o diretor deixa de
  // enxergá-lo (`auth_visible_profiles` só alcança membros das equipes
  // lideradas). O campo fica travado em vez de causar isso em silêncio.
  const equipeTravada = managesTeam;
  const desligado = (baseline?.status ?? form.status) === "terminated";
  /** Ligar o Switch de quem está DESLIGADO devolve também a entrada no login. */
  const reativando = desligado && form.active === true;

  /**
   * Monta o que vai para o banco; devolve a mensagem de validação quando não dá
   * para salvar.
   *
   * O que conta como "mudou" sai do BANCO (`baseline`, preenchido por
   * `getPersonDetails`) e nunca da prop `broker`: pelo caminho de recuperação do
   * e-mail duplicado a lista chuta `active: true` e `manager_id: null` para
   * alguém que já existe, e comparar com esse chute travava a reativação.
   */
  const buildSave = (email: string | null | undefined, desligar = false): PersonSave | string =>
    buildPersonSave({ ...form, id: form.id }, email, {
      baseline: baseline
        ? {
            active: baseline.active,
            status: baseline?.status ?? undefined,
            manager_id: baseline?.manager_id ?? null,
            director_id: baseline?.director_id ?? null,
          }
        : null,
      isAdmin,
      managesTeam,
      desligar,
    });

  /**
   * Envia a foto escolhida e devolve a URL a gravar.
   *
   * O upload só acontece AQUI, no caminho do Salvar: antes ele subia no ato de
   * escolher o arquivo, então fechar sem salvar deixava um arquivo órfão no
   * bucket e a foto do perfil continuava a antiga.
   */
  const enviarFoto = async (): Promise<string | null> => {
    if (!novaFoto) return form.avatar_url ?? null;
    setUploading(true);
    try {
      const ext = novaFoto.file.name.split(".").pop() || "jpg";
      const path = `${form.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, novaFoto.file, { upsert: true });
      if (upErr) throw upErr;
      // ponytail: URL assinada por 5 anos gravada em `profiles.avatar_url` —
      // passado o prazo TODO avatar quebra de uma vez e não há renovação. O
      // mesmo desenho está em `src/pages/Settings.tsx`, então a correção é uma
      // só e fora daqui: guardar o CAMINHO na coluna e assinar na leitura (ou
      // tornar o bucket público). Evoluir quando houver um leitor único de
      // avatar; consertar só neste arquivo deixaria as duas telas divergentes.
      const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      return signed?.signedUrl || form.avatar_url || null;
    } finally {
      setUploading(false);
    }
  };

  const save = async (desligar = false) => {
    const input = buildSave(form.email, desligar);
    if (typeof input === "string") return toast({ title: "Falta preencher", description: input, variant: "destructive" });
    setSaving(true);
    try {
      input.profile.avatar_url = await enviarFoto();
      await savePerson(input);
      descartarFoto();

      /**
       * O bloqueio da ENTRADA anda junto do desligamento — e a volta, junto da
       * reativação.
       *
       * Antes, desligar marcava `status = 'terminated'`, tirava a pessoa das
       * listas e deixava a conta entrando: ela saía da empresa e continuava
       * lendo os próprios leads, negócios e o diário da equipe. A ficha até
       * dizia isso ("bloquear é tarefa do painel do Supabase"), o que é honesto
       * e não resolve nada.
       *
       * Só o admin: a edge function recusa os demais. O gestor que reativasse
       * sem esta chamada deixaria a pessoa "ativa" e trancada do lado de fora —
       * por isso o Switch dela também trava para ele (ver `disabled` abaixo).
       */
      const acaoDeAcesso = desligar ? "revoke" : reativando ? "restore" : null;
      let avisoAcesso: string | null = null;
      /**
       * O código de 6 dígitos SAI? Só a função sabe (`SMTP_CONFIGURED`), e sem
       * ela a resposta é "não sei" — que aqui vale por "não prometa". Esta era a
       * única frase da tela que garantia o comportamento que a credencial
       * ausente impede.
       */
      let entradaPronta = false;
      if (acaoDeAcesso && isAdmin) {
        try {
          const resposta = await chamarProvisionamento({ profile_id: form.id, access: acaoDeAcesso });
          entradaPronta = resposta.login_ready === true;
        } catch (error: unknown) {
          const motivo = describeError(error, "a função de acesso não respondeu.");
          avisoAcesso = acaoDeAcesso === "revoke"
            ? `A ficha ficou como DESLIGADA, mas a entrada NÃO foi bloqueada: ${motivo} Ele ainda consegue entrar — repita o desligamento.`
            : `A ficha ficou ATIVA, mas a entrada continua bloqueada: ${motivo} Ele ainda não consegue entrar — reative de novo.`;
        }
      }

      toast({
        title: avisoAcesso
          ? "Ficha salva, acesso não"
          : desligar
            ? "Colaborador desligado"
            : "Dados atualizados",
        description: avisoAcesso
          ?? (desligar
            ? "A entrada foi bloqueada no login. Reativar o colaborador devolve o acesso — nada foi apagado."
            : reativando
              ? (entradaPronta
                ? "O bloqueio de entrada foi removido: ele volta a receber o código em /login."
                : "O bloqueio de entrada foi removido. O código de 6 dígitos só chega quando o SMTP (Brevo) for configurado — até lá ele ainda não consegue entrar.")
              : undefined),
        variant: avisoAcesso ? "destructive" : undefined,
      });
      onSaved();
    } catch (error: unknown) {
      // `SavePersonError` já traz a frase pronta (qual etapa falhou e o que já
      // ficou gravado); `describeError` cuidaria só do erro cru do Postgres.
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error && error.name === "SavePersonError"
          ? error.message
          : describeError(error, "Não foi possível salvar os dados do colaborador."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const provision = async (reset = false) => {
    setProvisioning(true); setCreds(null);
    // A troca do login acontece ANTES do resto da ficha. Sem esta marca, uma
    // falha no `savePerson` seguinte (RLS, CPF duplicado, regra de papel) fazia
    // a tela dizer "Falha ao atualizar o acesso" enquanto o login JÁ tinha
    // mudado — a mensagem afirmava o contrário do que aconteceu.
    let acessoTrocado = false;
    try {
      // A ORDEM IMPORTA. Antes o perfil era gravado ANTES da função: se o
      // e-mail já pertencesse a outra conta, `profiles.email` ficava com o
      // endereço novo e o Auth continuava no antigo — a ficha passava a mostrar
      // um login que não existe. Agora quem manda é a função (ela troca o Auth
      // e o espelho em `profiles` na mesma chamada, ou não troca nada) e o
      // resto da ficha é gravado depois, já com o e-mail confirmado.
      const input = buildSave(form.login_email || form.email);
      if (typeof input === "string") throw new Error(input);

      const data = await chamarProvisionamento({
        broker_id: form.id,
        email: form.login_email || form.email,
        reset,
      });
      if (!data.email || !data.user_id) throw new Error("A função não devolveu o acesso criado.");
      // `!== false` tratava campo AUSENTE como "o código chega" — e ausente é
      // exatamente o que uma versão antiga da função devolve. O lado seguro é o
      // contrário: só `true` explícito promete o código.
      acessoTrocado = true;
      setCreds({ email: data.email, loginReady: data.login_ready === true });
      upd("user_id", data.user_id);
      upd("login_email", data.email);

      // Agora sim o resto da ficha, já com o e-mail que o Auth aceitou.
      await savePerson({ ...input, profile: { ...input.profile, email: data.email } });

      toast({
        title: "E-mail de acesso atualizado",
        description: data.login_ready === true
          ? "O colaborador entra em /login com esse e-mail e recebe o código."
          : "O endereço mudou no login. O código de 6 dígitos só chega quando o SMTP for configurado.",
      });
      // Do NOT call onSaved() here — that would close the modal and hide the e-mail.
    } catch (error: unknown) {
      const motivo = error instanceof Error ? authErrorMessage(error.message) : "Não foi possível atualizar o acesso.";
      toast({
        title: acessoTrocado ? "E-mail de acesso trocado, mas a ficha não foi salva" : "Falha ao atualizar o acesso",
        description: acessoTrocado
          ? `O login JÁ é ${form.login_email || form.email} — o que falhou foi o resto da ficha: ${motivo} Corrija e clique em Salvar.`
          : motivo,
        variant: "destructive",
      });
    } finally {
      setProvisioning(false);
    }
  };

  /**
   * Sem o `await` o ✓ verde aparecia mesmo quando nada foi para a área de
   * transferência (http, aba sem foco, permissão negada) e a rejeição virava
   * unhandled promise. Mesmo desenho já usado em `src/pages/Links.tsx`.
   */
  const copy = async (label: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch (error: unknown) {
      toast({
        title: "Não foi possível copiar",
        description: describeError(error, "Copie o endereço manualmente."),
        variant: "destructive",
      });
    }
  };

  const badgeRequested = !!form.badge_requested_at;
  // Zero funções marcadas é recusado pela RPC `set_profile_roles` — mas só
  // DEPOIS de o perfil já ter sido gravado (etapa 1 de `savePerson`). O botão
  // desabilitado com o motivo escrito ao lado evita a ficha meio salva.
  const semFuncao = isAdmin && form.roles.length === 0;
  const canSave = details === "ready" && !saving && !semFuncao;

  return (
    // O diálogo de confirmação é IRMÃO do modal, não filho: é o mesmo desenho
    // que já funciona em Equipes (Dialog + AlertDialog lado a lado) e evita
    // aninhar duas camadas modais do Radix uma dentro da outra.
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Colaborador</DialogTitle>
          <DialogDescription>Perfil, dados pessoais e acesso ao sistema.</DialogDescription>
        </DialogHeader>

        {details === "failed" && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            Não foi possível carregar a ficha deste colaborador. Os campos ficam bloqueados para não gravar dados em branco por cima dos atuais — feche e abra de novo.
          </p>
        )}

        {/* Avatar */}
        <div className="flex justify-center py-2">
          <div className="relative">
            <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-primary/40 bg-secondary flex items-center justify-center">
              {novaFoto || form.avatar_url
                ? <img src={novaFoto?.preview ?? form.avatar_url ?? ""} alt={form.name || ""} className="w-full h-full object-cover" />
                : <img src={logoWhite} alt="" className="w-16 h-16 object-contain opacity-60" />}
            </div>
            <button
              type="button"
              aria-label="Trocar foto"
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 bg-primary text-primary-foreground rounded-full p-1.5 border-2 border-background"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              aria-label="Arquivo da foto do colaborador"
              onChange={(e) => e.target.files?.[0] && escolherFoto(e.target.files[0])} />
          </div>
        </div>
        {novaFoto && (
          <p className="text-center text-xs text-muted-foreground">
            Foto escolhida — só é enviada ao clicar em Salvar.{" "}
            <button type="button" className="underline hover:text-foreground" onClick={descartarFoto}>
              descartar
            </button>
          </p>
        )}

        {/* Fields grid — `fieldset disabled` bloqueia a ficha inteira de uma vez
            enquanto ela carrega: editar antes seria sobrescrito quando a
            resposta chegasse, e depois de falhar seria gravar vazio por cima. */}
        <fieldset disabled={details !== "ready"} className="grid min-w-0 grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Nome completo" className="md:col-span-2"><Input value={form.full_name || ""} onChange={e => upd("full_name", e.target.value)} /></Field>
          <Field
            label="Email"
            hint={isAdmin ? undefined : "O e-mail espelha o login e só o administrador o altera."}
          >
            <Input type="email" value={form.email || ""} disabled={!isAdmin} onChange={e => upd("email", e.target.value)} />
          </Field>

          <Field
            label="Equipe (Gerente)"
            hint={equipeTravada ? "Gerente pertence à equipe que lidera; mudar aqui o tiraria dela e o diretor deixaria de enxergá-lo." : undefined}
          >
            <Select value={form.manager_id || "__none__"} onValueChange={v => upd("manager_id", v === "__none__" ? null : v)} disabled={equipeTravada}>
              {/* O SelectTrigger e um `button role="combobox"` cujo nome vem do
                  VALOR escolhido: sem isto o leitor de tela anuncia "Marcos
                  Gerente, caixa de combinacao" sem dizer que campo e. O
                  `<label>` do `Field` nomeia os `<input>`, nao este. */}
              <SelectTrigger aria-label="Equipe (Gerente)"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem gerente —</SelectItem>
                {managers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Diretor"
            className="md:col-span-2"
            hint={managesTeam ? undefined : "Quem não gerencia equipe herda o diretor da equipe do gerente."}
          >
            <Select value={form.director_id || "__none__"} onValueChange={v => upd("director_id", v === "__none__" ? null : v)} disabled={!managesTeam}>
              <SelectTrigger aria-label="Diretor"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem diretor —</SelectItem>
                {directors.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <fieldset className="md:col-span-3">
            <legend className="text-eyebrow">Funções</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
              {ROLE_OPTIONS.map(r => (
                <div key={r.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`role-${r.value}`}
                    checked={form.roles.includes(r.value)}
                    disabled={!isAdmin}
                    onCheckedChange={v => toggleRole(r.value, v === true)}
                  />
                  <Label htmlFor={`role-${r.value}`} className="text-xs font-normal">{r.label}</Label>
                </div>
              ))}
            </div>
            {!isAdmin && <p className="text-xs text-muted-foreground mt-1">Só o administrador altera funções.</p>}
            {isAdmin && (
              <p className="text-xs text-muted-foreground mt-1">
                A autorização usa a UNIÃO das funções marcadas. Todo perfil nasce com
                "Corretor"; marcar SDR, CCA ou Marketing desmarca esse papel, porque o
                par com Corretor vira recusa silenciosa mais tarde. O banco recusa
                deixar a empresa sem nenhum administrador e recusa você retirar a sua
                PRÓPRIA função de administrador.
              </p>
            )}
            {avisoPapel && (
              <p role="status" className="mt-1 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-xs text-warning">
                {avisoPapel}
              </p>
            )}
            {semFuncao && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                Marque ao menos uma função — o banco recusa conjunto vazio e o Salvar fica bloqueado até lá.
              </p>
            )}
          </fieldset>

          <Field label="CPF"><Input inputMode="numeric" value={form.cpf || ""} onChange={e => upd("cpf", e.target.value)} /></Field>
          <Field label="Celular"><Input value={form.celular || ""} onChange={e => upd("celular", e.target.value)} /></Field>
          <Field label="Nascimento"><Input type="date" value={form.birth_date || ""} onChange={e => upd("birth_date", e.target.value)} /></Field>

          <Field label="Habilitação">
            <Select value={form.habilitation || "__none__"} onValueChange={v => upd("habilitation", v === "__none__" ? null : v)}>
              <SelectTrigger aria-label="Habilitação"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                <SelectItem value="CRECI">CRECI</SelectItem>
                <SelectItem value="CRECI-ESTAGIARIO">CRECI Estagiário</SelectItem>
                <SelectItem value="OUTRO">Outro</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="CRECI"><Input value={form.creci || ""} onChange={e => upd("creci", e.target.value)} /></Field>
          {/* `profiles_guard_admin_columns` (0012) levanta 42501 quando quem
              não é admin (nem gestor do alvo) mexe em `hired_at`. O campo era
              oferecido a todos: um diretor SEM equipe editando a própria ficha
              caía nesse ramo e o Salvar inteiro falhava — e um diretor COM
              equipe gravava. Mesmo botão, dois comportamentos. */}
          <Field
            label="Entrada"
            hint={isAdmin ? undefined : "Só o administrador altera a data de entrada."}
          >
            <Input type="date" disabled={!isAdmin} value={form.hired_at || ""} onChange={e => upd("hired_at", e.target.value)} />
          </Field>

          <Field label="Endereço" className="md:col-span-3"><Input value={form.address || ""} onChange={e => upd("address", e.target.value)} /></Field>
          <Field label="Divisão"><Input value={form.division || ""} onChange={e => upd("division", e.target.value)} /></Field>
          <Field label="Indicação" className="md:col-span-2"><Input value={form.indication || ""} onChange={e => upd("indication", e.target.value)} /></Field>

          {/* Situação. O Switch sozinho só sabia dizer ativo/suspenso, e
              `profile_status` tem TRÊS valores: `terminated` existe no enum
              desde a 0002 e nenhuma tela escrevia nele — não havia desligamento
              definitivo em lugar nenhum do sistema. */}
          <div className="md:col-span-3 flex flex-wrap items-center gap-3 rounded-lg border border-border/40 bg-secondary/20 p-3">
            <Label htmlFor="profile-active" className="text-xs">
              {desligado ? "Reativar (hoje: desligado)" : "Ativo"}
            </Label>
            <Switch
              id="profile-active"
              checked={!!form.active}
              // Reativar um DESLIGADO devolve também a entrada no login, e a
              // edge function que faz isso só aceita administrador. Deixar o
              // gestor ligar o Switch marcaria a pessoa como ativa e a deixaria
              // trancada do lado de fora, sem ninguém saber.
              disabled={!podeMudarSituacao || (desligado && !isAdmin)}
              onCheckedChange={v => upd("active", v)}
            />
            <span className="text-xs text-muted-foreground">
              {!podeMudarSituacao
                ? "Só o administrador ou o gestor direto muda a situação deste colaborador."
                : desligado
                  ? isAdmin
                    ? "Desligado e sem entrada no login. Ligue o Switch e salve para reativar os dois."
                    : "Desligado. Reativar devolve também a entrada no login, e isso é só do administrador."
                  : form.active
                    ? "Desligar o Switch SUSPENDE — é reversível, mantém o histórico e NÃO bloqueia a entrada."
                    : "Suspenso. Reversível: ligue o Switch e salve."}
            </span>
            {isAdmin && !desligado && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto border-destructive/40 text-destructive"
                disabled={details !== "ready" || saving}
                onClick={() => setConfirmarDesligamento(true)}
              >
                Desligar definitivamente
              </Button>
            )}
          </div>

          {/* Só admin: `profiles_guard_admin_columns` (0012) recusa a coluna para
              qualquer outro papel, inclusive o gerente do próprio subordinado.
              Mostrar o controle a quem o banco recusa seria botão morto. */}
          {isAdmin && (
            <div className="md:col-span-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <div className="flex items-center gap-3">
                <Label htmlFor="profile-bypass-ip" className="text-xs">Dispensar validação de IP no check-in</Label>
                <Switch
                  id="profile-bypass-ip"
                  checked={!!form.bypass_ip_check}
                  onCheckedChange={v => upd("bypass_ip_check", v)}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Ligado, este colaborador bate ponto de qualquer rede — é a exceção da trava
                antifraude, não o padrão. Use para trabalho externo e desligue depois.
              </p>
            </div>
          )}
        </fieldset>

        {/* Access */}
        {isAdmin && (() => {
          const suggested = suggestEmail(form.full_name, form.name);
          const currentEmail = (form.login_email || "").trim();
          const emailConfirmed = !!form.login_email_confirmed && !!currentEmail;
          return (
          /* O MESMO cadeado do resto da ficha, que este bloco não tinha.
             `getPersonDetails` chega depois do primeiro render e sobrescreve o
             formulário — inclusive `login_email`. Quem digitasse o endereço
             novo antes de a ficha carregar via o campo voltar ao antigo em
             silêncio e o botão trocava o e-mail para ELE MESMO, com toast
             verde: foi o que a homologação gravou (`access_provision_log`
             action='reset' com o endereço antigo). O `fieldset` também barra
             provisionar com a ficha que FALHOU ao carregar — `savePerson`
             logo em seguida gravaria CPF, CRECI e telefone em branco. */
          <fieldset disabled={details !== "ready"} className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Acesso ao sistema</div>

            {/* Email suggestion */}
            <div className="rounded-md border bg-background/60 p-2 space-y-2">
              {/* 375 px: sem `flex-wrap` os três controles e o endereço ficavam
                  numa linha só, e um `code` não quebra sozinho — a ficha
                  transbordava 157 px na horizontal. */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-3 w-3 text-primary" /> Sugestão
                <code className="min-w-0 break-all text-foreground">{suggested || "preencha o nome completo"}</code>
                {suggested && (
                  <>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Copiar sugestão" onClick={() => void copy("sug", suggested)}>
                      {copied === "sug" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-6 text-xs"
                      onClick={() => { upd("login_email", suggested); upd("login_email_confirmed", false); }}>
                      Usar sugestão
                    </Button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* `min-w-0`: um `input` não encolhe abaixo da largura
                    intrínseca dele (~20 caracteres) e ficava a 10 px de estourar
                    a linha junto com o "Confirmar" a 375. */}
                <Input className="min-w-0" placeholder="e-mail de login" aria-label="E-mail de login" value={form.login_email || ""}
                  onChange={e => { upd("login_email", e.target.value); upd("login_email_confirmed", false); }} />
                {emailConfirmed ? (
                  <span className="text-xs text-success whitespace-nowrap flex items-center gap-1"><Check className="h-3 w-3" /> confirmado</span>
                ) : (
                  <Button type="button" size="sm" variant="secondary" disabled={!currentEmail}
                    onClick={() => upd("login_email_confirmed", true)}>
                    Confirmar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Confirme o e-mail antes de gerar o acesso — o endereço pode já existir. Salve as alterações após confirmar.
              </p>
            </div>

            {/* Toda pessoa listada em Equipes já tem conta no Auth (o perfil nasce
                do trigger `on_auth_user_created`), então "Criar acesso" nunca
                era alcançável — só sobra trocar o endereço. */}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => provision(true)} disabled={provisioning || !emailConfirmed || details !== "ready"}>
                {provisioning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <KeyRound className="h-3 w-3 mr-1" />}
                Atualizar e-mail de acesso
              </Button>
            </div>
            {!emailConfirmed && <p className="text-xs text-warning">Confirme o e-mail para liberar a criação do acesso.</p>}

            {/* Acesso do colaborador — só o e-mail. Não há senha para entregar:
                o login é por código enviado no ato de cada entrada. */}
            {creds && (
              <div className="rounded-md bg-background/60 border p-2 text-xs space-y-1">
                <p className="font-semibold text-success">Acesso do colaborador:</p>
                <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground w-16">E-mail:</span>
                  <code className="min-w-0 flex-1 break-all">{creds.email}</code>
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Copiar e-mail" onClick={() => void copy("email", creds.email)}>{copied === "email" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</Button>
                </div>
                {creds.loginReady ? (
                  <p className="text-muted-foreground">
                    Ele entra em <code>/login</code> com esse e-mail e recebe um código de 6 dígitos.
                    Não há senha para repassar.
                  </p>
                ) : (
                  <p className="text-warning">
                    O endereço já vale no login, mas o e-mail com o código de 6 dígitos ainda NÃO sai:
                    falta configurar o SMTP (Brevo) e aplicar o template de Magic Link no projeto.
                    Enquanto isso, avise o colaborador de que ele ainda não consegue entrar.
                  </p>
                )}
              </div>
            )}
          </fieldset>
          );
        })()}

        {/* Badge (crachá) — as datas vêm da mesma ficha da grade acima, então
            seguem o mesmo bloqueio enquanto ela não carrega. */}
        <fieldset disabled={details !== "ready"} className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2 min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold flex items-center gap-2"><IdCard className="h-4 w-4 text-warning" /> Crachá</div>
            <div className="flex items-center gap-2">
              <Label htmlFor="badge-requested" className="text-xs">Solicitado</Label>
              <Switch id="badge-requested" checked={badgeRequested} onCheckedChange={v => {
                upd("badge_requested_at", v ? today() : null);
                if (!v) upd("badge_delivered_at", null);
              }} />
            </div>
          </div>
          {badgeRequested && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data da solicitação">
                <Input type="date" value={form.badge_requested_at || ""} onChange={e => upd("badge_requested_at", e.target.value || null)} />
              </Field>
              <Field label="Data de entrega">
                <Input type="date" min={form.badge_requested_at || undefined} value={form.badge_delivered_at || ""} onChange={e => upd("badge_delivered_at", e.target.value || null)} />
              </Field>
              {!form.badge_delivered_at && (
                <p className="col-span-2 text-xs text-warning">Crachá solicitado — aguardando entrega.</p>
              )}
              {form.badge_delivered_at && (
                <p className="col-span-2 text-xs text-success">Entregue em {date(form.badge_delivered_at)}.</p>
              )}
            </div>
          )}
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {(saving || details === "loading") && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Desligamento definitivo: `status = 'terminated'` + `terminated_at`
        (o check `profiles_terminated_consistency` exige os dois juntos). */}
    <AlertDialog open={confirmarDesligamento} onOpenChange={setConfirmarDesligamento}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">Desligar {form.full_name || form.name} da empresa?</AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            O perfil passa a "desligado" com a data de hoje, sai das listas de trabalho e
            A ENTRADA NO LOGIN É BLOQUEADA na mesma ação — sem isso ele continuaria lendo
            os próprios leads, negócios e o diário da equipe depois de sair.
            <br />
            Nada é apagado: leads, negócios e histórico continuam onde estão, a conta não é
            removida e o administrador reativa depois pelo Switch "Ativo", o que devolve a
            entrada junto.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs">Voltar</AlertDialogCancel>
          <AlertDialogAction
            className="text-xs"
            onClick={() => { setConfirmarDesligamento(false); void save(true); }}
          >
            Desligar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

/** O `<label>` envolve o controle: associação implícita, sem precisar de `id`
 *  em cada campo. A dica fica FORA dele — texto dentro do label entraria no
 *  nome acessível do controle. */
function Field({ label, children, className, hint }: {
  label: string;
  children: React.ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <div className={className}>
      <label className="block">
        <span className="text-eyebrow block leading-none">{label}</span>
        <span className="mt-1 block">{children}</span>
      </label>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
