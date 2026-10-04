import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Folder, FolderKanban, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { listarPastasDoDrive, type PastaDoDrive } from "@/integrations/supabase/central";
import { describeError } from "@/lib/supabaseError";

/**
 * Drive de Construtoras dentro do CRM (pedido de 04/10/2026: "sem direcionar
 * para outro local"). A lista mora aqui; a pasta em si é o Google Drive da
 * construtora, que só abre lá. Mesmos dados do site (`site.developer_folders`).
 */
export default function CentralDrive() {
  const id = useId();
  const [busca, setBusca] = useState("");
  const [escolha, setEscolha] = useState<PastaDoDrive | null>(null);
  const pastas = useQuery({ queryKey: ["central", "drive"], queryFn: listarPastasDoDrive });

  const termo = busca.trim().toLowerCase();
  const visiveis = (pastas.data ?? []).filter((p) => p.developer.toLowerCase().includes(termo));

  return (
    <div className="space-y-6">
      <Link to="/central" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Central do Corretor
      </Link>
      <PageHeader
        icon={FolderKanban}
        eyebrow="Central do Corretor"
        title="Drive de Construtoras"
        description="Pastas oficiais das construtoras, atualizadas por elas mesmas."
      />

      <div className="relative max-w-md">
        <label htmlFor={`${id}-busca`} className="sr-only">Buscar construtora</label>
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input id={`${id}-busca`} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar construtora" className="pl-10" />
      </div>

      {pastas.isError ? (
        <p role="alert" className="text-sm text-destructive">{describeError(pastas.error, "Não consegui carregar as pastas.")}</p>
      ) : pastas.isPending ? (
        <LoadingState variant="block" rows={3} label="Carregando as pastas…" />
      ) : visiveis.length === 0 ? (
        <EmptyState
          icon={Folder}
          title={termo ? "Nenhuma construtora com esse nome" : "Nenhuma construtora cadastrada"}
          description={termo ? "Tente outro nome." : "As pastas são cadastradas no painel do site, em Área do Corretor."}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((p) => (
            <li key={p.id}>
              <PastaCartao pasta={p} onEscolher={() => setEscolha(p)} />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(escolha)} onOpenChange={(o) => { if (!o) setEscolha(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{escolha?.developer}</DialogTitle>
            <DialogDescription>Escolha qual pasta abrir.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {escolha?.links.map((l, i) => (
              <li key={l.url}>
                <a
                  href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => setEscolha(null)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-sm hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate">{l.name || `Pasta ${i + 1}`}</span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PastaCartao({ pasta, onEscolher }: { pasta: PastaDoDrive; onEscolher: () => void }) {
  const corpo = (
    <Card className="flex items-center gap-3 p-3 transition-colors hover:border-primary/60">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted p-1.5">
        {pasta.logo_url
          ? <img src={pasta.logo_url} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
          : <Folder className="h-6 w-6 text-primary" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-display text-sm font-semibold">{pasta.developer}</span>
          {pasta.cca && <StatusBadge tone="warning">{pasta.cca}</StatusBadge>}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-xs text-primary">
          {pasta.links.length === 0 ? "Sem pasta cadastrada" : pasta.links.length > 1 ? `${pasta.links.length} pastas` : "Abrir pasta"}
          {pasta.links.length > 0 && <ExternalLink className="h-3 w-3" aria-hidden />}
        </span>
      </span>
    </Card>
  );
  const foco = "block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const [unico] = pasta.links;
  if (pasta.links.length === 1 && unico) {
    return <a href={unico.url} target="_blank" rel="noopener noreferrer" className={foco}>{corpo}</a>;
  }
  if (pasta.links.length > 1) {
    return <button type="button" onClick={onEscolher} className={foco}>{corpo}</button>;
  }
  return <div className="opacity-70">{corpo}</div>;
}
