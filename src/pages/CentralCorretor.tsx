import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight, ExternalLink, FileText, FolderKanban, GitBranch, GraduationCap, Link2, Map as MapIcon, MessageCircle, Sparkles,
  TrendingUp, UserSearch,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingState } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { listarLinksDoCorretor, progressoDaUniversidade } from "@/integrations/supabase/central";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

/**
 * Grupos de WhatsApp das construtoras. Vieram da Área do Corretor do site
 * (`corretor.index.tsx`, versão de 30/09/2026), onde também eram fixos no código.
 */
const GRUPOS_WHATSAPP = [
  { nome: "Faceimob Geral", url: "https://chat.whatsapp.com/CAi7DNkEdhQIK3qlvqji3i" },
  { nome: "Tenda", url: "https://chat.whatsapp.com/BgFfkL6XCdQGGndmeRw7Sv" },
  { nome: "Morana", url: "https://chat.whatsapp.com/Hi50ulpQZQT4h6OIELBYWO" },
  { nome: "Vasco", url: "https://chat.whatsapp.com/DIAo6hrEcrGLc5EIOKUU4o" },
  { nome: "MRV", url: "https://chat.whatsapp.com/33v2D0yrgTX3sKxdzzimzt" },
  { nome: "Pontal", url: "https://chat.whatsapp.com/G5lmeE0h0Bf4jMQKlbjED8" },
  { nome: "LYX", url: "https://chat.whatsapp.com/IHGR1cHvByw9qzCXpzonYe" },
  { nome: "Lotus", url: "https://chat.whatsapp.com/CXxxi4x0g4RGO4HF12fho8" },
  { nome: "Apice", url: "https://chat.whatsapp.com/KBKFqFrbYYbFnkbAY8wN15" },
  { nome: "Lotticci", url: "https://chat.whatsapp.com/HaTbjPlsequCwspoblD7Aw" },
  { nome: "Vivaz", url: "https://chat.whatsapp.com/KBdTxPiHnmBGqNcmiCewR6" },
  { nome: "RNI", url: "https://chat.whatsapp.com/Hu9ZYQUsxCoGheG6siuqYy" },
  { nome: "Abaco", url: "https://chat.whatsapp.com/JxsQG0csMyR9WWOw1gprSl" },
  { nome: "Baliza", url: "https://chat.whatsapp.com/JDbgWGJYqyF3mbodcB7OR7" },
  { nome: "Esperanza", url: "https://chat.whatsapp.com/Kgpq08lPwSX6haYthtRn9U" },
] as const;


const CARTAO = "group flex h-full flex-col justify-between gap-6 p-5 transition-colors hover:border-primary/60";
const FOCO = "rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function primeiroNome(nome?: string | null) {
  const n = nome?.trim().split(/\s+/)[0] ?? "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}

