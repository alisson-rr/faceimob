import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  KeyRound, Link2, Copy, Plus, RefreshCw, Eye, EyeOff, Users, ShieldCheck, Globe,
  ExternalLink, AlertTriangle, CalendarClock, Lock, Ban, type LucideIcon,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { listPeople, type PersonRecord } from "@/integrations/supabase/newSchema";
import { useAuth } from "@/contexts/AuthContext";
import { slugify } from "@/lib/utils";
import { date as fmtDate } from "@/lib/format";
import { LINK_VALIDITY_DAYS, linkExpiry, linkLock } from "@/lib/publicLinks";
import { describeError } from "@/lib/supabaseError";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";

/**
 * PIN de 6 dígitos com fonte criptográfica.
 *
 * `Math.random()` é previsível: quem observa alguns PINs reconstrói o estado do
 * gerador e prevê os próximos. O PIN é o único segredo entre a internet e o
 * funil da diretoria — vale os 4 bytes do `crypto`. O módulo enviesa os últimos
 * valores em ~0,000002%, irrelevante para um espaço de 10^6 protegido por
 * lockout (migration 0033).
 */
const randomPin = () => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (100000 + (buffer[0] % 900000)).toString();
};

/** Um dia em milissegundos — a conta da renovação de validade. */
const DAY_MS = 86_400_000;

/**
 * Prazos que o botão de validade oferece.
 *
 * 90 dias é o que `create_public_link` dá a um link novo (0062) e continua sendo
 * o recomendado; os outros dois existem porque o prazo do produto não serve a
 * todo caso real — uma equipe em campanha de 30 dias e um link de diretoria que
 * roda o semestre inteiro não pedem a mesma validade, e sem escolha o admin só
 * tinha "90 ou 90".
 */
const VALIDITY_OPTIONS = [30, LINK_VALIDITY_DAYS, 180] as const;

/**
 * Idade a partir da qual o PIN vira aviso na tela.
 *
 * Não existe rotação automática, e nem deveria: girar o PIN sozinho fecharia o
 * link na cara do gerente sem ninguém para entregar o código novo. O que faltava
 * era o lembrete — o PIN mais antigo é justamente o que ninguém olha.
 */
const PIN_MAX_AGE_DAYS = 180;

/**
 * Linha de `public_links` como esta tela precisa dela.
 *
 * Sem `pin_hash`: a tela só pergunta SE existe PIN, e `select("*")` mandava o
 * bcrypt de todos os links para o navegador. `has_pin` é a coluna calculada da
 * 0062 e é o que a consulta pede.
 *
 * `pin_set_at` e `has_pin` nascem na 0062 e `types.ts` é gerado por
 * `supabase gen types` — não se edita à mão; o cast local morre no próximo
 * `gen types`, como o dos RPCs abaixo.
 */
type PublicLinkRow = {
  id: string;
  kind: string;
  team_id: string | null;
  director_id: string | null;
  slug: string;
  active: boolean;
  has_pin: boolean | null;
  pin_set_at: string | null;
  expires_at: string | null;
  locked_until: string | null;
  failed_attempts: number | null;
};

/** As colunas que a tela usa — `pin_hash` fica no servidor, de propósito. */
const LINK_COLUMNS =
  "id,kind,team_id,director_id,slug,active,has_pin,pin_set_at,expires_at,locked_until,failed_attempts";

/** As mesmas colunas menos as duas que nascem na 0062. */
const LINK_COLUMNS_PRE_0062 =
  "id,kind,team_id,director_id,slug,active,expires_at,locked_until,failed_attempts";

/**
 * Links de um tipo, com a 0062 aplicada ou não.
 *
 * O front sobe antes da migration (o deploy do Vercel não espera o `db push`) e
 * pedir `has_pin,pin_set_at` num banco sem elas devolve 42703 — o erro subia do
 * `queryFn` e derrubava a tela INTEIRA: nem equipe, nem diretor, nem botão de
 * PIN, só "Não consegui carregar os links". Um campo novo não pode apagar a
 * tela que já funcionava.
 *
 * No caminho degradado o `has_pin` vem de um segundo select por `id` — filtrar
 * `pin_hash is not null` no servidor responde a pergunta sem trazer o bcrypt
 * para o navegador, que é o motivo de a coluna calculada existir. `pin_set_at`
 * não tem de onde sair: fica null e a linha some, como em qualquer link
 * anterior à migration.
 */
async function fetchPublicLinks(kind: "daily_team" | "director_checkpoint") {
  // Crescente porque no Map a última linha vence: sobra a mais nova, que é a
  // mesma que `create_public_link` reaproveita.
  const query = (columns: string) =>
    supabase.from("public_links").select(columns)
      .eq("kind", kind).eq("active", true)
      .order("created_at", { ascending: true });

  const first = await query(LINK_COLUMNS);
  if (!first.error) return first.data as unknown as PublicLinkRow[];
  // Só a coluna inexistente é tolerada; 42501, rede e o resto continuam subindo.
  if (first.error.code !== "42703") throw first.error;

  const [legacy, pinned] = await Promise.all([
    query(LINK_COLUMNS_PRE_0062),
    supabase.from("public_links").select("id")
      .eq("kind", kind).eq("active", true).not("pin_hash", "is", null),
  ]);
  if (legacy.error) throw legacy.error;
  if (pinned.error) throw pinned.error;

  const comPin = new Set((pinned.data ?? []).map(row => row.id));
  return (legacy.data as unknown as Omit<PublicLinkRow, "has_pin" | "pin_set_at">[]).map<PublicLinkRow>(
    row => ({ ...row, has_pin: comPin.has(row.id), pin_set_at: null }),
  );
}

