import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Download, ExternalLink, Pencil, Percent, Save, Upload, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  SITE_PUBLICO, STATUS_DO_IMOVEL, listarImoveisDoCadastro, salvarImovel,
  type AlteracaoDoImovel, type ImovelDoCadastro, type StatusDoImovel,
} from "@/integrations/supabase/central";
import { gerarPlanilha, lerPlanilha } from "@/lib/planilhaPrecos";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

const CHAVE = ["central", "imoveis-cadastro"];
const TODAS = "__todas__";

type Preco = { price?: number | null; price_from?: number | null };

const ehStatus = (v: string): v is StatusDoImovel => v in STATUS_DO_IMOVEL;

/**
 * Imóveis e preços dentro do CRM (05/10/2026, etapa 2 de trazer a
 * administração do site): preços na linha, reajuste em % nos filtrados e a
 * planilha (baixar, mudar no Excel, subir). Os preços mudados ficam marcados
 * até "Salvar"; ativo, destaque e os dados do imóvel gravam na hora. Fotos,
 * descrição e book continuam no painel do site por enquanto.
 */
export default function CentralImoveis() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [construtora, setConstrutora] = useState(TODAS);
  const [precos, setPrecos] = useState<Record<string, Preco>>({});
  const [reajuste, setReajuste] = useState("");
  const [editando, setEditando] = useState<ImovelDoCadastro | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  const imoveis = useQuery({ queryKey: CHAVE, queryFn: listarImoveisDoCadastro, enabled: isAdmin });
  const lista = useMemo(() => imoveis.data ?? [], [imoveis.data]);

  const construtoras = useMemo(
    () => [...new Set(lista.map((i) => i.developer?.trim()).filter((d): d is string => Boolean(d)))]
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [lista],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lista.filter((i) =>
      (construtora === TODAS || (i.developer ?? "").trim() === construtora)
      && (!termo || `${i.code} ${i.title} ${i.city} ${i.developer ?? ""}`.toLowerCase().includes(termo)));
  }, [lista, busca, construtora]);

  const pendentes = Object.keys(precos).length;
  const atualizar = () => queryClient.invalidateQueries({ queryKey: CHAVE });

  const salvarUm = useMutation({
    mutationFn: ({ id, alteracao }: { id: string; alteracao: AlteracaoDoImovel }) => salvarImovel(id, alteracao),
    onSuccess: () => { void atualizar(); setEditando(null); },
    onError: (e) => toast({ variant: "destructive", title: describeError(e, "Não consegui salvar o imóvel.") }),
  });

  const salvarPrecos = useMutation({
    mutationFn: async () => {
      const r = await Promise.allSettled(Object.entries(precos).map(([id, p]) => salvarImovel(id, p)));
      const falhas = Object.keys(precos).filter((_, i) => r[i]?.status === "rejected");
      return { ok: r.length - falhas.length, falhas };
    },
    onSuccess: ({ ok, falhas }) => {
      // Fica marcado só o que não gravou, para tentar de novo.
      setPrecos((atual) => Object.fromEntries(Object.entries(atual).filter(([id]) => falhas.includes(id))));
      void atualizar();
      toast(falhas.length
        ? { variant: "destructive", title: `${ok} preço(s) salvos, ${falhas.length} falharam`, description: "Os que falharam continuam marcados." }
        : { title: `${ok} imóvel(is) com preço atualizado no site` });
    },
  });

  const mudarPreco = (i: ImovelDoCadastro, campo: keyof Preco, texto: string) => {
    const valor = texto === "" ? null : Math.max(0, Number(texto));
    if (Number.isNaN(valor)) return;
    setPrecos((atual) => {
      const proximo = { ...atual[i.id], [campo]: valor };
      if (proximo.price === i.price) delete proximo.price;
      if (proximo.price_from === i.price_from) delete proximo.price_from;
      const resto = { ...atual };
      delete resto[i.id];
      return Object.keys(proximo).length ? { ...resto, [i.id]: proximo } : resto;
    });
  };

  const aplicarReajuste = () => {
    const pct = Number(reajuste.replace(",", "."));
    if (!reajuste.trim() || !Number.isFinite(pct)) {
      toast({ variant: "destructive", title: "Informe o reajuste em %, ex.: 5 ou -3" });
      return;
    }
    const novo = (v: number | null) => (v == null ? undefined : Math.max(0, Math.round(v * (1 + pct / 100))));
    setPrecos((atual) => {
      const proximo = { ...atual };
      for (const i of filtrados) {
        const base = { price: atual[i.id]?.price ?? i.price, price_from: atual[i.id]?.price_from ?? i.price_from };
        const p: Preco = { price: novo(base.price), price_from: novo(base.price_from) };
        if (p.price === undefined) delete p.price;
        if (p.price_from === undefined) delete p.price_from;
        if (Object.keys(p).length) proximo[i.id] = p;
      }
      return proximo;
    });
    toast({ title: `Reajuste de ${pct}% marcado em ${filtrados.length} imóvel(is)`, description: "Confira e clique em Salvar." });
  };

  const baixar = () => {
    const url = URL.createObjectURL(new Blob([gerarPlanilha(filtrados)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `precos-imoveis-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const subir = async (file: File | undefined) => {
    if (!file) return;
    const { linhas, erros } = lerPlanilha(await file.text());
    const porId = new Map(lista.map((i) => [i.id, i]));
    const porCodigo = new Map(lista.map((i) => [i.code.trim().toLowerCase(), i]));
    const marcados: Record<string, Preco> = {};
    let naoEncontrados = 0;
    for (const l of linhas) {
      const i = porId.get(l.id) ?? porCodigo.get(l.code.trim().toLowerCase());
      if (!i) { naoEncontrados++; continue; }
      // Célula vazia = não mexe.
      const p: Preco = {};
      if (l.price != null && l.price !== i.price) p.price = l.price;
      if (l.from != null && l.from !== i.price_from) p.price_from = l.from;
      if (Object.keys(p).length) marcados[i.id] = p;
    }
    setPrecos((atual) => ({ ...atual, ...marcados }));
    const avisos = [...erros.slice(0, 3), naoEncontrados ? `${naoEncontrados} linha(s) sem imóvel correspondente.` : ""].filter(Boolean);
    toast({
      variant: erros.length ? "destructive" : "default",
      title: `${Object.keys(marcados).length} imóvel(is) com preço novo marcado`,
      description: [...avisos, "Confira e clique em Salvar."].join(" "),
    });
  };

  if (!isAdmin) {
    return <EmptyState icon={Building2} title="Só admin e sócios" description="O cadastro de imóveis e preços é restrito à administração." />;
  }

  return (
    <div className="space-y-6">
      <Link to="/central/mapa" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Mapa de Imóveis
      </Link>
      <PageHeader
        icon={Building2}
        eyebrow="Administração do site"
        title="Imóveis e preços"
        description="O que você salva aqui aparece no site na hora."
        actions={
          <>
            <Button variant="outline" onClick={baixar} disabled={filtrados.length === 0}>
              <Download className="h-4 w-4" /> Baixar planilha
            </Button>
            <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={lista.length === 0}>
              <Upload className="h-4 w-4" /> Subir planilha
            </Button>
            <input
              ref={arquivo} type="file" accept=".csv,text/csv" className="hidden" aria-label="Planilha de preços"
              onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ""; }}
            />
          </>
        }
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label htmlFor="busca-imovel">Buscar</Label>
          <Input id="busca-imovel" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, nome, cidade…" />
        </div>
        <div className="w-56 space-y-1">
          <Label htmlFor="filtro-construtora">Construtora</Label>
          <Select value={construtora} onValueChange={setConstrutora}>
            <SelectTrigger id="filtro-construtora"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas</SelectItem>
              {construtoras.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32 space-y-1">
          <Label htmlFor="reajuste">Reajuste (%)</Label>
          <Input id="reajuste" inputMode="decimal" value={reajuste} onChange={(e) => setReajuste(e.target.value)} placeholder="ex.: 5" />
        </div>
        <Button variant="outline" onClick={aplicarReajuste} disabled={filtrados.length === 0}>
          <Percent className="h-4 w-4" /> Aplicar nos {filtrados.length} filtrados
        </Button>
      </Card>

      {pendentes > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/50 bg-warning/10 p-4">
          <p className="text-sm font-medium">{pendentes} imóvel(is) com preço mudado, ainda não salvo.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPrecos({})} disabled={salvarPrecos.isPending}>
              <Undo2 className="h-4 w-4" /> Descartar
            </Button>
            <Button onClick={() => salvarPrecos.mutate()} disabled={salvarPrecos.isPending}>
              <Save className="h-4 w-4" /> {salvarPrecos.isPending ? "Salvando…" : `Salvar ${pendentes}`}
            </Button>
          </div>
        </Card>
      )}

      {imoveis.isError ? (
        <p role="alert" className="text-sm text-destructive">{describeError(imoveis.error, "Não consegui carregar os imóveis.")}</p>
      ) : imoveis.isPending ? (
        <LoadingState variant="block" rows={4} label="Carregando os imóveis…" />
      ) : filtrados.length === 0 ? (
        <EmptyState icon={Building2} title="Nenhum imóvel encontrado" description="Mude a busca ou a construtora." />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead className="w-40">Preço (R$)</TableHead>
                <TableHead className="w-40">A partir de (R$)</TableHead>
                <TableHead className="w-20 text-center">Ativo</TableHead>
                <TableHead className="w-20 text-center">Destaque</TableHead>
                <TableHead className="w-24"><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((i) => {
                const p = precos[i.id];
                const valor = (campo: keyof Preco) => {
                  const v = p && campo in p ? p[campo] : i[campo];
                  return v == null ? "" : String(v);
                };
                return (
                  <TableRow key={i.id} className={cn(p && "bg-warning/10", !i.active && "opacity-60")}>
                    <TableCell>
                      <p className="font-medium">{i.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.code} · {i.city}{i.developer ? ` · ${i.developer}` : ""} · {STATUS_DO_IMOVEL[i.status]}
                      </p>
                    </TableCell>
                    {(["price", "price_from"] as const).map((campo) => (
                      <TableCell key={campo}>
                        <Input
                          type="number" min={0} step="0.01" inputMode="decimal" value={valor(campo)}
                          onChange={(e) => mudarPreco(i, campo, e.target.value)}
                          aria-label={`${campo === "price" ? "Preço" : "A partir de"} de ${i.title}`}
                          className={cn(p && campo in p && "border-warning")}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-center">
                      <Switch
                        checked={i.active} disabled={salvarUm.isPending} aria-label={`${i.title} ativo no site`}
                        onCheckedChange={(v) => salvarUm.mutate({ id: i.id, alteracao: { active: v } })}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={i.featured} disabled={salvarUm.isPending} aria-label={`${i.title} em destaque`}
                        onCheckedChange={(v) => salvarUm.mutate({ id: i.id, alteracao: { featured: v } })}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setEditando(i)} aria-label={`Editar ${i.title}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" asChild>
                          <a href={`${SITE_PUBLICO}/imovel/${i.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${i.title} no site`}>
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(editando)} onOpenChange={(o) => { if (!o) setEditando(null); }}>
        <DialogContent>
          {editando && (
            <EditarImovel
              imovel={editando}
              salvando={salvarUm.isPending}
              onSalvar={(alteracao) => salvarUm.mutate({ id: editando.id, alteracao })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditarImovel({ imovel, salvando, onSalvar }: {
  imovel: ImovelDoCadastro; salvando: boolean; onSalvar: (a: AlteracaoDoImovel) => void;
}) {
  const [status, setStatus] = useState<StatusDoImovel>(imovel.status);

  const enviar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texto = (nome: string) => String(f.get(nome) ?? "").trim();
    const title = texto("title");
    const city = texto("city");
    if (!title || !city) {
      toast({ variant: "destructive", title: "Nome e cidade são obrigatórios." });
      return;
    }
    const quartos = texto("bedrooms");
    onSalvar({
      title, city, status,
      neighborhood: texto("neighborhood") || null,
      developer: texto("developer") || null,
      bedrooms: quartos ? Math.max(0, Math.trunc(Number(quartos))) : null,
    });
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Editar imóvel</DialogTitle>
        <DialogDescription>{imovel.code} · fotos, descrição e book seguem no painel do site.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="im-title">Nome do empreendimento</Label>
          <Input id="im-title" name="title" defaultValue={imovel.title} required maxLength={200} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="im-city">Cidade</Label>
          <Input id="im-city" name="city" defaultValue={imovel.city} required maxLength={100} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="im-neighborhood">Bairro</Label>
          <Input id="im-neighborhood" name="neighborhood" defaultValue={imovel.neighborhood ?? ""} maxLength={100} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="im-developer">Construtora</Label>
          <Input id="im-developer" name="developer" defaultValue={imovel.developer ?? ""} maxLength={100} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="im-bedrooms">Dormitórios</Label>
          <Input id="im-bedrooms" name="bedrooms" type="number" min={0} max={20} defaultValue={imovel.bedrooms ?? ""} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="im-status">Situação da obra</Label>
          <Select value={status} onValueChange={(v) => { if (ehStatus(v)) setStatus(v); }}>
            <SelectTrigger id="im-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_DO_IMOVEL).map(([v, nome]) => <SelectItem key={v} value={v}>{nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </DialogFooter>
    </form>
  );
}
