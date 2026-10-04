import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, BedDouble, Building2, Map as MapIcon, MapPin, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { listarImoveisDoMapa, type ImovelDoMapa } from "@/integrations/supabase/central";
import { brl } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

/**
 * Posição aproximada (%) de cada cidade no desenho da Região Metropolitana.
 * Copiada da Área do Corretor do site (versão de 30/09/2026). Cidade fora da
 * lista não ganha pino: aparece só na lista ao lado.
 */
const POSICAO_DA_CIDADE: Record<string, { x: number; y: number }> = {
  "porto alegre": { x: 40, y: 62 },
  "viamão": { x: 66, y: 62 },
  "viamao": { x: 66, y: 62 },
  "alvorada": { x: 55, y: 54 },
  "cachoeirinha": { x: 49, y: 45 },
  "canoas": { x: 44, y: 46 },
  "gravataí": { x: 63, y: 42 },
  "gravatai": { x: 63, y: 42 },
  "sapucaia do sul": { x: 55, y: 35 },
  "esteio": { x: 48, y: 38 },
  "são leopoldo": { x: 58, y: 26 },
  "sao leopoldo": { x: 58, y: 26 },
  "novo hamburgo": { x: 65, y: 18 },
  "guaíba": { x: 23, y: 70 },
  "guaiba": { x: 23, y: 70 },
  "eldorado do sul": { x: 30, y: 55 },
  "triunfo": { x: 15, y: 40 },
  "montenegro": { x: 40, y: 15 },
};

/** O "Mapa Google" do site: My Maps da Faceimob, embutido aqui sem sair do CRM. */
const MAPA_GOOGLE =
  "https://www.google.com/maps/d/u/0/embed?mid=1gyhEad0cjyHOalVWap1H0TssJaiIf20&ll=-30.07673837976231%2C-51.02201918265033&z=11";

const STATUS_DO_IMOVEL: Record<string, string> = {
  lancamento: "Lançamento",
  em_obras: "Em obras",
  pronto_para_morar: "Pronto para morar",
  entregue: "Entregue",
};

type Cidade = { chave: string; nome: string; imoveis: ImovelDoMapa[]; pos: { x: number; y: number } | null };

const preco = (i: ImovelDoMapa) =>
  i.price ? brl(i.price) : i.price_from ? `A partir de ${brl(i.price_from)}` : "Sob consulta";

