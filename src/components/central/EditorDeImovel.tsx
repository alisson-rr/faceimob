import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileText, ImagePlus, Save, Star, Trash2, Upload } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState, StatusBadge } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { STATUS_DO_IMOVEL, type StatusDoImovel } from "@/integrations/supabase/central";
import {
  carregarFicha, fichaVazia, linkDoBook, listarFotos, ordenarFotos, proximoCodigo, removerBook, removerFotos,
  salvarFicha, subirBook, subirFotos, type FichaDoImovel, type FotoDoImovel, type Proprietario,
} from "@/integrations/supabase/siteImoveis";
import { toWebp } from "@/lib/imagemWebp";
import { describeError } from "@/lib/supabaseError";
import { slugify } from "@/lib/utils";

type CampoNumerico = "price" | "price_from" | "monthly_installment" | "down_payment" | "subsidy_estimate"
  | "area_sqm" | "bedrooms" | "bathrooms" | "parking_spots";

const NUMEROS: { campo: CampoNumerico; rotulo: string; inteiro?: boolean }[] = [
  { campo: "bedrooms", rotulo: "Dormitórios", inteiro: true },
  { campo: "bathrooms", rotulo: "Banheiros", inteiro: true },
  { campo: "parking_spots", rotulo: "Vagas", inteiro: true },
  { campo: "area_sqm", rotulo: "Área (m²)" },
  { campo: "price", rotulo: "Preço (R$)" },
  { campo: "price_from", rotulo: "A partir de (R$)" },
  { campo: "monthly_installment", rotulo: "Parcela (R$)" },
  { campo: "down_payment", rotulo: "Entrada (R$)" },
  { campo: "subsidy_estimate", rotulo: "Subsídio estimado (R$)" },
];

type CampoDeTexto = "subtitle" | "neighborhood" | "address" | "developer" | "video_url" | "tour_url"
  | "highlight_text" | "seo_title" | "seo_description" | "description";

const ehStatus = (v: string): v is StatusDoImovel => v in STATUS_DO_IMOVEL;
const linhas = (texto: string) => texto.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);

/**
 * Editor completo do imóvel do site dentro do CRM (05/10/2026): dados, preços,
 * textos, proprietário, book e galeria. Book e fotos só depois do primeiro
 * "Salvar", porque o arquivo vai para a pasta do imóvel.
 */
export function EditorDeImovel({ id, construtoras, onFechar, onCriado }: {
  id: string | null; construtoras: string[]; onFechar: () => void; onCriado: (id: string) => void;
}) {
  const carregado = useQuery({
    queryKey: ["central", "imovel", id ?? "novo"],
    queryFn: async () => (id
      ? carregarFicha(id)
      : { ficha: fichaVazia(await proximoCodigo()), dono: { owner_name: "", owner_phone: "" } }),
    staleTime: Infinity,
    gcTime: 0,
  });

  if (carregado.isError) {
    return <p role="alert" className="text-sm text-destructive">{describeError(carregado.error, "Não consegui abrir o imóvel.")}</p>;
  }
  if (!carregado.data) return <LoadingState variant="block" rows={4} label="Abrindo o imóvel…" />;
  return (
    <Formulario
      key={id ?? "novo"} id={id} inicial={carregado.data} construtoras={construtoras} onFechar={onFechar} onCriado={onCriado}
    />
  );
}

