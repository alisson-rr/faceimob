import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, GraduationCap, LayoutGrid, Link2, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
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

/** Até a Universidade entrar no CRM (próxima etapa), o cartão abre a do site. */
const UNIVERSIDADE_NO_SITE = "https://faceimob.com.br/corretor/universidade";

const CARTAO = "group flex h-full flex-col justify-between gap-6 p-5 transition-colors hover:border-primary/60";

function primeiroNome(nome?: string | null) {
  const n = nome?.trim().split(/\s+/)[0] ?? "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}

/**
 * Central do Corretor (pedido de 03/10/2026): o que ficava na Área do Corretor
 * do site passa a morar no CRM, para o corretor ter um acesso só. Mesmos dados
 * (schema `site`), com a cara do CRM.
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
  const nome = primeiroNome(profile?.name);
  const pct = progresso.data?.total ? Math.round((progresso.data.assistidas / progresso.data.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutGrid}
        title="Central do Corretor"
        description={`${nome ? `Olá, ${nome}. ` : ""}Seus atalhos, materiais e treinamentos num lugar só.`}
      />

      {links.isError && (
        <p role="alert" className="text-sm text-destructive">
          {describeError(links.error, "Não consegui carregar os atalhos da Central.")}
        </p>
      )}

      {links.isPending ? (
        <LoadingState variant="block" rows={2} label="Carregando a Central…" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(links.data ?? []).map((l) => {
            const conteudo = (
              <Card className={cn(CARTAO, !l.url && "opacity-70")}>
                <div className="flex items-start justify-between">
                  <span className="rounded-lg bg-primary/15 p-2.5 text-primary">
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
              <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {conteudo}
              </a>
            ) : (
              <div key={l.id}>{conteudo}</div>
            );
          })}

          <a href={UNIVERSIDADE_NO_SITE} target="_blank" rel="noopener noreferrer" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className={cn(CARTAO, "border-highlight/40")}>
              <div className="flex items-start justify-between">
                <span className="rounded-lg bg-highlight/15 p-2.5 text-gold">
                  <GraduationCap className="h-5 w-5" aria-hidden />
                </span>
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary" aria-hidden />
              </div>
              <div>
                <p className="font-display text-base font-semibold">Universidade Faceimob</p>
                <p className="mt-1 text-xs text-muted-foreground">Vídeo aulas de Meta Ads, atendimento e fechamento</p>
                {progresso.data && progresso.data.total > 0 && (
                  <div className="mt-3 space-y-1">
                    <div
                      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
                      aria-label="Aulas concluídas na Universidade"
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {progresso.data.assistidas} de {progresso.data.total} aulas · {pct}%
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </a>

          <Link to="/central/suporte" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className={CARTAO}>
              <span className="w-fit rounded-lg bg-primary/15 p-2.5 text-primary">
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

          <button
            type="button"
            onClick={() => setGruposAbertos(true)}
            className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className={cn(CARTAO, "border-success/40")}>
              <span className="w-fit rounded-lg bg-success/15 p-2.5 text-success">
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
      )}

      {!links.isPending && !links.isError && (links.data ?? []).length === 0 && (
        <EmptyState
          icon={Link2}
          title="Nenhum atalho cadastrado"
          description="Os atalhos da Central são cadastrados no painel do site, em Área Corretor."
        />
      )}

      <Dialog open={gruposAbertos} onOpenChange={setGruposAbertos}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Grupos de WhatsApp</DialogTitle>
            <DialogDescription>Entre no grupo da construtora para receber as informações de venda.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
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