type TeamRow = {
  id: string;
  name: string;
  active: boolean;
  director_id: string | null;
  manager_id: string | null;
};
type DailyTeam = TeamRow & { public_link: PublicLinkRow | null };
type PublicDirector = PersonRecord & { public_link: PublicLinkRow | null };

/**
 * `create_public_link` nasce na migration 0033 (e ganha validade na 0062) e
 * ainda não está em `types.ts`. O cast local morre no próximo `gen types`.
 */
type CreateLinkArgs = {
  p_kind: "daily_team" | "director_checkpoint";
  p_pin: string;
  p_team_id?: string | null;
  p_director_id?: string | null;
};
const createPublicLink = (args: CreateLinkArgs) =>
  (supabase.rpc as unknown as (
    fn: "create_public_link",
    args: CreateLinkArgs,
  ) => Promise<{ data: { id: string; slug: string } | null; error: { message: string } | null }>)(
    "create_public_link",
    args,
  );

/** Ação que só acontece depois de o admin confirmar. */
type PendingAction = {
  title: string;
  description: string;
  confirmLabel: string;
  /** `unknown` porque os caminhos de erro devolvem o retorno do toast. */
  run: () => Promise<unknown>;
};

export default function AdminDailyTeams() {
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  // `profiles.id` é o `auth.uid()` — é o que `can_manage_public_link` (0062)
  // compara com `teams.director_id`.
  const myProfileId = user?.id ?? null;

  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [generatedPins, setGeneratedPins] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingAction | null>(null);
  /** Link cuja validade está sendo escolhida (um diálogo para as duas tabelas). */
  const [validityFor, setValidityFor] = useState<{ id: string; label: string; expiresAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const [teamOpen, setTeamOpen] = useState(false);
  const [newTeam, setNewTeam] = useState("");
  const [newDirector, setNewDirector] = useState("");
  const [newManager, setNewManager] = useState("");

  const {
    data: teams,
    isLoading: loadingTeams,
    error: teamsError,
  } = useQuery({
    queryKey: ["daily-teams"],
    queryFn: async () => {
      const [teamsRes, linkRows] = await Promise.all([
        supabase.from("teams").select("id,name,active,director_id,manager_id").order("name"),
        // Só link ATIVO, como na query de diretores logo abaixo: desativar um
        // link e criar outro deixa os dois na tabela, e o inativo vencia o
        // sorteio do Map — a tela copiava uma URL que `resolve_public_link`
        // recusa e o "Renovar PIN" gravava no link morto.
        fetchPublicLinks("daily_team"),
      ]);
      // Erro engolido virava "Nenhuma equipe cadastrada": a tela afirmava que o
      // cadastro está vazio quando na verdade a consulta falhou.
      if (teamsRes.error) throw teamsRes.error;

      const links = new Map(linkRows.flatMap(link => link.team_id ? [[link.team_id, link] as const] : []));
      return (teamsRes.data ?? []).map<DailyTeam>(team => ({
        ...team,
        public_link: links.get(team.id) ?? null,
      }));
    },
  });

  const { data: ips, error: ipsError } = useQuery({
    queryKey: ["allowed-ips-mini"],
    // Só o admin lê `allowed_ips` (policy `allowed_ips_read`, 0044). Para o
    // diretor a consulta voltaria 200 com lista vazia — um pedido inútil cujo
    // resultado a tela não mostra.
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("allowed_ips").select("id,ip_range,label,active").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Só leitura. Antes esta query CRIAVA o link do diretor de passagem, com slug
  // `diretor-<nome>` e sem PIN nenhum: abrir a tela publicava o funil da
  // diretoria numa URL adivinhável (achado S02). Agora o link nasce só quando o
  // admin clica em gerar, pela RPC que sorteia o slug e exige PIN (0033).
  const {
    data: people,
    isLoading: loadingPeople,
    error: peopleError,
  } = useQuery({
    queryKey: ["directors-public-links"],
    queryFn: async () => {
      const [list, linkRows] = await Promise.all([
        listPeople(),
        fetchPublicLinks("director_checkpoint"),
      ]);
      const byDirector = new Map(
        linkRows.flatMap(link => link.director_id ? [[link.director_id, link] as const] : []),
      );
      return {
        directors: list
          .filter(person => person.active && person.roles.includes("director"))
          .map<PublicDirector>(director => ({
            ...director,
            public_link: byDirector.get(director.id) ?? null,
          })),
        managers: list.filter(person => person.active && person.roles.includes("manager")),
      };
    },
  });

  /**
   * O que este usuário administra.
   *
   * A 0062 amarrou `create_public_link`, `set_public_link_pin` e as policies de
   * `public_links` ao dono: admin administra tudo, diretor só o próprio link e
   * as equipes sob ele. A tela filtra pela MESMA regra — mostrar a linha de
   * outro diretor com botões que o banco recusa seria o pior dos dois mundos.
   */
  const visibleTeams = useMemo(
    () => (teams ?? []).filter(team => isAdmin || (!!myProfileId && team.director_id === myProfileId)),
    [teams, isAdmin, myProfileId],
  );
  const visibleDirectors = useMemo(
    () => (people?.directors ?? []).filter(director => isAdmin || director.id === myProfileId),
    [people, isAdmin, myProfileId],
  );

  const activeIps = (ips ?? []).filter((row) => row.active).length;
  const withPin = visibleTeams.filter((team) => team.public_link?.has_pin).length;
  // Link criado antes da 0033 pode estar sem PIN. A migration não invalida nada
  // em massa — quem fecha é o admin, e este aviso é o que o faz olhar.
  const openLinks =
    visibleTeams.filter(team => team.public_link && !team.public_link.has_pin).length +
    visibleDirectors.filter(director => director.public_link && !director.public_link.has_pin).length;

  // Vencido e travado são os dois estados em que o link não abre e ninguém era
  // avisado — o gerente ligava reclamando de "PIN incorreto".
  const brokenLinks = [
    ...visibleTeams.map(t => t.public_link),
    ...visibleDirectors.map(d => d.public_link),
  ].filter((link): link is PublicLinkRow => !!link)
   .filter(link => linkExpiry(link.expires_at).tone === "bad" || linkLock(link.locked_until, link.failed_attempts).locked)
   .length;

  const teamsWithoutDirector = isAdmin ? (teams ?? []).filter(team => !team.director_id).length : 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["daily-teams"] });
    qc.invalidateQueries({ queryKey: ["directors-public-links"] });
  };

  const createTeam = async () => {
    const name = newTeam.trim();
    if (!name) return toast({ title: "Informe o nome da equipe", variant: "destructive" });
    // Diretor obrigatório: sem ele a equipe não entra em nenhum checkpoint de
    // diretoria e, na 0062, nem o diretor consegue administrar o link dela.
    const directorId = isAdmin ? newDirector : myProfileId;
    if (!directorId) {
      return toast({
        title: "Escolha o diretor da equipe",
        description: "Sem diretor, a equipe não aparece em nenhum checkpoint da diretoria.",
        variant: "destructive",
      });
    }
    setBusy(true);
    // `teams.slug` é NOT NULL: sem ele o insert era recusado pelo banco.
    const { data, error } = await supabase.from("teams")
      .insert({ name, slug: slugify(name), director_id: directorId, manager_id: newManager || null })
      .select("id");
    setBusy(false);
    if (error) {
      return toast({ title: "Erro ao criar equipe", description: describeError(error, "Não foi possível criar a equipe."), variant: "destructive" });
    }
    // Update/insert barrado por RLS volta 200 sem linha: comemorar aqui seria
    // afirmar um cadastro que não existe.
    if (!data?.length) {
      return toast({
        title: "A equipe não foi criada",
        description: "O banco aceitou a chamada e não gravou linha nenhuma — seu papel não tem permissão de escrita em equipes.",
        variant: "destructive",
      });
    }
    setNewTeam(""); setNewDirector(""); setNewManager(""); setTeamOpen(false);
    toast({ title: "Equipe criada", description: newManager ? undefined : "Sem gerente: as pendências do checkpoint vão mostrar “—”." });
    refresh();
  };

  /**
   * Gera um PIN novo e, se o link ainda não existir, cria o link junto.
   *
   * Um caminho só para equipe e diretoria: o link nasce pela RPC `create_public_link`
   * (slug sorteado, PIN obrigatório, 90 dias de validade) e o PIN de um link já
   * existente é trocado por `set_public_link_pin`. O PIN em claro só existe aqui
   * e no toast — o banco guarda o hash.
   */
  const issuePin = async (
    rowKey: string,
    link: { id: string } | null | undefined,
    owner: { kind: "daily_team"; teamId: string } | { kind: "director_checkpoint"; directorId: string },
  ) => {
    const pin = randomPin();
    setBusy(true);
    const failure = link
      ? (await supabase.rpc("set_public_link_pin", { p_link_id: link.id, p_pin: pin })).error
      : (await createPublicLink({
          p_kind: owner.kind,
          p_pin: pin,
          p_team_id: owner.kind === "daily_team" ? owner.teamId : null,
          p_director_id: owner.kind === "director_checkpoint" ? owner.directorId : null,
        })).error;
    setBusy(false);
    if (failure) return toast({ title: "Erro ao gerar PIN", description: describeError(failure, "Não foi possível gerar o PIN do link."), variant: "destructive" });

    setGeneratedPins(prev => ({ ...prev, [rowKey]: pin }));
    setRevealed(prev => ({ ...prev, [rowKey]: true }));
    toast({
      title: "PIN gerado",
      // "Revalidado" seria falso sucesso: `create_public_link` e
      // `set_public_link_pin` (0062) só repõem os 90 dias quando o link JÁ
      // estava vencido — um link que vence em três dias continua vencendo em
      // três dias. Destravado, sim: PIN novo zera `failed_attempts` e a trava.
      description: `${pin} — anote agora, ele não é exibido de novo. O link foi destravado; a validade só é reposta se já estivesse vencida.`,
    });
    refresh();
  };

  /**
   * Mexe na validade do link: repõe N dias (e destrava o lockout) ou vence o
   * link agora, suspendendo-o sem aposentar a URL.
   *
   * Renovar e destravar andam juntos porque é uma ação só do ponto de vista do
   * admin: o aviso de "links não estão abrindo" mistura vencido e travado, e
   * mandava usar este botão. Renovar só a data devolvia "Validade renovada" com
   * o link ainda recusando o PIN certo pelos 15 minutos restantes — sucesso para
   * uma ação que não resolveu o problema que o próprio aviso apontou.
   *
   * `days = 0` é a SUSPENSÃO: `expires_at` vai para o passado e o link para de
   * abrir na hora, com a URL e o PIN intactos — depois é só escolher um prazo
   * para ele voltar. É diferente de "Desativar", que aposenta a URL de vez e
   * obriga a criar link novo, com slug novo e PIN novo para distribuir. A trava
   * do lockout NÃO é limpa aqui: destravar um link que se acabou de fechar é o
   * oposto do pedido.
   *
   * ponytail: um link suspenso conta na faixa "links não estão abrindo" junto
   * com os que venceram sem querer — os dois estão, de fato, fechados, e o
   * remédio é o mesmo botão. Separar os dois casos pede uma coluna nova em
   * `public_links`; evoluir quando suspender virar rotina e a faixa virar ruído.
   *
   * Update direto porque a policy `public_links_update` (0062) já limita ao
   * dono — uma RPC nova só repetiria a mesma regra num segundo lugar. O
   * `.select("id")` é obrigatório: update barrado por RLS volta 204 sem erro, e
   * sem conferir a linha a tela diria "renovado" para um update que não ocorreu.
   */
  const setValidity = async (linkId: string, days: number) => {
    const suspender = days <= 0;
    // Um minuto no passado, não `now()`: o relógio do navegador e o do Postgres
    // não são o mesmo, e `expires_at > now()` com dois segundos de diferença
    // deixaria o link aberto depois de a tela dizer que fechou.
    const next = new Date(Date.now() + (suspender ? -60_000 : days * DAY_MS)).toISOString();
    setBusy(true);
    const { data, error } = await supabase.from("public_links")
      .update(suspender
        ? { expires_at: next }
        : { expires_at: next, locked_until: null, failed_attempts: 0 })
      .eq("id", linkId).select("id");
    setBusy(false);
    if (error) {
      return toast({
        title: suspender ? "Erro ao suspender o link" : "Erro ao renovar a validade",
        description: describeError(error, "Não foi possível alterar a validade."),
        variant: "destructive",
      });
    }
    if (!data?.length) {
      return toast({
        title: suspender ? "O link não foi suspenso" : "A validade não foi renovada",
        description: "O banco não devolveu a linha: este link é de outro diretor.",
        variant: "destructive",
      });
    }
    toast(suspender
      ? {
          title: "Link suspenso",
          description: "Ele venceu agora e para de abrir imediatamente. A URL e o PIN continuam os mesmos — clique na validade do link e escolha um prazo para reativá-lo.",
        }
      : {
          // O prazo padrão mantém a frase que a tela sempre deu: é o caminho de
          // um clique do botão da linha, e a faixa de "links não estão abrindo"
          // manda usá-lo pelo nome.
          title: days === LINK_VALIDITY_DAYS
            ? "Validade renovada e link destravado"
            : `Validade renovada por ${days} dias — link destravado`,
          description: `O link vale até ${fmtDate(next)} e volta a aceitar o PIN atual agora.`,
        });
    setValidityFor(null);
    refresh();
  };

  /** Aposenta o link: a URL entregue para de abrir na hora, sem tocar no PIN. */
  const revokeLink = async (linkId: string) => {
    setBusy(true);
    const { data, error } = await supabase.from("public_links")
      .update({ active: false }).eq("id", linkId).select("id");
    setBusy(false);
    if (error) return toast({ title: "Erro ao desativar o link", description: describeError(error, "Não foi possível desativar."), variant: "destructive" });
    if (!data?.length) {
      return toast({
        title: "O link não foi desativado",
        description: "O banco não devolveu a linha: este link é de outro diretor.",
        variant: "destructive",
      });
    }
    toast({ title: "Link desativado", description: "A URL antiga não abre mais. Clique em “Criar link” para emitir outra." });
    refresh();
  };

  // Sem link não há URL: o slug é sorteado no banco, não dá para adivinhá-lo
  // a partir do nome como a tela fazia antes. E a origem é a DESTA instalação —
  // era uma constante com o domínio do projeto antigo, então o link copiado
  // apontava para outro lugar enquanto o botão "Ver" abria o certo.
  const publicUrl = (kind: "daily" | "diretor", slug: string) =>
    `${window.location.origin}/${kind}/${slug}`;

  /**
   * Copiar pode falhar (documento sem foco, iframe, origem sem HTTPS) e a
   * promise rejeita em silêncio: o admin lia "Link copiado", colava o link
   * antigo e mandava o errado para o gerente.
   */
  const copy = async (text: string, label = "Link") => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copiado` });
    } catch (e) {
      console.error("admin daily: falha ao copiar", e);
      toast({
        title: `Não consegui copiar o ${label.toLowerCase()}`,
        description: describeError(e, "Selecione o texto ao lado e copie manualmente."),
        variant: "destructive",
      });
    }
  };

  /** "Renovar" invalida na hora o PIN que o gerente já tem: pergunta antes. */
  const confirmIssue = (
    rowKey: string,
    label: string,
    link: PublicLinkRow | null,
    owner: { kind: "daily_team"; teamId: string } | { kind: "director_checkpoint"; directorId: string },
  ) => {
    if (!link?.has_pin) return issuePin(rowKey, link, owner);
    setPending({
      title: `Renovar o PIN de ${label}?`,
      description:
        "O PIN atual para de funcionar imediatamente. Quem estiver com o link precisa do código novo — combine a entrega antes de confirmar. " +
        // O slug é sorteado na criação e o gatilho da 0062 recusa trocá-lo: quem
        // acha que "renovar o PIN" aposenta uma URL vazada continua com a URL
        // vazada valendo, agora com um PIN novo.
        "A URL continua a mesma: para trocar o endereço (link vazado, ou slug antigo e adivinhável), use Desativar e depois Criar link.",
      confirmLabel: "Renovar PIN",
      run: () => issuePin(rowKey, link, owner),
    });
  };

  const confirmRevoke = (label: string, linkId: string) =>
    setPending({
      title: `Desativar o link de ${label}?`,
      description:
        "A URL já entregue para de abrir na hora, para todo mundo. É o caminho para aposentar um link vazado — depois é só criar outro.",
      confirmLabel: "Desativar link",
      run: () => revokeLink(linkId),
    });

  const loadError = teamsError ?? peopleError ?? ipsError;

  return (
    <div className="space-y-3">
      {/* O <h1> sai do kit, como na tela irmã `/admin/allowed-ips` para onde o
          botão ao lado leva: escrito à mão aqui, as duas rotas do mesmo módulo
          abriam com cabeçalhos de altura, tipografia e semântica diferentes. */}
      <PageHeader
        title="Diário — Links, PINs & IPs"
        eyebrow="Administração"
        icon={KeyRound}
        className="mb-0"
        description={isAdmin
          ? "Uma linha por equipe. Compartilhe o link com o gerente."
          : "Suas equipes e o seu link de diretoria. Compartilhe o link com o gerente."}
        actions={
          <>
            <Button size="sm" className="h-8" onClick={() => setTeamOpen(true)}><Plus className="h-3 w-3 mr-1" /> Nova equipe</Button>
            {isAdmin && (
              <Button asChild size="sm" variant="outline" className="h-8"><Link to="/admin/allowed-ips"><Globe className="h-3 w-3 mr-1" /> Gerenciar IPs</Link></Button>
            )}
          </>
        }
      />

      {/* Falha de consulta não pode virar "nada cadastrado": são coisas diferentes. */}
      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p>
            <strong>Não consegui carregar os links.</strong>{" "}
            {describeError(loadError, "Erro de conexão — recarregue a página.")}
          </p>
        </div>
      )}

      {/* KPIs em faixa fina. O terceiro é de admin, como o card de IPs abaixo:
          `allowed_ips_read` (0044) exige `menu.admin_allowed_ips`, e sem ela a
          consulta volta 200 com lista VAZIA — sem erro. O diretor que a 0062
          traz para esta rota leria "IPs ativos 0" como fato. */}
      <div className={`grid gap-2 ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}>
        <KpiMini icon={Users}       label="Equipes"       value={visibleTeams.length} tone="text-info" />
        <KpiMini icon={ShieldCheck} label="Com PIN ativo" value={withPin}             tone="text-success" />
        {isAdmin && <KpiMini icon={Globe} label="IPs ativos" value={activeIps} tone="text-warning" />}
      </div>

      {openLinks > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <p>
            <strong>{openLinks}</strong> {openLinks === 1 ? "link público está" : "links públicos estão"} sem PIN:
            qualquer pessoa com a URL vê os dados. Clique em <em>Gerar PIN</em> na linha correspondente — o link
            continua o mesmo, só passa a pedir o código.
          </p>
        </div>
      )}

      {brokenLinks > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p>
            <strong>{brokenLinks}</strong> {brokenLinks === 1 ? "link não está abrindo" : "links não estão abrindo"} (vencido
            ou travado por 5 PINs errados). Quem está do outro lado vê apenas “PIN incorreto”:
            use <em>Renovar validade</em> ou <em>Renovar PIN</em> — os dois destravam.
          </p>
        </div>
      )}

      {teamsWithoutDirector > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <p>
            <strong>{teamsWithoutDirector}</strong> {teamsWithoutDirector === 1 ? "equipe está" : "equipes estão"} sem
            diretor: não aparecem em nenhum checkpoint de diretoria. Ajuste em <em>Equipes</em>.
          </p>
        </div>
      )}

      {/* Linhas densas de equipes */}
      <Card className="border-border/50">
        <CardContent className="p-0 divide-y divide-border/40">
          {loadingTeams ? (
            <div className="p-3"><LoadingState variant="list" rows={4} label="Carregando equipes…" /></div>
          ) : (
            <>
              {visibleTeams.map((t) => {
                const link = t.public_link;
                const url = link ? publicUrl("daily", link.slug) : null;
                return (
                  // Abaixo de `sm` a linha empilha: nome + URL + PIN + botões somam
                  // ~407 px de mínimo, e a 375 px isso rolava a página inteira na
                  // horizontal antes de espremer o nome e a URL até sumirem.
                  <div key={t.id} className="flex flex-col sm:flex-row sm:items-start gap-2 px-3 py-2 hover:bg-primary/5">
                    <div className="min-w-0 w-full sm:w-48">
                      <p className="text-xs font-semibold truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{link?.slug || "sem link"}</p>
                      {!t.director_id && (
                        <p className="text-xs text-warning">sem diretor — fora do checkpoint</p>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <LinkCell url={url} onCopy={copy} />
                      <LinkHealth
                        link={link}
                        label={t.name}
                        onChangeValidity={() => link && setValidityFor({ id: link.id, label: t.name, expiresAt: link.expires_at })}
                      />
                    </div>

                    <PinCell
                      label={t.name}
                      hasPin={!!link?.has_pin}
                      hasLink={!!link}
                      pinSetAt={link?.pin_set_at ?? null}
                      plain={generatedPins[t.id] ?? null}
                      isShown={!!revealed[t.id]}
                      onToggle={() => setRevealed(p => ({ ...p, [t.id]: !p[t.id] }))}
                      onCopy={copy}
                    />

                    {/* `disabled` num `<a>` não desabilita nada (`:disabled` só casa com
                        controle de formulário): sem link, o botão simplesmente não existe —
                        o LinkCell ao lado já explica o estado. E a tela pública pede o PIN
                        de todo mundo, admin inclusive: quem quer os números sem PIN usa
                        /checkpoint.

                        Todo controle da linha diz DE QUEM é o link no nome acessível, como
                        LinkHealth e PinCell já faziam: numa lista de dez equipes, quatro
                        botões chamados só "Renovar validade" e "Desativar" mandam quem usa
                        leitor de tela adivinhar a linha pela ordem do foco. O texto visível
                        continua curto e entra inteiro no rótulo (a regra de "rótulo no
                        nome", que é o que faz o comando de voz funcionar). */}
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {url && (
                        <Button asChild size="sm" variant="outline" className="h-7 px-2" title="Abrir o daily desta equipe (pede o PIN)">
                          <a href={url} target="_blank" rel="noreferrer" aria-label={`Ver o Diário de ${t.name} (pede o PIN)`}><ExternalLink /> Ver</a>
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy}
                        aria-label={`${link ? (link.has_pin ? "Renovar PIN" : "Gerar PIN") : "Criar link"} de ${t.name}`}
                        onClick={() => confirmIssue(t.id, t.name, link, { kind: "daily_team", teamId: t.id })}>
                        <RefreshCw /> {link ? (link.has_pin ? "Renovar PIN" : "Gerar PIN") : "Criar link"}
                      </Button>
                      {link && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy}
                            aria-label={`Renovar validade do link de ${t.name}`}
                            title={`Repõe ${LINK_VALIDITY_DAYS} dias de validade — outro prazo, na própria validade ao lado`}
                            onClick={() => setValidity(link.id, LINK_VALIDITY_DAYS)}>
                            <CalendarClock /> Renovar validade
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={busy}
                            aria-label={`Desativar o link de ${t.name}`}
                            onClick={() => confirmRevoke(t.name, link.id)}>
                            <Ban /> Desativar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleTeams.length === 0 && !loadError && (
                <EmptyState
                  className="border-0 bg-transparent"
                  icon={Users}
                  title={isAdmin ? "Nenhuma equipe cadastrada" : "Nenhuma equipe sob a sua diretoria"}
                  description="Crie a primeira equipe para emitir o link do Diário."
                  action={<Button size="sm" onClick={() => setTeamOpen(true)}><Plus className="h-3 w-3 mr-1" /> Nova equipe</Button>}
                />
              )}
            </>
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
            {loadingPeople ? (
              <div className="p-3"><LoadingState variant="list" rows={2} label="Carregando diretores…" /></div>
            ) : (
              <>
                {visibleDirectors.map((d) => {
                  const link = d.public_link;
                  const url = link ? publicUrl("diretor", link.slug) : null;
                  return (
                    <div key={d.id} className="flex flex-col sm:flex-row sm:items-start gap-2 px-3 py-2 text-xs">
                      <div className="w-full sm:w-48 truncate font-semibold">{d.name}</div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <LinkCell url={url} onCopy={copy} />
                        <LinkHealth
                          link={link}
                          label={d.name}
                          onChangeValidity={() => link && setValidityFor({ id: link.id, label: d.name, expiresAt: link.expires_at })}
                        />
                      </div>
                      <PinCell
                        label={d.name}
                        hasPin={!!link?.has_pin}
                        hasLink={!!link}
                        pinSetAt={link?.pin_set_at ?? null}
                        plain={generatedPins[`dir-${d.id}`] ?? null}
                        isShown={!!revealed[`dir-${d.id}`]}
                        onToggle={() => setRevealed(p => ({ ...p, [`dir-${d.id}`]: !p[`dir-${d.id}`] }))}
                        onCopy={copy}
                      />
                      {/* Mesma regra da tabela de equipes: o nome acessível diz de quem
                          é o link. Aqui a lista é de diretores. */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {url && (
                          <Button asChild size="sm" variant="outline" className="h-7 px-2" title="Abrir o checkpoint deste diretor (pede o PIN)">
                            <a href={url} target="_blank" rel="noreferrer" aria-label={`Ver o checkpoint de ${d.name} (pede o PIN)`}><ExternalLink /> Ver</a>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy}
                          aria-label={`${link ? (link.has_pin ? "Renovar PIN" : "Gerar PIN") : "Criar link"} de ${d.name}`}
                          onClick={() => confirmIssue(`dir-${d.id}`, d.name, link, { kind: "director_checkpoint", directorId: d.id })}>
                          <RefreshCw />
                          {link ? (link.has_pin ? "Renovar PIN" : "Gerar PIN") : "Criar link"}
                        </Button>
                        {link && (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy}
                              aria-label={`Renovar validade do link de ${d.name}`}
                              title={`Repõe ${LINK_VALIDITY_DAYS} dias de validade — outro prazo, na própria validade ao lado`}
                              onClick={() => setValidity(link.id, LINK_VALIDITY_DAYS)}>
                              <CalendarClock /> Renovar validade
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={busy}
                              aria-label={`Desativar o link de ${d.name}`}
                              onClick={() => confirmRevoke(d.name, link.id)}>
                              <Ban /> Desativar
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {visibleDirectors.length === 0 && !loadError && (
                  <EmptyState
                    className="border-0 bg-transparent"
                    icon={Link2}
                    title="Nenhum diretor cadastrado"
                    description="O checkpoint semanal sai do link de um diretor — cadastre um em Pessoas."
                  />
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bloco compacto de IPs (top 6) — o IP é regra de check-in, coisa de admin. */}
      {isAdmin && (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="px-3 py-2 flex items-center justify-between border-b border-border/40">
              <div className="text-xs font-semibold flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-primary" /> IPs autorizados (últimos)</div>
              <Link to="/admin/allowed-ips" className="text-xs text-primary hover:underline">Ver todos</Link>
            </div>
            <div className="divide-y divide-border/40">
              {(ips ?? []).slice(0, 6).map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <code className="font-mono">{String(r.ip_range)}</code>
                  <span className="text-muted-foreground truncate flex-1">{r.label || "—"}</span>
                  <Badge variant={r.active ? "default" : "secondary"} size="sm">{r.active ? "ativo" : "inativo"}</Badge>
                </div>
              ))}
              {(ips ?? []).length === 0 && !ipsError && (
                <EmptyState
                  className="border-0 bg-transparent"
                  icon={Globe}
                  title="Nenhum IP cadastrado"
                  description="Sem faixa liberada, o check-in por IP não aceita ninguém."
                  action={<Button asChild size="sm" variant="outline"><Link to="/admin/allowed-ips">Gerenciar IPs</Link></Button>}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Nova equipe: nome + diretor + gerente. Inserir só o nome deixava a
          equipe fora de todo checkpoint e com "Gerente: —" nas pendências. */}
      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova equipe</DialogTitle>
            <DialogDescription className="text-xs">
              O diretor define de qual checkpoint a equipe faz parte; o gerente é o nome que aparece
              na cobrança das pendências.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-team-name" className="text-xs">Nome da equipe</Label>
              <Input id="new-team-name" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Ex.: Equipe Paulista" className="h-8 text-xs" />
            </div>

            {isAdmin ? (
              <div className="space-y-1">
                <Label htmlFor="new-team-director" className="text-xs">Diretor</Label>
                <Select value={newDirector || undefined} onValueChange={setNewDirector}>
                  <SelectTrigger id="new-team-director" className="h-8 text-xs"><SelectValue placeholder="Escolha o diretor" /></SelectTrigger>
                  <SelectContent>
                    {(people?.directors ?? []).map(d => (
                      <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">A equipe nasce sob a sua diretoria.</p>
            )}

            <div className="space-y-1">
              <Label htmlFor="new-team-manager" className="text-xs">Gerente (opcional)</Label>
              <Select value={newManager || undefined} onValueChange={setNewManager}>
                <SelectTrigger id="new-team-manager" className="h-8 text-xs"><SelectValue placeholder="Sem gerente" /></SelectTrigger>
                <SelectContent>
                  {(people?.managers ?? []).map(m => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Sem gerente, as pendências do checkpoint mostram “—”.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTeamOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={createTeam} disabled={busy || !newTeam.trim()}>Criar equipe</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Validade: prazo escolhido, ou vencimento na hora. Aberto pela própria
          validade exibida na linha (LinkHealth), e um diálogo só para as duas
          tabelas — a linha já carrega quatro botões e um quinto por prazo a
          quebraria em três fileiras a 375 px. */}
      <Dialog open={!!validityFor} onOpenChange={(open) => !open && setValidityFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Validade do link — {validityFor?.label}</DialogTitle>
            <DialogDescription className="text-xs">
              {validityFor?.expiresAt
                ? <>Hoje: <b>{linkExpiry(validityFor.expiresAt).label.toLowerCase()}</b>. O prazo escolhido conta a partir de agora e destrava o link.</>
                : <>Este link não tem prazo — escolha um. Link sem validade e sem revogação nunca fecha depois de vazar.</>}
              {" "}O botão <em>Renovar validade</em> da linha faz direto os {LINK_VALIDITY_DAYS} dias padrão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {VALIDITY_OPTIONS.map((days) => (
              <Button
                key={days}
                variant={days === LINK_VALIDITY_DAYS ? "default" : "outline"}
                size="sm"
                className="w-full justify-between"
                disabled={busy}
                onClick={() => validityFor && setValidity(validityFor.id, days)}
              >
                <span>{days} dias{days === LINK_VALIDITY_DAYS ? " (padrão)" : ""}</span>
                <span className="text-xs opacity-80">até {fmtDate(new Date(Date.now() + days * DAY_MS))}</span>
              </Button>
            ))}
            <div className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
              <p className="text-muted-foreground">
                <b className="text-warning">Vencer agora</b> suspende o link: ele para de abrir na hora e a
                URL e o PIN continuam valendo — volte aqui e escolha um prazo para reativá-lo.
                Para aposentar de vez uma URL vazada, use <em>Desativar</em>, que obriga a criar link novo.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-1.5 text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => validityFor && setValidity(validityFor.id, 0)}
              >
                <Ban /> Vencer agora (suspender)
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setValidityFor(null)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pending;
                setPending(null);
                void action?.run();
              }}
            >
              {pending?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Célula do link. Sem link não há URL para mostrar — o slug é sorteado no banco. */
function LinkCell({ url, onCopy }: { url: string | null; onCopy: (text: string, label?: string) => void }) {
  if (!url) {
    return (
      <div className="min-w-0 text-xs text-muted-foreground px-2 py-1">
        Sem link público — clique em “Criar link”.
      </div>
    );
  }
  return (
    <div className="min-w-0 flex items-center gap-1.5 text-xs font-mono bg-muted/30 rounded px-2 py-1">
      <Link2 className="h-3 w-3 text-primary shrink-0" />
      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
      <button onClick={() => onCopy(url)} className="ml-auto hover:text-primary shrink-0" title="Copiar link" aria-label="Copiar link público">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * Validade e trava — os dois motivos pelos quais um link para de abrir sem que
 * ninguém do lado de cá saiba. A recusa é a mesma de PIN errado, de propósito
 * (0033): o remédio tem que estar aqui, não na tela pública.
 */
function LinkHealth({ link, label, onChangeValidity }: {
  link: PublicLinkRow | null;
  /** Nome da equipe ou do diretor — entra no nome acessível do botão. */
  label: string;
  onChangeValidity: () => void;
}) {
  if (!link) return null;
  const expiry = linkExpiry(link.expires_at);
  const lock = linkLock(link.locked_until, link.failed_attempts);
  const expiryClass =
    expiry.tone === "bad" ? "text-destructive" : expiry.tone === "warn" ? "text-warning" : "text-muted-foreground";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 text-xs">
      {/* A validade é o estado; o botão da linha repõe o prazo padrão de um
          clique. Prazo diferente e suspensão ficam AQUI, no próprio estado, e
          não num quinto botão: a linha já carrega quatro e a 375 px eles
          quebram em duas fileiras. */}
      <button
        type="button"
        onClick={onChangeValidity}
        aria-label={`Alterar a validade do link de ${label} — ${expiry.label}`}
        className={`flex items-center gap-1 rounded underline decoration-dotted underline-offset-2 hover:text-primary ${expiryClass}`}
      >
        <CalendarClock className="h-3 w-3" /> {expiry.label} · alterar
      </button>
      {lock.label && (
        <span className={`flex items-center gap-1 ${lock.locked ? "text-destructive" : "text-warning"}`}>
          <Lock className="h-3 w-3" /> {lock.label}
        </span>
      )}
    </div>
  );
}

/**
 * Estado do PIN. "Sem PIN" é aviso, não rótulo neutro: link público sem PIN é
 * a operação da equipe (ou da diretoria) aberta a quem tiver a URL.
 */
function PinCell({ label, hasPin, hasLink, pinSetAt, plain, isShown, onToggle, onCopy }: {
  /** Nome da equipe ou do diretor — entra no nome acessível dos botões. */
  label: string;
  hasPin: boolean;
  hasLink: boolean;
  /** Quando o PIN atual foi gravado (0062). Null em link anterior à migration. */
  pinSetAt: string | null;
  plain: string | null;
  isShown: boolean;
  onToggle: () => void;
  onCopy: (text: string, label?: string) => void;
}) {
  return (
    <div className="w-full sm:w-44 sm:shrink-0">
      <div className="flex items-center gap-1.5">
        {!hasLink ? (
          <Badge variant="outline" size="sm">Sem link</Badge>
        ) : hasPin ? (
          <Badge variant="default" size="sm">PIN</Badge>
        ) : (
          <Badge variant="outline" size="sm" className="border-warning text-warning" title="Link aberto: qualquer pessoa com a URL vê os dados">
            <AlertTriangle className="h-2.5 w-2.5" /> Sem PIN
          </Badge>
        )}
        {plain && (
          <>
            <span className="font-mono text-xs tracking-widest">{isShown ? plain : "••••••"}</span>
            <button onClick={onToggle} className="hover:text-primary" title={isShown ? "Ocultar" : "Mostrar"} aria-label={`${isShown ? "Ocultar" : "Mostrar"} PIN de ${label}`}>
              {isShown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
            <button onClick={() => onCopy(plain, "PIN")} className="hover:text-primary" title="Copiar PIN" aria-label={`Copiar PIN de ${label}`}>
              <Copy className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {hasPin && (
        pinSetAt
          ? (() => {
              // Não existe rotação automática, e nem deveria: trocar o PIN
              // sozinho fecharia o link na cara do gerente sem ninguém para
              // entregar o código novo. O que faltava era o LEMBRETE — a data
              // sozinha não diz nada a quem lê uma lista de dez linhas.
              const dias = Math.floor((Date.now() - new Date(pinSetAt).getTime()) / 86_400_000);
              const velho = dias >= PIN_MAX_AGE_DAYS;
              return (
                <p className={`text-xs mt-0.5 ${velho ? "text-warning" : "text-muted-foreground"}`}>
                  trocado em {fmtDate(pinSetAt)}
                  {velho && ` — há ${dias} dias, renove`}
                </p>
              );
            })()
          // Link anterior à 0062: o PIN existe e a data da troca não. Deixar a
          // linha em branco fazia o link mais antigo (justamente o que mais
          // precisa girar) parecer o mais bem cuidado da lista.
          : <p className="text-xs text-warning mt-0.5">sem data de troca — renove para datar</p>
      )}
    </div>
  );
}

function KpiMini({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="px-3 py-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <div className="min-w-0">
          <p className="text-eyebrow leading-none">{label}</p>
          <p className={`text-lg font-bold leading-tight ${tone}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
