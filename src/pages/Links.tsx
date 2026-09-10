import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, ArrowDown, ArrowUp, Link2, Plus, ExternalLink, Copy, Pencil, Trash2, Save } from "lucide-react";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";

type LinkRow = { id: string; title: string; url: string; category: string | null; sort_order: number; active: boolean };

/** Falha de rede, 500 e timeout não têm `code`: sem orientação no fallback,
 *  `describeError` devolve a paráfrase do título e a tela repete a frase. */
const TENTE_DE_NOVO = 'A consulta não respondeu. Verifique a conexão e use "Tentar de novo".';

const TODAS = "__todas__";
const SEM_CATEGORIA = "geral";

/**
 * URL absoluta com http(s).
 *
 * Sem isto, "banana" era gravado e o card virava um link relativo que navegava
 * para `/banana` dentro do próprio app — um link quebrado que parece uma tela
 * quebrada. O check `useful_links_url_absolute` (0063) repete a regra no banco.
 */
// eslint-disable-next-line react-refresh/only-export-components -- validação pura, exportada para o vitest; não é componente e não afeta o HMR do que importa.
export const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();

export default function Links() {
  // `isAdmin` do contexto sai dos papéis efetivos: respeita a prévia "Ver como
  // corretor" do cabeçalho. `role === "admin"` era o papel real e ignorava a prévia.
  const { isAdmin } = useAuth();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<LinkRow> | null>(null);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [categoria, setCategoria] = useState(TODAS);
  /** Frase da última reordenação, para o leitor de tela. A lista se reordena
   *  em silêncio: sem isto, quem não vê a tela aciona a seta e não recebe
   *  retorno nenhum — só o fracasso falava (toast de erro). */
  const [anuncio, setAnuncio] = useState("");
  /** Botões de seta por `id|up`/`id|down`, para devolver o foco depois de mover. */
  const setas = useRef(new Map<string, HTMLButtonElement | null>());
  /** Chave da seta que deve receber o foco no próximo commit. */
  const [foco, setFoco] = useState<string | null>(null);

  // A seta clicada some do foco quando o link chega à ponta (ela vira
  // `disabled` e o navegador joga o foco no <body>): quem navega por teclado
  // teria de varrer a página inteira com Tab. Depois do commit, o foco volta
  // para a seta oposta do MESMO link.
  useEffect(() => {
    if (!foco) return;
    setas.current.get(foco)?.focus();
    setFoco(null);
  }, [foco]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // Sem filtro de `active`: `useful_links_select` já entrega o inativo só ao
    // admin. Filtrar aqui deixava o link desativado invisível PARA SEMPRE,
    // inclusive para quem poderia reativá-lo.
    const { data, error } = await supabase.from("useful_links").select("*").order("sort_order").order("label");
    setLoading(false);
    // Sem este `return`, a falha caía em `links = []` e a tela afirmava "nenhum
    // link cadastrado" — o toast some e a mentira fica.
    if (error) return setLoadError(describeError(error, TENTE_DE_NOVO));
    setLinks((data || []).map(row => ({ ...row, title: row.label })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const categorias = useMemo(
    () => Array.from(new Set(links.map(l => (l.category || SEM_CATEGORIA).trim()))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [links],
  );

  const visiveis = useMemo(
    () => links.filter(l => categoria === TODAS || (l.category || SEM_CATEGORIA).trim() === categoria),
    [links, categoria],
  );

  /** A coluna `category` estava preenchida e a tela só imprimia o texto ao lado da URL. */
  const grupos = useMemo(() => {
    const map = new Map<string, LinkRow[]>();
    visiveis.forEach(l => {
      const key = (l.category || SEM_CATEGORIA).trim();
      map.set(key, [...(map.get(key) ?? []), l]);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [visiveis]);

  const copyLink = async (url: string) => {
    try {
      // `writeText` rejeita em http, sem permissão ou com a aba sem foco: sem o
      // await o "Link copiado" saía mesmo quando nada foi para a área de transferência.
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado" });
    } catch (e) {
      toast({ title: "Não foi possível copiar", description: describeError(e, "Copie o link manualmente."), variant: "destructive" });
    }
  };

  const save = async () => {
    const title = (edit?.title ?? "").trim();
    const url = (edit?.url ?? "").trim();
    if (!title || !url) return toast({ title: "Preencha nome e URL", variant: "destructive" });
    if (!isHttpUrl(url)) {
      return toast({
        title: "URL inválida",
        description: "Comece com https:// — sem isso o card vira um link para dentro do próprio sistema.",
        variant: "destructive",
      });
    }
    const repetido = links.find(l => l.id !== edit?.id && normalizeUrl(l.url) === normalizeUrl(url));
    if (repetido) {
      return toast({
        title: "Esse link já está cadastrado",
        description: `A mesma URL já aparece como "${repetido.title}".`,
        variant: "destructive",
      });
    }
    setSaving(true);
    const payload = {
      label: title,
      url,
      category: (edit?.category || SEM_CATEGORIA).trim(),
      sort_order: edit?.sort_order ?? 0,
      // Preserva o estado: gravar `true` fixo reativava sem querer o link que o
      // admin acabara de desativar.
      active: edit?.active ?? true,
    };
    const { data, error } = edit?.id
      ? await supabase.from("useful_links").update(payload).eq("id", edit.id).select("id")
      : await supabase.from("useful_links").insert(payload).select("id");
    setSaving(false);
    if (error) return toast({ title: "Erro ao salvar", description: describeError(error, "Não foi possível salvar o link."), variant: "destructive" });
    // O RLS não erra ao recusar: filtra a linha e o PostgREST devolve 204.
    if (!data?.length) return toast({ title: "Sem permissão para salvar links (apenas administrador).", variant: "destructive" });
    toast({ title: "Salvo!" });
    setEdit(null); void load();
  };

  const toggleActive = async (link: LinkRow) => {
    const { data, error } = await supabase
      .from("useful_links")
      .update({ active: !link.active })
      .eq("id", link.id)
      .select("id");
    if (error) return toast({ title: "Erro ao atualizar", description: describeError(error, "Não foi possível atualizar o link."), variant: "destructive" });
    if (!data?.length) return toast({ title: "Sem permissão para alterar links (apenas administrador).", variant: "destructive" });
    setLinks(prev => prev.map(l => (l.id === link.id ? { ...l, active: !l.active } : l)));
    toast({ title: link.active ? "Link desativado" : "Link reativado" });
  };

  /**
   * Sobe ou desce o link DENTRO da categoria.
   *
   * A ordem só existia como número digitado no formulário, e o estado normal do
   * banco é todo mundo em zero: trocar dois valores iguais não muda nada. Por
   * isso a gravação renumera o grupo por posição (0, 1, 2…) e manda só as linhas
   * cujo número mudou — o empate morre na primeira movimentação.
   *
   * Botão em vez de arrastar de propósito: arrastar não tem equivalente de
   * teclado nem de leitor de tela, e a lista da operação tem poucos itens por
   * categoria.
   *
   * ponytail: um UPDATE por linha renumerada; vira um RPC em lote se alguma
   * categoria passar de algumas dezenas de links.
   */
  const move = async (link: LinkRow, direcao: -1 | 1) => {
    const chave = (link.category || SEM_CATEGORIA).trim();
    const grupo = grupos.find(([g]) => g === chave)?.[1] ?? [];
    const de = grupo.findIndex(l => l.id === link.id);
    const para = de + direcao;
    if (de < 0 || para < 0 || para >= grupo.length) return;

    const ordenado = [...grupo];
    [ordenado[de], ordenado[para]] = [ordenado[para], ordenado[de]];
    const renumerado = ordenado
      .map((l, posicao) => ({ l, posicao }))
      .filter(({ l, posicao }) => l.sort_order !== posicao);

    setMoving(link.id);
    for (const { l, posicao } of renumerado) {
      const { data, error } = await supabase.from("useful_links").update({ sort_order: posicao }).eq("id", l.id).select("id");
      if (error) {
        setMoving(null);
        // O UPDATE anterior do laço já gravou: sem recarregar, a tela ficaria
        // na ordem antiga e o banco numa ordem que ninguém pediu — igual ao
        // ramo de recusa do RLS logo abaixo.
        void load();
        return toast({ title: "Erro ao reordenar", description: describeError(error, "Não foi possível reordenar os links."), variant: "destructive" });
      }
      // O RLS não erra ao recusar: filtra a linha e devolve 204. Sem esta
      // conferência a lista se reordenava na tela e voltava no próximo F5.
      if (!data?.length) {
        setMoving(null);
        void load();
        return toast({ title: "Sem permissão para reordenar links (apenas administrador).", variant: "destructive" });
      }
    }
    setMoving(null);
    setAnuncio(`${link.title} movido para a posição ${para + 1} de ${grupo.length} em ${chave}.`);
    // Na ponta a seta acionada vira `disabled`; o foco vai para a oposta do
    // mesmo link. Fora da ponta ela continua válida e o foco volta para ela.
    const naPonta = direcao === -1 ? para === 0 : para === grupo.length - 1;
    const oposta = direcao === -1 ? "down" : "up";
    const mesma = direcao === -1 ? "up" : "down";
    setFoco(`${link.id}|${naPonta ? oposta : mesma}`);
    // A mesma ordenação do `select` (sort_order, depois nome): sem reordenar o
    // array, o número novo entrava no estado e a lista continuava na tela antiga.
    setLinks(prev =>
      prev
        .map(l => {
          const novo = renumerado.find(r => r.l.id === l.id);
          return novo ? { ...l, sort_order: novo.posicao } : l;
        })
        .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "pt-BR")),
    );
  };

  const remove = async (link: LinkRow) => {
    if (!confirm(`Excluir "${link.title}"? Para tirar da lista sem perder o cadastro, desative.`)) return;
    const { data, error } = await supabase.from("useful_links").delete().eq("id", link.id).select("id");
    if (error) return toast({ title: "Erro ao excluir", description: describeError(error, "Não foi possível excluir o link."), variant: "destructive" });
    if (!data?.length) return toast({ title: "Sem permissão para excluir links (apenas administrador).", variant: "destructive" });
    setLinks(prev => prev.filter(l => l.id !== link.id));
    toast({ title: "Link excluído" });
  };

  return (
    <div className="space-y-6">
      {/* Região viva em vez de toast: cinco cliques seguidos empilhariam cinco
          toasts, e a frase aqui é substituída a cada movimento. */}
      <p aria-live="polite" className="sr-only">{anuncio}</p>
      <PageHeader
        title="Links"
        eyebrow="Operação"
        icon={Link2}
        description="Links úteis da operação"
        actions={
          <>
            {categorias.length > 1 && (
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filtrar por categoria"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODAS}>Todas as categorias</SelectItem>
                  {categorias.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {isAdmin && (
              <Button size="sm" onClick={() => setEdit({ title: "", url: "", category: "", sort_order: 0, active: true })}>
                <Plus className="h-4 w-4 mr-2" /> Novo Link
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <LoadingState variant="list" rows={4} label="Carregando links…" />
      ) : loadError ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar os links"
          description={loadError}
          action={<Button variant="outline" onClick={() => void load()}>Tentar de novo</Button>}
        />
      ) : links.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Nenhum link cadastrado ainda"
          description={isAdmin ? "Cadastre o primeiro link da operação." : "Peça ao administrador para cadastrar os links da operação."}
        />
      ) : visiveis.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Nenhum link nesta categoria"
          description="Volte para 'Todas as categorias' para ver a lista inteira."
          action={<Button variant="outline" onClick={() => setCategoria(TODAS)}>Limpar filtro</Button>}
        />
      ) : (
        <div className="space-y-5">
          {grupos.map(([grupo, itens]) => (
            <section key={grupo} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{grupo}</h2>
              {/* `grid-cols-1` e não só `grid`: sem trilha declarada a coluna é
                  `auto`, cujo mínimo é o min-content do cartão — e `truncate`
                  (que é `white-space: nowrap`) faz o min-content do nome e da URL
                  valerem a linha INTEIRA. O cartão então empurrava a página para
                  além dos 375 px em vez de recortar o texto: rolagem horizontal no
                  celular, com o texto passando por baixo da borda. `minmax(0,1fr)`
                  dá mínimo zero à trilha e devolve o corte ao `truncate`. */}
              <div className="grid grid-cols-1 gap-2">
                {itens.map((l, i) => (
                  <Card key={l.id} className="glass hover:bg-secondary/50 transition-colors">
                    <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0"><Link2 className="h-4 w-4 text-primary" /></div>
                        <div className="min-w-0">
                          {/* O `truncate` fica no <span>, não no <p>: num container
                              flex a reticência não sai no filho, e o nome comprido
                              era cortado no meio da letra, sem o "…" que a URL
                              logo abaixo já mostrava. */}
                          <p className="font-medium text-sm flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{l.title}</span>
                            {!l.active && <StatusBadge tone="neutral" className="shrink-0">inativo</StatusBadge>}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{l.url}</p>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Copiar link ${l.title}`} onClick={() => void copyLink(l.url)}><Copy className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild><a href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${l.title}`}><ExternalLink className="h-4 w-4" /></a></Button>
                        {isAdmin && <>
                          {/* Reordenar dentro da categoria. Desabilitado nas
                              pontas: um botão que não faz nada é pior que um
                              botão que diz que não dá. */}
                          <Button ref={(el) => { setas.current.set(`${l.id}|up`, el); }} variant="ghost" size="icon" className="h-8 w-8" aria-label={`Subir ${l.title}`} disabled={i === 0 || moving !== null} onClick={() => void move(l, -1)}><ArrowUp className="h-4 w-4" /></Button>
                          <Button ref={(el) => { setas.current.set(`${l.id}|down`, el); }} variant="ghost" size="icon" className="h-8 w-8" aria-label={`Descer ${l.title}`} disabled={i === itens.length - 1 || moving !== null} onClick={() => void move(l, 1)}><ArrowDown className="h-4 w-4" /></Button>
                          <Switch checked={l.active} onCheckedChange={() => toggleActive(l)} aria-label={`Link ${l.title} ativo`} />
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${l.title}`} onClick={() => setEdit(l)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Excluir ${l.title}`} onClick={() => remove(l)}><Trash2 className="h-4 w-4" /></Button>
                        </>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Editar Link" : "Novo Link"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="link-nome">Nome</Label><Input id="link-nome" value={edit?.title || ""} onChange={e => setEdit(p => ({ ...p, title: e.target.value }))} /></div>
            <div>
              <Label htmlFor="link-url">URL</Label>
              <Input id="link-url" type="url" value={edit?.url || ""} onChange={e => setEdit(p => ({ ...p, url: e.target.value }))} placeholder="https://..." />
              <p className="mt-1 text-xs text-muted-foreground">Precisa começar com https:// — o endereço é aberto em outra aba.</p>
            </div>
            <div><Label htmlFor="link-categoria">Categoria</Label><Input id="link-categoria" value={edit?.category || ""} onChange={e => setEdit(p => ({ ...p, category: e.target.value }))} placeholder="ferramentas, consultas..." /></div>
            <div>
              <Label htmlFor="link-ordem">Ordem</Label>
              <Input id="link-ordem" type="number" value={edit?.sort_order ?? 0} onChange={e => setEdit(p => ({ ...p, sort_order: Number(e.target.value) }))} />
              {/* O campo era um número sem explicação: ninguém sabia se o maior
                  ou o menor sobe, nem que a ordenação é DENTRO da categoria. */}
              <p className="mt-1 text-xs text-muted-foreground">Menor aparece primeiro, dentro da categoria. Empate ordena pelo nome. Na lista, as setas para cima e para baixo reordenam sem digitar número.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