function Formulario({ id, inicial, construtoras, onFechar, onCriado }: {
  id: string | null; inicial: { ficha: FichaDoImovel; dono: Proprietario }; construtoras: string[];
  onFechar: () => void; onCriado: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [ficha, setFicha] = useState(inicial.ficha);
  const [dono, setDono] = useState(inicial.dono);

  const salvar = useMutation({
    mutationFn: (f: FichaDoImovel) => salvarFicha(id, f, dono),
    onSuccess: (novoId) => {
      void queryClient.invalidateQueries({ queryKey: ["central", "imoveis-cadastro"] });
      void queryClient.invalidateQueries({ queryKey: ["central", "mapa"] });
      toast({ title: id ? "Imóvel atualizado no site" : "Imóvel criado. Agora você pode subir as fotos e o book." });
      if (!id) onCriado(novoId);
    },
    onError: (e) => toast({ variant: "destructive", title: describeError(e, "Não consegui salvar o imóvel.") }),
  });

  const set = <K extends keyof FichaDoImovel>(k: K, v: FichaDoImovel[K]) => setFicha((f) => ({ ...f, [k]: v }));
  const texto = (k: CampoDeTexto) => ({
    value: ficha[k] ?? "",
    onChange: (e: { target: { value: string } }) => set(k, e.target.value || null),
  });

  const enviar = () => {
    if (!ficha.title.trim() || !ficha.city.trim() || !ficha.code.trim()) {
      toast({ variant: "destructive", title: "Preencha nome, código e cidade." });
      return;
    }
    salvar.mutate({ ...ficha, title: ficha.title.trim(), city: ficha.city.trim(), code: ficha.code.trim() });
  };

  return (
    <div className="space-y-6">
      <button type="button" onClick={onFechar} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Imóveis e preços
      </button>
      <h1 className="font-display text-2xl font-bold">{id ? ficha.title || "Editar imóvel" : "Novo imóvel"}</h1>

      <Secao titulo="Dados do empreendimento">
        <Campo id="im-title" rotulo="Nome do empreendimento" largo>
          <Input id="im-title" value={ficha.title} maxLength={200} required
            onChange={(e) => {
              const t = e.target.value;
              setFicha((f) => ({ ...f, title: t, slug: id ? f.slug : slugify(t) }));
            }} />
        </Campo>
        <Campo id="im-code" rotulo="Código">
          <Input id="im-code" value={ficha.code} maxLength={30} onChange={(e) => set("code", e.target.value)} />
        </Campo>
        <Campo id="im-slug" rotulo="Endereço no site (/imovel/…)">
          <Input id="im-slug" value={ficha.slug} maxLength={120} onChange={(e) => set("slug", e.target.value.toLowerCase())}
            onBlur={(e) => set("slug", slugify(e.target.value))} />
        </Campo>
        <Campo id="im-subtitle" rotulo="Subtítulo" largo><Input id="im-subtitle" maxLength={200} {...texto("subtitle")} /></Campo>
        <Campo id="im-city" rotulo="Cidade">
          <Input id="im-city" value={ficha.city} maxLength={100} onChange={(e) => set("city", e.target.value)} />
        </Campo>
        <Campo id="im-neighborhood" rotulo="Bairro"><Input id="im-neighborhood" maxLength={100} {...texto("neighborhood")} /></Campo>
        <Campo id="im-state" rotulo="UF">
          <Input id="im-state" value={ficha.state} maxLength={2} onChange={(e) => set("state", e.target.value.toUpperCase())} />
        </Campo>
        <Campo id="im-address" rotulo="Endereço"><Input id="im-address" maxLength={200} {...texto("address")} /></Campo>
        <Campo id="im-developer" rotulo="Construtora">
          <Input id="im-developer" list="im-construtoras" maxLength={100} {...texto("developer")} />
          <datalist id="im-construtoras">{construtoras.map((c) => <option key={c} value={c} />)}</datalist>
        </Campo>
        <Campo id="im-status" rotulo="Situação da obra">
          <Select value={ficha.status} onValueChange={(v) => { if (ehStatus(v)) set("status", v); }}>
            <SelectTrigger id="im-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_DO_IMOVEL).map(([v, nome]) => <SelectItem key={v} value={v}>{nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </Campo>
        <Campo id="im-delivery" rotulo="Entrega">
          <Input id="im-delivery" type="date" value={ficha.delivery_date ?? ""} onChange={(e) => set("delivery_date", e.target.value || null)} />
        </Campo>
      </Secao>

      <Secao titulo="Números e valores">
        {NUMEROS.map(({ campo, rotulo, inteiro }) => (
          <Campo key={campo} id={`im-${campo}`} rotulo={rotulo}>
            <Input
              id={`im-${campo}`} type="number" min={0} step={inteiro ? 1 : "0.01"} inputMode="decimal"
              value={ficha[campo] ?? ""}
              onChange={(e) => {
                const n = e.target.value === "" ? null : Number(e.target.value);
                if (n === null || (Number.isFinite(n) && n >= 0)) set(campo, n === null ? null : inteiro ? Math.trunc(n) : n);
              }}
            />
          </Campo>
        ))}
      </Secao>

      <Secao titulo="Textos do site">
        <Campo id="im-description" rotulo="Descrição" largo>
          <Textarea id="im-description" rows={6} maxLength={8000} {...texto("description")} />
        </Campo>
        <Campo id="im-highlight" rotulo="Texto de destaque" largo><Input id="im-highlight" maxLength={200} {...texto("highlight_text")} /></Campo>
        <Campo id="im-differentials" rotulo="Diferenciais (um por linha)">
          <Textarea id="im-differentials" rows={5} value={ficha.differentials.join("\n")} onChange={(e) => set("differentials", e.target.value.split("\n"))}
            onBlur={(e) => set("differentials", linhas(e.target.value))} />
        </Campo>
        <Campo id="im-amenities" rotulo="Lazer e comodidades (um por linha)">
          <Textarea id="im-amenities" rows={5} value={ficha.amenities.join("\n")} onChange={(e) => set("amenities", e.target.value.split("\n"))}
            onBlur={(e) => set("amenities", linhas(e.target.value))} />
        </Campo>
        <Campo id="im-video" rotulo="Vídeo (link)"><Input id="im-video" type="url" maxLength={500} {...texto("video_url")} /></Campo>
        <Campo id="im-tour" rotulo="Tour virtual (link)"><Input id="im-tour" type="url" maxLength={500} {...texto("tour_url")} /></Campo>
        <Campo id="im-seo-title" rotulo="Título para o Google"><Input id="im-seo-title" maxLength={70} {...texto("seo_title")} /></Campo>
        <Campo id="im-seo-desc" rotulo="Descrição para o Google"><Input id="im-seo-desc" maxLength={160} {...texto("seo_description")} /></Campo>
      </Secao>

      <Secao titulo="Proprietário (só a administração vê)">
        <Campo id="im-owner" rotulo="Nome">
          <Input id="im-owner" maxLength={120} value={dono.owner_name} onChange={(e) => setDono((d) => ({ ...d, owner_name: e.target.value }))} />
        </Campo>
        <Campo id="im-owner-phone" rotulo="Telefone">
          <Input id="im-owner-phone" type="tel" maxLength={30} value={dono.owner_phone} onChange={(e) => setDono((d) => ({ ...d, owner_phone: e.target.value }))} />
        </Campo>
      </Secao>

      <Card className="flex flex-wrap items-center gap-6 p-5">
        {([["is_mcmv", "Minha Casa Minha Vida"], ["featured", "Destaque na home"], ["active", "Ativo no site"]] as const).map(([k, rotulo]) => (
          <label key={k} className="inline-flex items-center gap-2 text-sm">
            <Switch checked={ficha[k]} onCheckedChange={(v) => set(k, v)} /> {rotulo}
          </label>
        ))}
        <Button className="ml-auto" onClick={enviar} disabled={salvar.isPending}>
          <Save className="h-4 w-4" /> {salvar.isPending ? "Salvando…" : id ? "Salvar" : "Criar imóvel"}
        </Button>
      </Card>

      {id ? (
        <>
          <Book imovelId={id} caminho={ficha.book_path} onMudou={(b) => setFicha((f) => ({ ...f, ...b }))} />
          <Galeria imovelId={id} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Fotos e book liberam depois de criar o imóvel.</p>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-display text-lg font-semibold">{titulo}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </Card>
  );
}

function Campo({ id, rotulo, largo, children }: { id: string; rotulo: string; largo?: boolean; children: ReactNode }) {
  return (
    <div className={largo ? "space-y-1 sm:col-span-2 lg:col-span-3" : "space-y-1"}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Book({ imovelId, caminho, onMudou }: {
  imovelId: string; caminho: string | null; onMudou: (b: { book_path: string | null; book_url: string | null }) => void;
}) {
  const arquivo = useRef<HTMLInputElement>(null);
  const enviar = useMutation({
    mutationFn: (pdf: File) => subirBook(imovelId, pdf, caminho),
    onSuccess: (b) => { onMudou(b); toast({ title: "Book enviado" }); },
    onError: (e) => toast({ variant: "destructive", title: describeError(e, "Não consegui enviar o book.") }),
  });
  const remover = useMutation({
    mutationFn: (c: string) => removerBook(imovelId, c),
    onSuccess: () => { onMudou({ book_path: null, book_url: null }); toast({ title: "Book removido" }); },
    onError: (e) => toast({ variant: "destructive", title: describeError(e, "Não consegui remover o book.") }),
  });
  const abrir = async (c: string) => {
    try {
      window.open(await linkDoBook(c), "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ variant: "destructive", title: describeError(e, "Não consegui abrir o book.") });
    }
  };

  return (
    <Card className="flex flex-wrap items-center gap-3 p-5">
      <h2 className="mr-auto font-display text-lg font-semibold">Book do empreendimento (PDF)</h2>
      {caminho && (
        <>
          <Button variant="outline" onClick={() => void abrir(caminho)}><FileText className="h-4 w-4" /> Ver book</Button>
          <Button variant="ghost" onClick={() => remover.mutate(caminho)} disabled={remover.isPending}>
            <Trash2 className="h-4 w-4" /> Remover
          </Button>
        </>
      )}
      <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={enviar.isPending}>
        <Upload className="h-4 w-4" /> {enviar.isPending ? "Enviando…" : caminho ? "Trocar PDF" : "Enviar PDF"}
      </Button>
      <input
        ref={arquivo} type="file" accept="application/pdf" className="hidden" aria-label="Book em PDF"
        onChange={(e) => {
          const pdf = e.target.files?.[0];
          e.target.value = "";
          if (!pdf) return;
          if (pdf.type !== "application/pdf") {
            toast({ variant: "destructive", title: "Envie um arquivo PDF." });
            return;
          }
          enviar.mutate(pdf);
        }}
      />
    </Card>
  );
}

function Galeria({ imovelId }: { imovelId: string }) {
  const queryClient = useQueryClient();
  const chave = ["central", "imovel-fotos", imovelId];
  const fotos = useQuery({ queryKey: chave, queryFn: () => listarFotos(imovelId) });
  const lista = fotos.data ?? [];
  const arquivo = useRef<HTMLInputElement>(null);
  const [apagarTodas, setApagarTodas] = useState(false);
  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: chave });
    void queryClient.invalidateQueries({ queryKey: ["central", "mapa"] });
  };
  const falhou = (msg: string) => (e: unknown) => toast({ variant: "destructive", title: describeError(e, msg) });

  const subir = useMutation({
    mutationFn: async (arquivos: File[]) => {
      const otimizadas = await Promise.all(arquivos.map(async (a) => (await toWebp(a)).file));
      return subirFotos(imovelId, otimizadas, lista.length);
    },
    onSuccess: (n) => toast({ title: `${n} foto(s) enviadas` }),
    onError: falhou("Não consegui enviar as fotos."),
    onSettled: atualizar,
  });
  const remover = useMutation({
    mutationFn: removerFotos,
    onSuccess: () => setApagarTodas(false),
    onError: falhou("Não consegui remover."),
    onSettled: atualizar,
  });
  const ordenar = useMutation({
    mutationFn: ordenarFotos,
    onMutate: (nova) => queryClient.setQueryData(chave, nova),
    onError: falhou("Não consegui salvar a ordem."),
    onSettled: atualizar,
  });

  const mover = (de: number, para: number) => {
    if (para < 0 || para >= lista.length) return;
    const nova = [...lista];
    const [foto] = nova.splice(de, 1);
    if (!foto) return;
    nova.splice(para, 0, foto);
    ordenar.mutate(nova);
  };
  const ocupado = subir.isPending || remover.isPending || ordenar.isPending;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-display text-lg font-semibold">Fotos ({lista.length})</h2>
        {lista.length > 0 && (
          <Button variant="ghost" onClick={() => setApagarTodas(true)} disabled={ocupado}>
            <Trash2 className="h-4 w-4" /> Remover todas
          </Button>
        )}
        <Button onClick={() => arquivo.current?.click()} disabled={ocupado}>
          <ImagePlus className="h-4 w-4" /> {subir.isPending ? "Enviando…" : "Enviar fotos"}
        </Button>
        <input
          ref={arquivo} type="file" accept="image/*" multiple className="hidden" aria-label="Fotos do imóvel"
          onChange={(e) => {
            const arquivos = [...(e.target.files ?? [])].filter((f) => f.type.startsWith("image/"));
            e.target.value = "";
            if (arquivos.length) subir.mutate(arquivos);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">A primeira foto é a capa. As fotos são otimizadas em WebP antes de subir.</p>

      {fotos.isPending ? (
        <LoadingState variant="block" rows={2} label="Carregando as fotos…" />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto ainda.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {lista.map((f: FotoDoImovel, i) => (
            <li key={f.id} className="overflow-hidden rounded-xl border border-border">
              <span className="relative block aspect-video bg-muted">
                <img src={f.src} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                {i === 0 && <span className="absolute left-2 top-2"><StatusBadge tone="success" icon={Star}>Capa</StatusBadge></span>}
              </span>
              <span className="flex items-center justify-between gap-1 p-1">
                <Button variant="ghost" size="icon" onClick={() => mover(i, i - 1)} disabled={ocupado || i === 0} aria-label={`Mover a foto ${i + 1} para trás`}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => mover(i, 0)} disabled={ocupado || i === 0}>Tornar capa</Button>
                <Button variant="ghost" size="icon" onClick={() => mover(i, i + 1)} disabled={ocupado || i === lista.length - 1} aria-label={`Mover a foto ${i + 1} para frente`}>
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remover.mutate([f])} disabled={ocupado} aria-label={`Remover a foto ${i + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={apagarTodas} onOpenChange={setApagarTodas}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover as {lista.length} fotos?</AlertDialogTitle>
            <AlertDialogDescription>Elas saem do site na hora e não dá para desfazer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); remover.mutate(lista); }}>Remover todas</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