/** Leads da roleta esperando o corretor clicar em "Atender" (o cronômetro corre). */
async function leadsAguardando(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("leads").select("id", { count: "exact", head: true })
    .eq("assigned_to", userId).eq("status", "assigned");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Cartão de atalho principal (Negócios, Leads): brilho que passa e ícone que
 * respira, para puxar o olho. Sem animação para quem pediu menos movimento.
 */
function CartaoAnimado({ to, icone, titulo, texto, rodape, tom }: {
  to: string; icone: ReactNode; titulo: string; texto: string; rodape?: ReactNode; tom: "primary" | "success";
}) {
  const parado = useReducedMotion();
  return (
    <Link to={to} className={cn(FOCO, "group")}>
      <Card className={cn(
        "relative flex h-full flex-col justify-between gap-6 overflow-hidden p-5 transition-colors",
        tom === "primary" ? "border-primary/40 hover:border-primary" : "border-success/40 hover:border-success",
      )}>
        {!parado && (
          <motion.span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent to-transparent",
              tom === "primary" ? "via-primary/15" : "via-success/15",
            )}
            animate={{ x: ["0%", "400%"] }}
            transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" }}
          />
        )}
        <div className="flex items-start justify-between">
          <motion.span
            className={cn("rounded-xl p-3", tom === "primary" ? "bg-primary/15 text-primary" : "bg-success/15 text-success")}
            animate={parado ? undefined : { scale: [1, 1.08, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            {icone}
          </motion.span>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
        <div>
          <p className="font-display text-lg font-semibold">{titulo}</p>
          <p className="mt-1 text-xs text-muted-foreground">{texto}</p>
          {rodape}
        </div>
      </Card>
    </Link>
  );
}

/**
 * Central do Corretor (pedidos de 03/10/2026): a tela inicial do corretor, no
 * desenho da Área do Corretor do site, agora dentro do CRM — um acesso só.
 * Negócios e Leads substituem o antigo cartão "CRM Faceimob"; os demais
 * atalhos vêm do schema `site` (editados no painel do site, Área Corretor).
 */
export default function CentralCorretor() {
  const { user, profile } = useAuth();
  const [gruposAbertos, setGruposAbertos] = useState(false);

  const links = useQuery({ queryKey: ["central", "links"], queryFn: listarLinksDoCorretor });
  const progresso = useQuery({
    queryKey: ["central", "progresso", user?.id],
    queryFn: () => progressoDaUniversidade(user?.id ?? ""),
    enabled: Boolean(user?.id),
  });
  const aguardando = useQuery({
    queryKey: ["central", "leads-aguardando", user?.id],
    queryFn: () => leadsAguardando(user?.id ?? ""),
    enabled: Boolean(user?.id),
    refetchInterval: 30_000,
  });
  const nome = primeiroNome(profile?.name);
  const total = progresso.data?.total ?? 0;
  const assistidas = progresso.data?.assistidas ?? 0;
  const pct = total ? Math.round((assistidas / total) * 100) : 0;
  const nAguardando = aguardando.data ?? 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Bem-vindo{nome ? `, ${nome}` : ""} <span aria-hidden>👋</span>
        </h1>
        <p className="mt-2 text-muted-foreground">Acesso rápido às ferramentas do dia a dia.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex gap-4 p-6 lg:col-span-2">
          <span className="h-fit rounded-xl bg-highlight/15 p-3 text-gold">
            <Sparkles className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="font-display text-xl font-semibold">Que bom ter você no time Faceimob! <span aria-hidden>🚀</span></p>
            <p className="mt-2 text-muted-foreground">
              Só a <strong className="text-gold">venda</strong> salva. Movimente seu funil{" "}
              <strong className="text-success">todos os dias</strong>: prospecte, atenda, agende e feche. Constância
              vira comissão — e comissão vira liberdade. Bora fazer acontecer!
            </p>
            <Link
              to="/pipeline"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-success/15 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-success hover:bg-success/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TrendingUp className="h-4 w-4" aria-hidden /> Mexa o funil hoje
            </Link>
          </div>
        </Card>

        <Link to="/central/universidade" className={FOCO}>
          <Card className="flex h-full flex-col justify-between gap-4 border-highlight/40 p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <span className="rounded-xl bg-highlight/15 p-2.5 text-gold">
                  <GraduationCap className="h-5 w-5" aria-hidden />
                </span>
                <span className="font-display text-lg font-semibold">Sua Formação</span>
              </span>
              <span className="font-bold tabular-nums text-gold">{pct}%</span>
            </div>
            <div
              role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
              aria-label="Aulas concluídas na Universidade"
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {total > 0 ? `Você assistiu ${assistidas} de ${total} aulas. Continue assim!` : "As aulas da Universidade aparecem aqui."}
              </p>
              <p className="mt-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-success">
                <TrendingUp className="h-3.5 w-3.5" aria-hidden /> Aumente sua chance de venda
              </p>
            </div>
          </Card>
        </Link>
      </div>

      {links.isError && (
        <p role="alert" className="text-sm text-destructive">
          {describeError(links.error, "Não consegui carregar os atalhos da Central.")}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <CartaoAnimado
          to="/pipeline" tom="primary" titulo="Negócios"
          icone={<GitBranch className="h-6 w-6" aria-hidden />}
          texto="Suas propostas e vendas no Pipeline"
        />
        <CartaoAnimado
          to="/leads" tom="success" titulo="Leads"
          icone={<UserSearch className="h-6 w-6" aria-hidden />}
          texto="Seus leads da roleta e o funil de atendimento"
          rodape={nAguardando > 0 ? (
            <p className="mt-2 text-xs font-semibold text-success">
              {nAguardando} {nAguardando === 1 ? "lead esperando" : "leads esperando"} você clicar em "Atender" →
            </p>
          ) : undefined}
        />

        {links.isPending
          ? <LoadingState variant="block" rows={1} label="Carregando os atalhos…" />
          : (links.data ?? []).map((l) => {
            const conteudo = (
              <Card className={cn(CARTAO, !l.url && "opacity-70")}>
                <div className="flex items-start justify-between">
                  <span className="rounded-xl bg-primary/15 p-2.5 text-primary">
                    <Link2 className="h-5 w-5" aria-hidden />
                  </span>
                  {l.url && <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary" aria-hidden />}
                </div>
                <div>
                  <p className="font-display text-base font-semibold">{l.label}</p>
                  {l.description && <p className="mt-1 text-xs text-muted-foreground">{l.description}</p>}
                  {!l.url && <p className="mt-2 text-xs text-warning">Endereço ainda não configurado.</p>}
                </div>
              </Card>
            );
            return l.url ? (
              <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className={FOCO}>{conteudo}</a>
            ) : (
              <div key={l.id}>{conteudo}</div>
            );
          })}

        <Link to="/central/universidade" className={FOCO}>
          <Card className={cn(CARTAO, "border-highlight/40")}>
            <span className="w-fit rounded-xl bg-highlight/15 p-2.5 text-gold">
              <GraduationCap className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-base font-semibold">Universidade Faceimob</p>
              <p className="mt-1 text-xs text-muted-foreground">Vídeo aulas de Meta Ads, atendimento e fechamento</p>
            </div>
          </Card>
        </Link>

        <Link to="/central/drive" className={FOCO}>
          <Card className={CARTAO}>
            <span className="w-fit rounded-xl bg-primary/15 p-2.5 text-primary">
              <FolderKanban className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-base font-semibold">Drive de Construtoras</p>
              <p className="mt-1 text-xs text-muted-foreground">Pastas oficiais com tabelas, plantas e materiais</p>
            </div>
          </Card>
        </Link>

        <Link to="/central/mapa" className={FOCO}>
          <Card className={CARTAO}>
            <span className="w-fit rounded-xl bg-primary/15 p-2.5 text-primary">
              <MapIcon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-base font-semibold">Mapa de Imóveis</p>
              <p className="mt-1 text-xs text-muted-foreground">Empreendimentos por cidade da Região Metropolitana</p>
            </div>
          </Card>
        </Link>

        <Link to="/central/suporte" className={FOCO}>
          <Card className={CARTAO}>
            <span className="w-fit rounded-xl bg-primary/15 p-2.5 text-primary">
              <FileText className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-base font-semibold">Suporte para Análise</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Documentos para baixar e enviar junto da documentação do cliente
              </p>
            </div>
          </Card>
        </Link>

        <button type="button" onClick={() => setGruposAbertos(true)} className={cn(FOCO, "text-left")}>
          <Card className={cn(CARTAO, "border-success/40")}>
            <span className="w-fit rounded-xl bg-success/15 p-2.5 text-success">
              <MessageCircle className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-base font-semibold">Grupos de WhatsApp</p>
              <p className="mt-1 text-xs text-muted-foreground">Entre nos grupos para informações de venda</p>
              <p className="mt-2 text-xs font-semibold text-success">{GRUPOS_WHATSAPP.length} grupos disponíveis →</p>
            </div>
          </Card>
        </button>
      </div>

      <Dialog open={gruposAbertos} onOpenChange={setGruposAbertos}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Grupos de WhatsApp</DialogTitle>
            <DialogDescription>Entre no grupo da construtora para receber as informações de venda.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {GRUPOS_WHATSAPP.map((g) => (
              <li key={g.url}>
                <a
                  href={g.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-success" aria-hidden /> {g.nome}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
