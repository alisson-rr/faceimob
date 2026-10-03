import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FileImage, FileText, Loader2, Pencil, Save, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  alternarDocumentoVisivel, excluirDocumentoDeSuporte, extensaoDe, linkParaBaixar, listarDocumentosDeSuporte,
  podeGerenciarSuporte, salvarDocumentoDeSuporte, type DocumentoDeSuporte,
} from "@/integrations/supabase/central";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

const CHAVE = ["central", "suporte"] as const;
const IMAGENS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic"]);

function tamanho(n: number | null) {
  if (!n) return "";
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Edicao = { doc: DocumentoDeSuporte | null; titulo: string; descricao: string; ativo: boolean; arquivo: File | null };

/**
 * Suporte para Análise (Central do Corretor, 03/10/2026): os documentos que o
 * corretor baixa e manda junto da documentação do cliente. Admin e editores
 * cadastrados (`site.support_doc_editors`) enviam, editam, ocultam e excluem;
 * quem autoriza é a RLS do schema `site` e do bucket `support-docs` (0169).
 */
export default function CentralSuporte() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const id = useId();
  const [baixando, setBaixando] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState<DocumentoDeSuporte | null>(null);

  const docs = useQuery({ queryKey: CHAVE, queryFn: listarDocumentosDeSuporte });
  const gerencia = useQuery({
    queryKey: ["central", "suporte-gerencia", user?.id, isAdmin],
    queryFn: () => podeGerenciarSuporte(user?.id ?? "", isAdmin),
    enabled: Boolean(user?.id),
  });
  const podeGerenciar = gerencia.data === true;
  const visiveis = (docs.data ?? []).filter((d) => podeGerenciar || d.active);

  const recarregar = () => qc.invalidateQueries({ queryKey: CHAVE });
  const falhou = (titulo: string, erro: unknown) =>
    toast({ variant: "destructive", title: titulo, description: describeError(erro, "Tente de novo em instantes.") });

  async function baixar(doc: DocumentoDeSuporte) {
    setBaixando(doc.id);
    try {
      const url = await linkParaBaixar(doc);
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (erro) {
      falhou("Não foi possível baixar o arquivo", erro);
    } finally {
      setBaixando(null);
    }
  }

  async function salvar() {
    if (!edicao) return;
    if (!edicao.titulo.trim()) return toast({ variant: "destructive", title: "Informe o nome do documento." });
    if (!edicao.doc && !edicao.arquivo) return toast({ variant: "destructive", title: "Escolha o arquivo para enviar." });
    setSalvando(true);
    try {
      await salvarDocumentoDeSuporte({
        id: edicao.doc?.id,
        title: edicao.titulo,
        description: edicao.descricao,
        active: edicao.ativo,
        sort_order: edicao.doc?.sort_order ?? (docs.data ?? []).length,
        arquivoAtual: {
          file_path: edicao.doc?.file_path ?? null,
          file_name: edicao.doc?.file_name ?? null,
          file_type: edicao.doc?.file_type ?? null,
          file_size: edicao.doc?.file_size ?? null,
        },
        arquivoNovo: edicao.arquivo,
      });
      toast({ variant: "success", title: edicao.doc ? "Documento atualizado" : "Documento enviado" });
      setEdicao(null);
      await recarregar();
    } catch (erro) {
      falhou("Não foi possível salvar o documento", erro);
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(doc: DocumentoDeSuporte) {
    try {
      await alternarDocumentoVisivel(doc);
      await recarregar();
    } catch (erro) {
      falhou("Não foi possível mudar a visibilidade", erro);
    }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    try {
      await excluirDocumentoDeSuporte(excluir);
      toast({ variant: "success", title: "Documento excluído" });
      await recarregar();
    } catch (erro) {
      falhou("Não foi possível excluir o documento", erro);
    } finally {
      setExcluir(null);
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/central" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Central do Corretor
      </Link>
      <PageHeader
        icon={FileText}
        title="Suporte para Análise"
        description="Documentos para enviar junto da documentação do cliente. Baixe sempre a versão mais recente."
        actions={podeGerenciar && !edicao ? (
          <Button onClick={() => setEdicao({ doc: null, titulo: "", descricao: "", ativo: true, arquivo: null })}>
            <Upload className="mr-2 h-4 w-4" aria-hidden /> Enviar documento
          </Button>
        ) : undefined}
      />

      {podeGerenciar && (
        <StatusBadge tone="success" className="gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Você pode enviar e atualizar documentos
        </StatusBadge>
      )}

      {edicao && (
        <Card className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-titulo`}>Nome do documento</Label>
            <Input id={`${id}-titulo`} maxLength={200} value={edicao.titulo}
              onChange={(e) => setEdicao({ ...edicao, titulo: e.target.value })}
              placeholder="Ex.: Ficha de Cadastro Caixa" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-descricao`}>Para que serve</Label>
            <Textarea id={`${id}-descricao`} rows={3} maxLength={2000} value={edicao.descricao}
              onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })}
              placeholder="Quando usar e o que o cliente precisa preencher." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-arquivo`}>
              Arquivo {edicao.doc ? "(opcional — substitui o atual)" : "(PDF, Word ou imagem)"}
            </Label>
            <Input id={`${id}-arquivo`} type="file"
              accept=".pdf,.doc,.docx,.rtf,.odt,image/*"
              onChange={(e) => setEdicao({ ...edicao, arquivo: e.target.files?.[0] ?? null })} />
          </div>
          <div className="flex items-center gap-2">
            <Switch id={`${id}-ativo`} checked={edicao.ativo} onCheckedChange={(v) => setEdicao({ ...edicao, ativo: v })} />
            <Label htmlFor={`${id}-ativo`} className="font-normal text-muted-foreground">Visível aos corretores</Label>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void salvar()} disabled={salvando}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
              Salvar
            </Button>
            <Button variant="ghost" onClick={() => setEdicao(null)} disabled={salvando}>
              <X className="mr-2 h-4 w-4" aria-hidden /> Cancelar
            </Button>
          </div>
        </Card>
      )}

      {docs.isError ? (
        <p role="alert" className="text-sm text-destructive">{describeError(docs.error, "Não consegui carregar os documentos.")}</p>
      ) : docs.isPending ? (
        <LoadingState variant="block" rows={2} label="Carregando documentos…" />
      ) : visiveis.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhum documento ainda"
          description="Os documentos de suporte para a análise aparecem aqui, prontos para baixar." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visiveis.map((d) => {
            const ext = extensaoDe(d);
            const Icone = IMAGENS.has(ext) || (d.file_type ?? "").startsWith("image/") ? FileImage : FileText;
            return (
              <Card key={d.id} className={cn("flex min-w-0 flex-col gap-2 p-4", !d.active && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="shrink-0 rounded-lg bg-primary/15 p-2 text-primary">
                    <Icone className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{d.title}</p>
                    <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                      {ext || "arquivo"}{d.file_size ? ` · ${tamanho(d.file_size)}` : ""}{!d.active && " · oculto"}
                    </p>
                  </div>
                </div>
                {d.description && (
                  <p className="whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {d.description}
                  </p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  <Button size="sm" onClick={() => void baixar(d)} disabled={!d.file_path || baixando === d.id}>
                    {baixando === d.id
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                      : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                    Baixar
                  </Button>
                  {podeGerenciar && (
                    <>
                      <Button size="sm" variant="outline" aria-label={`Editar ${d.title}`}
                        onClick={() => setEdicao({ doc: d, titulo: d.title, descricao: d.description ?? "", ativo: d.active, arquivo: null })}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void alternar(d)}>
                        {d.active ? "Ocultar" : "Exibir"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Excluir ${d.title}`}
                        onClick={() => setExcluir(d)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={Boolean(excluir)} onOpenChange={(aberto) => { if (!aberto) setExcluir(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir documento?</AlertDialogTitle>
            <AlertDialogDescription>
              "{excluir?.title}" sai da Central e o arquivo é apagado. Para só esconder dos corretores, use "Ocultar".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmarExclusao()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
