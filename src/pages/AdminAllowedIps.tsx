import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Globe, Loader2, Radar, ShieldCheck, ShieldAlert, ShieldOff, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  checkIpAllowed, listIpBypassProfiles, listObservedCheckinIps, setIpBypass,
  type BypassProfile, type IpCoverage, type ObservedIp,
} from "@/integrations/supabase/checkin";
import { listPeople, type PersonRecord } from "@/integrations/supabase/newSchema";
import { describeError } from "@/lib/supabaseError";
import { dateTime, num } from "@/lib/format";
import { EmptyState, LoadingState, PageHeader, SectionCard } from "@/components/shared";

type Ip = {
  id: string;
  ip_range: string;
  label: string;
  active: boolean;
  created_at: string;
  team_id: string | null;
  /** Embed pela FK `allowed_ips_team_id_fkey`; null = faixa global. */
  team: { name: string } | null;
};
type Team = { id: string; name: string };

/** Valor do Select para "todas as equipes" — o Radix não aceita "" como item. */
const ALL_TEAMS = "__all__";

/**
 * Prefixo declarado na entrada. Host sem "/" é /32 em IPv4 e /128 em IPv6 — a
 * mesma normalização que o `add()` faz antes de gravar.
 */
const prefixoDe = (valor: string) => {
  const [endereco, mascara] = valor.split("/");
  const v6 = endereco.includes(":");
  const bits = mascara === undefined ? (v6 ? 128 : 32) : Number(mascara);
  return { v6, bits: Number.isFinite(bits) ? bits : (v6 ? 128 : 32) };
};

/**
 * Faixa larga demais para ser a rede de uma unidade.
 *
 * /24 em IPv4 são 256 endereços — o tamanho típico da rede de uma loja. /48 em
 * IPv6 é o bloco que um provedor costuma delegar a um cliente. Abaixo disso, a
 * faixa passa a liberar o check-in de gente que não está na unidade, que é
 * exatamente o que a trava da ata de 14/07 existe para impedir. O banco recusa
 * só o /0; do /0 ao /23 quem decide é o admin — mas de olhos abertos.
 */
const faixaLarga = (valor: string) => {
  const { v6, bits } = prefixoDe(valor);
  return bits < (v6 ? 48 : 24);
};

/**
 * O tipo `cidr` do Postgres recusa entrada malformada com 22P02, e o
 * `describeError` traduz para "Um dos campos está em formato inválido" — que
 * não diz QUAL formato serve. Numa tela de segurança, o admin precisa do
 * exemplo, inclusive o de IPv6: o gateway pode enxergar o corretor em v6.
 */
const FORMATO_INVALIDO =
  "Endereço inválido. Use IPv4 (200.150.10.5), IPv6 (2804:14c:5b81:8000::1) ou uma faixa CIDR (200.150.10.0/24, 2804:14c:5b81::/48).";

