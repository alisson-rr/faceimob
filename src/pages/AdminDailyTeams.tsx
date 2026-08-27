import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Link2, Copy, Plus, RefreshCw, Eye, EyeOff, Users, ShieldCheck, Globe, ExternalLink, AlertTriangle, type LucideIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { listPeople, type PersonRecord } from "@/integrations/supabase/newSchema";
import type { Database } from "@/integrations/supabase/types";
import { slugify } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";

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

const DAILY_PUBLIC_ORIGIN = "https://crm-faceimob.com.br";
type TeamRow = Pick<Database["public"]["Tables"]["teams"]["Row"], "id" | "name" | "active">;
type TeamLink = Pick<Database["public"]["Tables"]["public_links"]["Row"], "id" | "team_id" | "slug" | "active" | "pin_hash">;
type DailyTeam = TeamRow & { public_link: TeamLink | null };
type DirectorLink = { id: string; slug: string; pin_hash: string | null };
type PublicDirector = PersonRecord & { public_link: DirectorLink | null };

/**
 * `create_public_link` nasce na migration 0033 e ainda não está em
 * `types.ts` — o arquivo é gerado por `supabase gen types` e não se edita à
 * mão. O cast local morre no próximo `gen types`.
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

export default function AdminDailyTeams() {
  const qc = useQueryClient();
  const [newTeam, setNewTeam] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [generatedPins, setGeneratedPins] = useState<Record<string, string>>({});

  const { data: teams } = useQuery({
    queryKey: ["daily-teams"],
    queryFn: async () => {
      const [{ data: teamRows }, { data: linkRows }] = await Promise.all([
        supabase.from("teams").select("id,name,active").order("name"),
        supabase.from("public_links").select("id,team_id,slug,active,pin_hash").eq("kind", "daily_team"),
      ]);
      const links = new Map((linkRows ?? []).flatMap(link => link.team_id ? [[link.team_id, link] as const] : []));
      return (teamRows ?? []).map(team => ({ ...team, public_link: links.get(team.id) || null }));
    },
  });

  const { data: ips } = useQuery({
    queryKey: ["allowed-ips-mini"],
    queryFn: async () => {
      const { data } = await supabase.from("allowed_ips").select("id,ip_range,label,active").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Só leitura. Antes esta query CRIAVA o link do diretor de passagem, com slug
  // `diretor-<nome>` e sem PIN nenhum: abrir a tela publicava o funil da
  // diretoria numa URL adivinhável (achado S02). Agora o link nasce só quando o
  // admin clica em gerar, pela RPC que sorteia o slug e exige PIN (0033).
  const { data: directors } = useQuery({
    queryKey: ["directors-public-links"],
    queryFn: async () => {
      const people = await listPeople();
      const { data: links, error } = await supabase.from("public_links")
        .select("id,director_id,slug,pin_hash").eq("kind", "director_checkpoint").eq("active", true);
      if (error) throw error;
      const byDirector = new Map(
        (links ?? []).flatMap(link => link.director_id ? [[link.director_id, link] as const] : []),
      );
      return people
        .filter(person => person.active && person.roles.includes("director"))
        .map<PublicDirector>(director => {
          const link = byDirector.get(director.id);
          return {
            ...director,
            public_link: link ? { id: link.id, slug: link.slug, pin_hash: link.pin_hash } : null,
          };
        });
    },
  });

  const activeIps = (ips ?? []).filter((row) => row.active).length;
  const withPin = (teams ?? []).filter((team) => team.public_link?.active && team.public_link?.pin_hash).length;
  // Link criado antes da 0033 pode estar sem PIN. A migration não invalida nada
  // em massa — quem fecha é o admin, e este aviso é o que o faz olhar.
  const openLinks =
    (teams ?? []).filter(team => team.public_link && !team.public_link.pin_hash).length +
    (directors ?? []).filter(director => director.public_link && !director.public_link.pin_hash).length;

  const createTeam = async () => {
    if (!newTeam.trim()) return;
    // `teams.slug` é NOT NULL: sem ele o insert era recusado pelo banco. O erro
    // estava documentado desde a Sprint 1 e vivia escondido pelo typecheck vazio.
    const name = newTeam.trim();
    const { error } = await supabase.from("teams").insert({ name, slug: slugify(name) });
    if (error) return toast({ title: "Erro ao criar equipe", description: describeError(error, "Não foi possível criar a equipe."), variant: "destructive" });
    setNewTeam("");
    toast({ title: "Equipe criada" });
    qc.invalidateQueries({ queryKey: ["daily-teams"] });
  };

  /**
   * Gera um PIN novo e, se o link ainda não existir, cria o link junto.
   *
   * Um caminho só para equipe e diretoria: o link nasce pela RPC `create_public_link`
   * (slug sorteado, PIN obrigatório) e o PIN de um link já existente é trocado por
   * `set_public_link_pin`. O PIN em claro só existe aqui e no toast — o banco
   * guarda o hash.
   */
  const issuePin = async (
    rowKey: string,
    link: { id: string } | null | undefined,
    owner: { kind: "daily_team"; teamId: string } | { kind: "director_checkpoint"; directorId: string },
  ) => {
    const pin = randomPin();
    const failure = link
      ? (await supabase.rpc("set_public_link_pin", { p_link_id: link.id, p_pin: pin })).error
      : (await createPublicLink({
          p_kind: owner.kind,
          p_pin: pin,
          p_team_id: owner.kind === "daily_team" ? owner.teamId : null,
          p_director_id: owner.kind === "director_checkpoint" ? owner.directorId : null,
        })).error;
    if (failure) return toast({ title: "Erro ao gerar PIN", description: describeError(failure, "Não foi possível gerar o PIN do link."), variant: "destructive" });

    setGeneratedPins(prev => ({ ...prev, [rowKey]: pin }));
    setRevealed(prev => ({ ...prev, [rowKey]: true }));
    toast({ title: "PIN gerado", description: `${pin} — anote agora, ele não é exibido de novo.` });
    qc.invalidateQueries({ queryKey: ["daily-teams"] });
    qc.invalidateQueries({ queryKey: ["directors-public-links"] });
  };

  // Sem link não há URL: o slug é sorteado no banco, não dá para adivinhá-lo
  // a partir do nome como a tela fazia antes.
  const linkFor = (team: DailyTeam) =>
    team.public_link ? `${DAILY_PUBLIC_ORIGIN}/daily/${team.public_link.slug}?v=public` : null;
  const adminLinkFor = (team: DailyTeam) =>
    team.public_link ? `${window.location.origin}/daily/${team.public_link.slug}` : null;
  const copy = (text: string, label = "Link") => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado` });
  };

  return (
    <div className="space-y-3">
      {/* Header compacto */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> Diário — Links, PINs & IPs
          </h1>
          <p className="text-xs text-muted-foreground">Uma linha por equipe. Compartilhe o link com o gerente.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Ex.: Equipe Fulano" className="h-8 w-56 text-xs" />
          <Button size="sm" className="h-8" onClick={createTeam}><Plus className="h-3 w-3 mr-1" /> Nova equipe</Button>
          <Button asChild size="sm" variant="outline" className="h-8"><Link to="/admin/allowed-ips"><Globe className="h-3 w-3 mr-1" /> Gerenciar IPs</Link></Button>
        </div>
      </div>

      {/* KPIs em faixa fina */}
      <div className="grid grid-cols-3 gap-2">
        <KpiMini icon={Users}       label="Equipes"      value={teams?.length ?? 0} tone="text-info" />
        <KpiMini icon={ShieldCheck} label="Com PIN ativo" value={withPin}           tone="text-success" />
        <KpiMini icon={Globe}       label="IPs ativos"    value={activeIps}         tone="text-warning" />
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

      {/* Linhas densas de equipes */}
      <Card className="border-border/50">
        <CardContent className="p-0 divide-y divide-border/40">
          {(teams ?? []).map((t) => {
            const hasPin = !!t.public_link?.active && !!t.public_link?.pin_hash;
            const link = linkFor(t);
            const adminLink = adminLinkFor(t);
            return (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2 hover:bg-primary/5">
                <div className="min-w-0 w-48">
                  <p className="text-xs font-semibold truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{t.public_link?.slug || "sem link"}</p>
                </div>

                <LinkCell url={link} onCopy={copy} />
                <PinCell
                  label={t.name}
                  hasPin={hasPin}
                  hasLink={!!t.public_link}
                  plain={generatedPins[t.id] ?? null}
                  isShown={!!revealed[t.id]}
                  onToggle={() => setRevealed(p => ({ ...p, [t.id]: !p[t.id] }))}
                  onCopy={copy}
                />

                <Button asChild size="sm" variant="outline" className="h-7 px-2" disabled={!adminLink} title="Abrir daily como admin (sem PIN)">
                  <a href={adminLink ?? "#"} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Ver</a>
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2"
                  onClick={() => issuePin(t.id, t.public_link, { kind: "daily_team", teamId: t.id })}>
                  <RefreshCw className="h-3 w-3 mr-1" /> {t.public_link ? (hasPin ? "Renovar" : "Gerar PIN") : "Criar link"}
                </Button>
              </div>
            );
          })}
          {(teams ?? []).length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">Nenhuma equipe cadastrada.</div>
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
            {(directors ?? []).map((d) => {
              const dlink = d.public_link ? `${DAILY_PUBLIC_ORIGIN}/diretor/${d.public_link.slug}` : null;
              return (
                <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <div className="w-48 truncate font-semibold">{d.name}</div>
                  <LinkCell url={dlink} onCopy={copy} />
                  <PinCell
                    label={d.name}
                    hasPin={!!d.public_link?.pin_hash}
                    hasLink={!!d.public_link}
                    plain={generatedPins[`dir-${d.id}`] ?? null}
                    isShown={!!revealed[`dir-${d.id}`]}
                    onToggle={() => setRevealed(p => ({ ...p, [`dir-${d.id}`]: !p[`dir-${d.id}`] }))}
                    onCopy={copy}
                  />
                  <Button asChild size="sm" variant="outline" className="h-7 px-2" disabled={!dlink}>
                    <a href={dlink ?? "#"} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Ver</a>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() => issuePin(`dir-${d.id}`, d.public_link, { kind: "director_checkpoint", directorId: d.id })}>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {d.public_link ? (d.public_link.pin_hash ? "Renovar" : "Gerar PIN") : "Criar link"}
                  </Button>
                </div>
              );
            })}
            {(directors ?? []).length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">Nenhum diretor cadastrado.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bloco compacto de IPs (top 6) */}
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
            {(ips ?? []).length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">Nenhum IP cadastrado.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Célula do link. Sem link não há URL para mostrar — o slug é sorteado no banco. */
function LinkCell({ url, onCopy }: { url: string | null; onCopy: (text: string, label?: string) => void }) {
  if (!url) {
    return (
      <div className="flex-1 min-w-0 text-xs text-muted-foreground px-2 py-1">
        Sem link público — clique em “Criar link”.
      </div>
    );
  }
  return (
    <div className="flex-1 min-w-0 flex items-center gap-1.5 text-xs font-mono bg-muted/30 rounded px-2 py-1">
      <Link2 className="h-3 w-3 text-primary shrink-0" />
      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
      <button onClick={() => onCopy(url)} className="ml-auto hover:text-primary shrink-0" title="Copiar link">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * Estado do PIN. "Sem PIN" é aviso, não rótulo neutro: link público sem PIN é
 * a operação da equipe (ou da diretoria) aberta a quem tiver a URL.
 */
function PinCell({ label, hasPin, hasLink, plain, isShown, onToggle, onCopy }: {
  /** Nome da equipe ou do diretor — entra no nome acessível dos botões. */
  label: string;
  hasPin: boolean;
  hasLink: boolean;
  plain: string | null;
  isShown: boolean;
  onToggle: () => void;
  onCopy: (text: string, label?: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 w-44 shrink-0">
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