/** Mapa de Imóveis dentro do CRM (pedido de 04/10/2026), com os imóveis ativos do site. */
export default function CentralMapa() {
  const parado = useReducedMotion();
  const imoveis = useQuery({ queryKey: ["central", "mapa"], queryFn: listarImoveisDoMapa });
  const [aberta, setAberta] = useState<string | null>(null);

  const cidades = useMemo(() => {
    const porCidade = new Map<string, ImovelDoMapa[]>();
    for (const i of imoveis.data ?? []) {
      const chave = (i.city ?? "").trim().toLowerCase();
      if (!chave) continue;
      porCidade.set(chave, [...(porCidade.get(chave) ?? []), i]);
    }
    return [...porCidade.entries()]
      .map(([chave, lista]): Cidade => ({
        chave, nome: lista[0]?.city.trim() ?? chave, imoveis: lista, pos: POSICAO_DA_CIDADE[chave] ?? null,
      }))
      .sort((a, b) => b.imoveis.length - a.imoveis.length);
  }, [imoveis.data]);

  const cidadeAberta = cidades.find((c) => c.chave === aberta) ?? null;
  const semCidade = (imoveis.data ?? []).filter((i) => !(i.city ?? "").trim()).length;

  return (
    <div className="space-y-6">
      <Link to="/central" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Central do Corretor
      </Link>
      <PageHeader
        icon={MapIcon}
        eyebrow="Central do Corretor"
        title="Mapa de Imóveis"
        description="Clique numa cidade para ver os empreendimentos de lá."
      />

      <Tabs defaultValue="faceimob">
        <TabsList>
          <TabsTrigger value="faceimob">Mapa Faceimob</TabsTrigger>
          <TabsTrigger value="google">Mapa Google</TabsTrigger>
        </TabsList>

        <TabsContent value="google" className="mt-4">
          <Card className="overflow-hidden">
            <iframe
              title="Mapa de empreendimentos Faceimob no Google"
              src={MAPA_GOOGLE}
              className="h-[70vh] min-h-[420px] w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </Card>
        </TabsContent>

        <TabsContent value="faceimob" className="mt-4">
          {imoveis.isError ? (
            <p role="alert" className="text-sm text-destructive">{describeError(imoveis.error, "Não consegui carregar os imóveis.")}</p>
          ) : imoveis.isPending ? (
            <LoadingState variant="block" rows={3} label="Carregando os imóveis…" />
          ) : cidades.length === 0 ? (
            <EmptyState icon={MapPin} title="Nenhum imóvel ativo" description="Os imóveis são cadastrados no painel do site." />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_30%_20%,hsl(var(--sidebar-primary)/0.12),transparent_60%),radial-gradient(circle_at_70%_80%,hsl(var(--primary)/0.2),transparent_55%)] bg-sidebar">
                <svg viewBox="0 0 100 75" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-25" aria-hidden>
                  <path d="M0,65 Q20,60 30,55 T55,52 T75,58 T100,55" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M10,72 Q25,68 40,63 T70,63 T100,66" fill="none" stroke="hsl(var(--primary))" strokeOpacity="0.5" strokeWidth="0.6" />
                </svg>
                <p className="absolute left-4 top-4 rounded-md bg-background/60 px-3 py-1.5 text-xs font-medium text-sidebar-primary backdrop-blur-sm">
                  Região Metropolitana de Porto Alegre
                </p>
                {cidades.map((c, i) => c.pos && (
                  <button
                    key={c.chave}
                    type="button"
                    onClick={() => setAberta(aberta === c.chave ? null : c.chave)}
                    style={{ left: `${c.pos.x}%`, top: `${c.pos.y}%` }}
                    aria-pressed={aberta === c.chave}
                    aria-label={`${c.nome}: ${c.imoveis.length} ${c.imoveis.length === 1 ? "imóvel" : "imóveis"}`}
                    className="group absolute -translate-x-1/2 -translate-y-full rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {!parado && (
                      <motion.span
                        aria-hidden
                        className="absolute left-1/2 top-full h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sidebar-primary/30"
                        animate={{ scale: [1, 2.6], opacity: [0.6, 0] }}
                        transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.25, ease: "easeOut" }}
                      />
                    )}
                    <span className={cn(
                      "relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-lg backdrop-blur-sm transition",
                      aberta === c.chave
                        ? "border-gold bg-gold text-background"
                        : "border-sidebar-primary/60 bg-background/80 text-sidebar-primary group-hover:border-sidebar-primary",
                    )}>
                      <MapPin className="h-3.5 w-3.5" aria-hidden /> {c.nome}
                      <span className="rounded-full bg-sidebar-primary px-1.5 text-xs font-bold text-background">{c.imoveis.length}</span>
                    </span>
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {cidadeAberta ? (
                  <motion.div key={cidadeAberta.chave} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                    <Card className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wider text-sidebar-primary">Cidade</p>
                          <h2 className="font-display text-xl font-bold">{cidadeAberta.nome}</h2>
                          <p className="text-xs text-muted-foreground">
                            {cidadeAberta.imoveis.length} {cidadeAberta.imoveis.length === 1 ? "imóvel" : "imóveis"}
                          </p>
                        </div>
                        <button
                          type="button" onClick={() => setAberta(null)} aria-label="Fechar cidade"
                          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      <ul className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                        {cidadeAberta.imoveis.map((im) => (
                          <li key={im.id} className="flex gap-3 rounded-xl border border-border p-2">
                            <span className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                              {im.imagem
                                ? <img src={im.imagem} alt="" className="h-full w-full object-cover" loading="lazy" />
                                : <span className="flex h-full items-center justify-center text-muted-foreground"><Building2 className="h-6 w-6" aria-hidden /></span>}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{im.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {[im.neighborhood, STATUS_DO_IMOVEL[im.status] ?? im.status, im.developer].filter(Boolean).join(" · ")}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-semibold text-gold">{preco(im)}</span>
                                {im.bedrooms ? (
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    <BedDouble className="h-3.5 w-3.5" aria-hidden /> {im.bedrooms}
                                  </span>
                                ) : null}
                                {im.cca && <StatusBadge tone="warning">{im.cca}</StatusBadge>}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </motion.div>
                ) : (
                  <Card className="p-5">
                    <p className="text-sm text-muted-foreground">Escolha uma cidade:</p>
                    <ul className="mt-3 space-y-1">
                      {cidades.map((c) => (
                        <li key={c.chave}>
                          <button
                            type="button" onClick={() => setAberta(c.chave)}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" aria-hidden />{c.nome}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{c.imoveis.length}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </AnimatePresence>
            </div>
          )}
          {semCidade > 0 && (
            <p className="mt-4 text-xs text-warning">
              {semCidade} {semCidade === 1 ? "imóvel sem cidade cadastrada" : "imóveis sem cidade cadastrada"} no painel do site.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