export default function AdminAllowedIps() {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<Ip[]>([]);
  // Sem isto a tela afirmava "Nenhum IP cadastrado." antes da primeira resposta
  // — e continuava afirmando depois de a leitura falhar, com o toast já sumido.
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [teams, setTeams] = useState<Team[]>([]);
  const [ip, setIp] = useState("");
  const [label, setLabel] = useState("");
  const [teamId, setTeamId] = useState(ALL_TEAMS);
  // Enquanto a gravação está em voo a tela não mudava nada: o admin clicava de
  // novo e criava a mesma faixa duas vezes (não há unique em `ip_range`).
  const [salvando, setSalvando] = useState(false);
  const [myIp, setMyIp] = useState<string | null>(null);
  // A detecção depende de um serviço externo (api.ipify.org). Falha silenciosa
  // fazia a linha "atual:" simplesmente não aparecer, sem o admin saber por quê.
  const [ipDetectError, setIpDetectError] = useState<string | null>(null);
  // `ip_is_allowed` avalia faixa CIDR e bypass do perfil — comparar strings na
  // tela diria "não cadastrado" para um IP já coberto por 200.150.10.0/24.
  const [myIpCoverage, setMyIpCoverage] = useState<IpCoverage | null>(null);
  // Liberação individual de IP: a exceção à trava antifraude. Sem tela, ela só
  // era mexida por UPDATE direto no banco e ninguém via quem já estava isento.
  const [bypass, setBypass] = useState<BypassProfile[]>([]);
  // Mesmo motivo do `estado` da lista de IPs: "Ninguém está isento" é afirmação
  // positiva sobre a trava antifraude e não pode ser dita antes da resposta nem
  // depois de a leitura falhar.
  const [estadoBypass, setEstadoBypass] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [bypassAlvo, setBypassAlvo] = useState("");
  const [bypassSalvando, setBypassSalvando] = useState(false);
  // O que o SERVIDOR gravou nos check-ins (`checkins.ip_address`). É a única
  // resposta que não depende de api.ipify.org — que só fala IPv4 — nem de
  // suposição sobre qual cabeçalho a hospedagem usa.
  const [observados, setObservados] = useState<ObservedIp[]>([]);
  const [estadoObservados, setEstadoObservados] = useState<"carregando" | "pronto" | "erro">("carregando");

  const load = async () => {
    // `team_id` decide se a faixa vale para todo mundo ou só para membros da
    // equipe (`ip_is_allowed`); sem o nome ao lado, faixa restrita parecia global.
    const [ips, teamRows] = await Promise.all([
      supabase.from("allowed_ips").select("*, team:teams(name)").order("created_at", { ascending: false }),
      supabase.from("teams").select("id,name").eq("active", true).order("name"),
    ]);
    if (ips.error) {
      setEstado("erro");
      return toast.error(describeError(ips.error, "Não foi possível carregar os IPs."));
    }
    if (teamRows.error) {
      setEstado("erro");
      return toast.error(describeError(teamRows.error, "Não foi possível carregar as equipes."));
    }
    setRows((ips.data ?? []).map((row) => ({ ...row, ip_range: String(row.ip_range) })));
    setTeams(teamRows.data ?? []);
    setEstado("pronto");
  };

  /**
   * Quem está isento da trava de IP. Só admin escreve; o RLS confirma.
   *
   * As duas leituras são independentes (`allSettled`): com `Promise.all`, uma
   * falha em `listPeople` — que só alimenta o seletor de quem liberar — jogava
   * fora a lista de isentos que já tinha voltado certa, e a tela passava a
   * afirmar que ninguém está isento.
   */
  const loadBypass = async () => {
    setEstadoBypass("carregando");
    const [isentos, pessoas] = await Promise.allSettled([listIpBypassProfiles(), listPeople()]);
    if (isentos.status === "fulfilled") {
      setBypass(isentos.value);
      setEstadoBypass("pronto");
    } else {
      setEstadoBypass("erro");
      toast.error(describeError(isentos.reason, "Não foi possível carregar as liberações individuais."));
    }
    if (pessoas.status === "fulfilled") {
      setPeople(pessoas.value.filter((p) => p.active));
    } else {
      toast.error(describeError(pessoas.reason, "Não foi possível carregar as pessoas para liberar."));
    }
  };

  /** Detecta o IP de saída. O motivo da falha precisa chegar à tela. */
  const detectarIp = async (): Promise<string | null> => {
    try {
      const d = await fetch("https://api.ipify.org?format=json").then((r) => r.json());
      setMyIp(d.ip);
      setIpDetectError(null);
      return d.ip as string;
    } catch {
      // Sem limpar, uma segunda detecção que falha mantinha na tela o IP da
      // primeira: "atual: <endereço antigo>" apresentado como o de agora, numa
      // tela de antifraude, com o aviso escondido atrás de `!myIp`.
      setMyIp(null);
      setIpDetectError(
        "Não consegui detectar seu IP: o serviço externo api.ipify.org não respondeu (rede, bloqueio ou offline). Digite o endereço manualmente.",
      );
      return null;
    }
  };

  /** Endereços que o gateway realmente entregou ao banco. */
  const loadObservados = async () => {
    setEstadoObservados("carregando");
    try {
      setObservados(await listObservedCheckinIps());
      setEstadoObservados("pronto");
    } catch (e) {
      setEstadoObservados("erro");
      toast.error(describeError(e, "Não foi possível ler os endereços dos check-ins."));
    }
  };

  useEffect(() => {
    load();
    void detectarIp();
    void loadBypass();
    void loadObservados();
  }, []);

  const add = async () => {
    // Clique sem IP era um nada silencioso — numa tela de segurança o admin
    // sai achando que cadastrou.
    if (!ip.trim()) return toast.error("Informe o IP ou a faixa CIDR (ex: 200.150.10.0/24).");
    // Host sem máscara vira /32 em IPv4 e /128 em IPv6 — sem isso, um endereço
    // v6 digitado sem "/" virava `.../32`, que em IPv6 é um bloco gigantesco.
    const bruto = ip.trim();
    const ipRange = bruto.includes("/") ? bruto : `${bruto}/${bruto.includes(":") ? 128 : 32}`;
    // Faixa larga libera o check-in de fora da unidade. O banco só recusa /0;
    // daqui até /23 é decisão do admin, mas não pode ser decisão distraída.
    if (faixaLarga(ipRange) && !confirm(
      `${ipRange} é uma faixa larga: ela libera o check-in de muitos endereços, inclusive fora da unidade. Confirmar mesmo assim?`,
    )) return;
    setSalvando(true);
    try {
      const { error } = await supabase.from("allowed_ips").insert({
        ip_range: ipRange,
        label: label.trim() || "IP autorizado",
        team_id: teamId === ALL_TEAMS ? null : teamId,
      });
      if (error) {
        return toast.error(
          error.code === "22P02" ? FORMATO_INVALIDO
          // `allowed_ips_range_team_uidx` (0075): a mesma faixa entrava duas
          // vezes e desativar uma delas não desativava a gêmea.
          : error.code === "23505" ? "Esta faixa já está cadastrada para esta equipe. Procure-a na lista abaixo em vez de criar outra."
          : describeError(error, "Não foi possível autorizar o IP."),
        );
      }
      toast.success("IP autorizado.");
      setIp(""); setLabel(""); setTeamId(ALL_TEAMS);
      await load();
    } finally {
      setSalvando(false);
    }
  };
  // Reavalia a cobertura sempre que a lista ou o IP detectado mudam.
  useEffect(() => {
    if (!myIp || !user?.id) { setMyIpCoverage(null); return; }
    checkIpAllowed(myIp, user.id).then(setMyIpCoverage).catch((e) => {
      setMyIpCoverage(null);
      toast.error(describeError(e, "Não foi possível conferir se o seu IP está coberto."));
    });
  }, [myIp, user?.id, rows]);

  const remove = async (id: string) => {
    if (!confirm("Remover este IP?")) return;
    const { error } = await supabase.from("allowed_ips").delete().eq("id", id);
    if (error) return toast.error(describeError(error, "Não foi possível remover o IP."));
    load();
  };
  /**
   * Liga/desliga a liberação individual.
   *
   * A confirmação existe porque o efeito não é local: com o bypass ligado o
   * corretor bate ponto de QUALQUER endereço, o que anula a trava da ata de
   * 14/07 para ele.
   */
  const alterarBypass = async (profileId: string, nome: string, enabled: boolean) => {
    if (enabled && !confirm(`Liberar ${nome} da validação de IP? Ele poderá bater ponto de qualquer endereço.`)) return;
    setBypassSalvando(true);
    try {
      await setIpBypass(profileId, enabled);
      toast.success(enabled ? `${nome} liberado da validação de IP.` : `${nome} voltou a depender das faixas cadastradas.`);
      setBypassAlvo("");
      await loadBypass();
      // A cobertura do próprio IP muda se o admin mexeu no próprio bypass.
      if (profileId === user?.id && myIp) {
        await checkIpAllowed(myIp, profileId).then(setMyIpCoverage).catch(() => setMyIpCoverage(null));
      }
    } catch (e) {
      toast.error(describeError(e, "Não foi possível alterar a liberação individual."));
    } finally {
      setBypassSalvando(false);
    }
  };

  /**
   * Liga/desliga uma faixa.
   *
   * REATIVAR uma faixa larga é o clique mais perigoso desta tela — era um selo
   * sem confirmação nenhuma, e a homologação tinha uma `0.0.0.0/0` desativada
   * esperando por ele. A /0 hoje o banco recusa (0075); o aviso aqui cobre o
   * resto do intervalo, que continua sendo decisão do admin.
   */
  const toggle = async (row: Ip) => {
    const ativando = !row.active;
    if (ativando && faixaLarga(row.ip_range) && !confirm(
      `Reativar ${row.ip_range}? É uma faixa larga: o check-in volta a ser liberado para muitos endereços, inclusive fora da unidade.`,
    )) return;
    const { error } = await supabase.from("allowed_ips").update({ active: ativando }).eq("id", row.id);
    if (error) return toast.error(describeError(error, "Não foi possível alterar o status do IP."));
    load();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Kit compartilhado: o <h1> vem do PageHeader, com o <header> semântico e
          a escala `text-2xl sm:text-3xl` que o resto do app usa — escrito à mão
          aqui, o título ficava fixo em `text-2xl` e fora do <header>. */}
      <PageHeader
        title="IPs autorizados para check-in"
        eyebrow="Administração"
        icon={Globe}
        description="Apenas usuários conectados a partir destes IPs poderão fazer check-in."
      />

      {!isAdmin && (
        <p className="text-xs text-warning">
          Você está vendo a lista em modo leitura — só administradores cadastram,
          desativam ou removem IPs (o banco recusa a escrita pelo RLS, não só a tela).
        </p>
      )}

      <SectionCard title="Adicionar IP" icon={Plus} contentClassName="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button size="sm" variant="secondary" onClick={async () => {
              const detectado = await detectarIp();
              if (detectado) {
                setIp(detectado);
                toast.success(`Seu IP: ${detectado}`);
              } else {
                toast.error("Não foi possível detectar o IP — o serviço externo não respondeu.");
              }
            }}>
              <Globe className="h-4 w-4 mr-1" /> Descobrir meu IP
            </Button>
            {myIp && (
              <span className="text-muted-foreground">
                atual: <code className="px-1 py-0.5 bg-muted rounded">{myIp}</code>
              </span>
            )}
            {!myIp && ipDetectError && (
              <span className="flex items-center gap-1 text-warning">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> {ipDetectError}
              </span>
            )}
            {/* Com bypass no próprio perfil, `ip_is_allowed` diz true para
                qualquer IP — o selo verde mentiria "faixa cadastrada". */}
            {myIp && myIpCoverage?.bypass && (
              <span className="text-warning flex items-center gap-1">
                <ShieldOff className="h-3.5 w-3.5" /> seu perfil tem liberação individual de IP (bypass):
                este teste não diz se há faixa cadastrada — cadastre o IP da loja mesmo assim
              </span>
            )}
            {myIp && myIpCoverage && !myIpCoverage.bypass && myIpCoverage.allowed && (
              <span className="text-success flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> já coberto por uma faixa cadastrada
              </span>
            )}
            {myIp && myIpCoverage && !myIpCoverage.bypass && !myIpCoverage.allowed && (
              <span className="text-warning flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" /> não coberto — o check-in daqui seria barrado
              </span>
            )}
            {/* Quem decide o check-in é o endereço que o GATEWAY entrega, não o
                que o detector externo devolve. `api.ipify.org` só responde em
                IPv4: se o gateway enxergar o corretor em IPv6, a faixa v4
                cadastrada aqui nunca casa e ninguém entende por quê. */}
            {myIp && !myIp.includes(":") && (
              <span className="w-full text-muted-foreground">
                O detector externo responde só em IPv4. Se o gateway enxergar o acesso em IPv6, uma faixa
                v4 cadastrada aqui nunca vai casar — confira em “Endereços vistos pelo servidor”, abaixo,
                o que o banco realmente gravou nos check-ins.
              </span>
            )}
          </div>
          {/* Rótulo visível, não placeholder: o placeholder some no primeiro
              caractere digitado e o campo fica sem nome — para quem usa leitor
              de tela e para quem só voltou ao formulário depois (WCAG 3.3.2). */}
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="allowed-ip-range">IP ou faixa CIDR</Label>
              <Input
                id="allowed-ip-range"
                placeholder="Ex: 200.150.10.5"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="allowed-ip-label">Descrição</Label>
              <Input
                id="allowed-ip-label"
                placeholder="Ex: Escritório sede"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1 md:w-56">
              <Label htmlFor="allowed-ip-team">Equipe</Label>
              <Select value={teamId} onValueChange={setTeamId} disabled={!isAdmin}>
                <SelectTrigger id="allowed-ip-team" aria-label="Equipe" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TEAMS}>Todas as equipes</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={add} disabled={!isAdmin || salvando} aria-busy={salvando}>
              {salvando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Faixa restrita a uma equipe só libera o check-in de quem é membro dela.
          </p>
      </SectionCard>

      {/* Contar antes da resposta anunciava "Lista (0)" com faixas no banco —
          e o ramo de erro sai do `load()` sem tocar em `rows`, então proteger
          só o carregamento deixava "Lista (0)" em cima do estado de erro. O
          número só existe quando o banco respondeu. */}
      <SectionCard title={estado === "pronto" ? `Lista (${rows.length})` : "Lista"} icon={Globe}>
          <div className="space-y-2">
            {estado === "carregando" && (
              <LoadingState variant="list" rows={3} label="Carregando IPs autorizados…" />
            )}
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 border rounded-lg p-3">
                <code className="font-mono text-sm">{r.ip_range}</code>
                <span className="text-sm text-muted-foreground flex-1">{r.label || "—"}</span>
                <span className="text-xs text-muted-foreground">{r.team ? `só ${r.team.name}` : "todas as equipes"}</span>
                <button
                  type="button"
                  className="rounded-full disabled:cursor-not-allowed"
                  onClick={() => toggle(r)}
                  disabled={!isAdmin}
                  aria-label={`${r.active ? "Desativar" : "Ativar"} ${r.ip_range}`}
                >
                  <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "ativo" : "inativo"}</Badge>
                </button>
                <Button size="icon" variant="ghost" onClick={() => remove(r.id)} disabled={!isAdmin} aria-label={`Remover ${r.ip_range}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {/* Vazio por erro e vazio de verdade não podem dar a mesma tela: a
                primeira versão dizia "Nenhum IP cadastrado." depois de a
                leitura falhar, com o toast já sumido. */}
            {estado === "erro" && rows.length === 0 && (
              <EmptyState
                tone="danger"
                icon={ShieldAlert}
                title="Não foi possível carregar a lista"
                description="A lista está vazia por erro de leitura, não porque não há faixas cadastradas. Não conclua nada sobre o check-in a partir desta tela."
                action={<Button variant="outline" onClick={load}>Tentar de novo</Button>}
              />
            )}
            {estado === "pronto" && rows.length === 0 && (
              // Sem ressalva por papel: `allowed_ips_read` (0044) é
              // `has_permission('menu.admin_allowed_ips')`, a MESMA permissão
              // que `RequirePermission` exige para abrir esta rota — quem
              // enxerga a tela lê a tabela inteira. Dizer "depende da permissão
              // do seu papel" escondia do não-admin justamente o aviso que
              // importa numa tela antifraude: sem faixa, ninguém bate ponto.
              <EmptyState
                icon={Globe}
                title="Nenhum IP cadastrado"
                description={`Sem faixa cadastrada, o check-in por IP não libera ninguém.${
                  isAdmin ? "" : " Peça a um administrador para cadastrar a faixa da unidade."}`}
              />
            )}
          </div>
      </SectionCard>

      {/* Endereços que o SERVIDOR gravou (`checkins.ip_address`).

          Duas perguntas que nenhuma outra parte desta tela responde:
          · em que família o gateway enxerga a operação (v4 ou v6) — o detector
            externo só fala IPv4, e uma faixa v4 cadastrada contra um gateway v6
            nunca casa;
          · se a leitura do cabeçalho no `broker-checkin` continua certa — a
            escolha é específica da hospedagem e já esteve errada uma vez
            (correção de 10/08). Endereço estranho aqui é o primeiro sinal.

          Todo endereço desta lista foi ACEITO no momento do check-in: a RPC
          recusa IP não autorizado. Um endereço aqui que não esteja coberto por
          nenhuma faixa acima entrou pela liberação individual. */}
      <SectionCard
        icon={Radar}
        title={`Endereços vistos pelo servidor${estadoObservados === "pronto" ? ` (${num(observados.length)})` : ""}`}
        contentClassName="space-y-3"
      >
          <p className="text-xs text-muted-foreground">
            O que o gateway entregou ao banco nos check-ins recentes — não o que um serviço externo
            devolve. É a resposta certa para “qual endereço eu preciso cadastrar”. Todos foram aceitos
            na hora do check-in: um que não esteja coberto pelas faixas acima entrou por liberação
            individual.
            {!isAdmin && " Esta lista é recortada pelo seu papel: aparecem só os check-ins das pessoas que você enxerga."}
          </p>

          <div className="space-y-2">
            {estadoObservados === "carregando" && (
              <LoadingState variant="list" rows={2} label="Carregando os endereços dos check-ins…" />
            )}
            {observados.map((o) => (
              <div key={o.ip} className="flex flex-wrap items-center gap-3 border rounded-lg p-3">
                <code className="font-mono text-sm">{o.ip}</code>
                <Badge variant={o.ipv6 ? "default" : "secondary"}>{o.ipv6 ? "IPv6" : "IPv4"}</Badge>
                <span className="flex-1 text-xs text-muted-foreground">
                  {num(o.checkins)} check-in(s) · último em {dateTime(o.lastSeen)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isAdmin}
                  aria-label={`Usar ${o.ip} no formulário`}
                  onClick={() => {
                    setIp(o.ip);
                    toast.success(`${o.ip} copiado para o formulário. Ajuste a máscara se quiser cobrir a rede inteira.`);
                  }}
                >
                  Usar no cadastro
                </Button>
              </div>
            ))}
            {estadoObservados === "erro" && observados.length === 0 && (
              <EmptyState
                tone="danger"
                icon={ShieldAlert}
                title="Não foi possível ler os endereços dos check-ins"
                description="A lista está vazia por erro de leitura, não porque ninguém bateu ponto. Não conclua nada sobre o cabeçalho do gateway a partir desta tela."
                action={<Button variant="outline" onClick={() => void loadObservados()}>Tentar de novo</Button>}
              />
            )}
            {/* É o ÚNICO card desta tela que o banco recorta por papel:
                `checkins_select` (0004) é `profile_id in
                auth_visible_profiles()`, então o gerente só vê os check-ins da
                equipe dele. Afirmar "ninguém bateu ponto ainda" para ele o faria
                concluir que o gateway não gravou endereço nenhum — e cadastrar a
                faixa errada. */}
            {estadoObservados === "pronto" && observados.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {isAdmin
                  ? "Nenhum check-in com endereço gravado ainda. Assim que alguém bater ponto, o endereço que o gateway enxerga aparece aqui."
                  : "Nenhum endereço visível para o seu perfil — esta lista mostra apenas os check-ins das pessoas que você enxerga. Peça a lista completa a um administrador antes de concluir qual faixa cadastrar."}
              </p>
            )}
          </div>
      </SectionCard>

      {/* Liberação individual (`profiles.bypass_ip_check`).
          É a exceção à trava por IP — corretor de IP dinâmico, home office — e
          precisa ficar visível justamente por isso: quem tem bypass entra de
          qualquer endereço, independentemente das faixas acima. */}
      {/* Contar antes da resposta anunciava "(0)" com gente isenta no banco. */}
      <SectionCard
        icon={UserCheck}
        title={`Liberação individual de IP${estadoBypass === "pronto" ? ` (${bypass.length})` : ""}`}
        contentClassName="space-y-3"
      >
          <p className="text-xs text-muted-foreground">
            Quem estiver nesta lista faz check-in de qualquer endereço — as faixas acima
            deixam de valer para ele. Use só para quem não tem IP fixo. Somente o
            administrador altera (o banco recusa pelo gatilho, não só a tela).
          </p>

          {isAdmin && (
            <div className="flex flex-col gap-2 md:flex-row">
              <Select value={bypassAlvo} onValueChange={setBypassAlvo} disabled={bypassSalvando}>
                <SelectTrigger aria-label="Pessoa para liberar" className="md:w-72">
                  <SelectValue placeholder="Escolha quem será liberado" />
                </SelectTrigger>
                <SelectContent>
                  {people
                    .filter((p) => !bypass.some((b) => b.id === p.id))
                    .map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                disabled={!bypassAlvo || bypassSalvando}
                aria-busy={bypassSalvando}
                onClick={() => {
                  const alvo = people.find((p) => p.id === bypassAlvo);
                  if (alvo) void alterarBypass(alvo.id, alvo.name, true);
                }}
              >
                {bypassSalvando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Liberar
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {estadoBypass === "carregando" && (
              <LoadingState variant="list" rows={2} label="Carregando liberações individuais…" />
            )}
            {bypass.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 border rounded-lg p-3">
                <span className="text-sm font-medium">{p.full_name}</span>
                <span className="flex-1 text-xs text-muted-foreground">{p.email ?? "—"}</span>
                <Badge variant="secondary">sem trava de IP</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isAdmin || bypassSalvando}
                  aria-label={`Revogar liberação individual de ${p.full_name}`}
                  onClick={() => void alterarBypass(p.id, p.full_name, false)}
                >
                  Revogar
                </Button>
              </div>
            ))}
            {/* A frase do estado "li e não há isenção" ("Ninguém está isento")
                não pode aparecer aqui nem negada: numa tela de antifraude a
                negação é a primeira coisa que se perde na leitura rápida, e o
                card de erro acabava repetindo palavra por palavra a afirmação
                que ele existe para impedir. O card irmão da lista de faixas já
                nega com outras palavras ("não porque não há faixas
                cadastradas"), e é esse o padrão seguido aqui. */}
            {estadoBypass === "erro" && bypass.length === 0 && (
              <EmptyState
                tone="danger"
                icon={ShieldAlert}
                title="Não foi possível carregar as liberações"
                description="A lista está vazia por erro de leitura, não por ausência de liberação individual. Não conclua nada sobre a trava de IP a partir desta tela."
                action={<Button variant="outline" onClick={() => void loadBypass()}>Tentar de novo</Button>}
              />
            )}
            {estadoBypass === "pronto" && bypass.length === 0 && (
              // `profiles_select` recorta por `auth_visible_profiles()`: para quem
              // não é admin, "ninguém" é só "ninguém que você enxerga".
              <p className="text-sm text-muted-foreground">
                {isAdmin
                  ? "Ninguém está isento — todo check-in passa pelas faixas cadastradas acima."
                  : "Nenhuma liberação visível para o seu perfil — esta lista mostra apenas as pessoas que você enxerga. Peça a lista completa a um administrador antes de concluir que ninguém está isento."}
              </p>
            )}
          </div>
      </SectionCard>
    </div>
  );
}
