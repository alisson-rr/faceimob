import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { describeError } from "@/lib/supabaseError";
import { nameIssue, parseVariables, renderPreview, templateBlockers, templateIssues, VAR_ALIASES } from "./templateVars";
import { efeitosDaExclusaoTemplate, SEM_PERMISSAO, type Rlist, type Source, type WhatsAppTemplate } from "./types";

type Draft = Partial<WhatsAppTemplate>;
const NOVO: Draft = { name: "", language: "pt_BR", category: "MARKETING", body: "", variables: [], approved: false, active: true };

/** Códigos que a Meta usa. Campo livre gravava "pt-BR" (com hífen) e o erro só
 *  aparecia na Graph API, em tempo de envio. */
const IDIOMAS = ["pt_BR", "pt_PT", "en_US", "es_ES", "es_MX"];

export function WhatsAppTab({ templates, sources, lists, canWrite, reload }: {
  templates: WhatsAppTemplate[]; sources: Source[]; lists: Rlist[]; canWrite: boolean; reload: () => void;
}) {
  // `draft` só existe depois de o usuário clicar/editar; antes disso o painel
  // mostra o primeiro template. Antes a aba só alcançava `templates[0]`: sem
  // lista nem "Novo", digitar outro nome renomeava o template existente.
  const [draft, setDraft] = useState<Draft | null>(null);
  // Confirmação pelo AlertDialog do app, não pelo `confirm()` do navegador: o
  // nativo não é estilizado, ignora o tema, não é alcançável por teste de tela
  // e corta o texto que enumera o que perde o vínculo.
  const [excluindo, setExcluindo] = useState<WhatsAppTemplate | null>(null);
  // Sem isto, dois cliques em rede lenta viravam dois INSERT: `c.id` só é
  // preenchido depois do await, e o segundo esbarrava no unique(name).
  const [salvando, setSalvando] = useState(false);
  // Cancelar e Excluir desmontam o próprio botão: sem um alvo estável, o foco
  // cai no <body> e quem navega por teclado recomeça a página.
  const novoRef = useRef<HTMLButtonElement>(null);
  const focarNovoAoFechar = useRef(false);
  /** Assinatura do último Salvar aceito, para a marca de rascunho sujo. */
  const salvoAgora = useRef<string | null>(null);
  const c = draft ?? templates[0] ?? NOVO;
  const set = (patch: Draft) => setDraft({ ...c, ...patch });

  /** A linha do banco correspondente ao que está no formulário. Nula enquanto o
   *  rascunho for um template novo — que não tem o que excluir. */
  const gravado = templates.find(t => t.id === c.id) ?? null;
  const variaveis = c.variables ?? [];
  const bloqueios = templateBlockers(c.body || "", variaveis);
  const problemas = templateIssues(c.body || "", variaveis);
  const problemaNome = nameIssue(c.name || "");
  const idiomas = IDIOMAS.includes(c.language || "") ? IDIOMAS : [...IDIOMAS, c.language || "pt_BR"];
  /** O que iria para o banco — comparar por aqui evita listar campo a campo. */
  const gravavel = (t: Draft) => JSON.stringify([
    t.name ?? "", t.language ?? "pt_BR", t.category ?? "MARKETING", t.body ?? "",
    (t.variables ?? []).join(","), t.provider_template_id ?? "", !!t.approved, !!t.active,
  ]);
  // Trocar de template na lista descarta o rascunho. Sem marca, quem digitou e
  // clicou em outro item para "conferir uma coisa" perdia tudo em silêncio.
  // Compara com o último Salvar aceito TAMBÉM porque `reload()` é assíncrono:
  // entre o toast e a linha nova, só a versão antiga está em `templates`.
  const atual = gravavel(c);
  const sujo = !!draft && atual !== salvoAgora.current && atual !== gravavel(gravado ?? NOVO);

  async function save() {
    // Um toast por campo: "informe nome e mensagem" não dizia qual faltou.
    if (!c.name?.trim()) return toast.error("Informe o nome do template — é por ele que a Meta casa o disparo.");
    if (!c.body?.trim()) return toast.error("Informe a mensagem do template.");
    if (problemaNome) return toast.error(problemaNome);
    // A trava vale para o template que vai SAIR, e só para o que a Meta recusa
    // em qualquer caminho: contagem de parâmetros. Até aqui era só aviso na
    // tela, e um corpo com {{2}} e uma variável só era gravado — a conta ficava
    // com o cliente, em recusa da Graph API.
    // Template inativo continua gravável de propósito: desmarcar "ativo" é a
    // saída que o próprio diálogo de exclusão sugere para tirar de circulação
    // um template quebrado, e os dois envios já ignoram `active = false`.
    if (c.active && bloqueios.length > 0) {
      return toast.error(`${bloqueios[0]} Corrija antes de salvar ou desmarque “Template ativo” para arquivá-lo.`);
    }
    setSalvando(true);
    try {
      await gravar(c.name.trim(), c.body);
    } finally {
      setSalvando(false);
    }
  }

  async function gravar(name: string, body: string) {
    const payload = {
      name,
      language: c.language || "pt_BR",
      category: c.category || "MARKETING",
      body,
      variables: variaveis,
      provider_template_id: c.provider_template_id?.trim() || null,
      approved: !!c.approved,
      active: !!c.active,
    };
    const query = c.id
      ? supabase.from("whatsapp_templates").update(payload).eq("id", c.id)
      : supabase.from("whatsapp_templates").insert(payload);
    const { data, error } = await query.select("id");
    if (error) {
      // `whatsapp_templates_name_key` é único e o nome é o que vai para a Meta
      // no disparo. Sem traduzir o 23505, dois templates com o mesmo nome caíam
      // no genérico do describeError ("Já existe um registro com esses dados"),
      // que não diz qual campo repetiu — ao contrário do AgentsTab e do
      // SourcesTab, que já nomeavam a coluna duplicada.
      const duplicado = (error as { code?: string }).code === "23505";
      return toast.error("Não foi possível salvar o template", {
        description: duplicado
          ? `Já existe um template chamado "${payload.name}". Abra o existente na lista ao lado em vez de criar outro — o nome é o que a Meta usa para casar o template no disparo.`
          : describeError(error, "Tente de novo."),
      });
    }
    // Recusa da RLS não é erro: o `using` de `whatsapp_templates_write` faz o
    // UPDATE casar ZERO linhas e o PostgREST responde 200. Sem este ramo a tela
    // diria "Template atualizado" com o banco intacto. Não é código morto por
    // ter o botão escondido para quem não escreve: o papel só-leitura é barrado
    // aqui também, e é o que `e2e/sdr/origens-e-templates.spec.ts` cobra pelas
    // duas vias (tela sem Salvar e UPDATE do diretor casando 0 linhas).
    if (!data?.length) return toast.error("Não foi possível salvar o template", { description: SEM_PERMISSAO });
    toast.success(c.id ? "Template atualizado" : "Template cadastrado");
    salvoAgora.current = gravavel({ ...c, ...payload });
    // Mantém o template recém-gravado selecionado; sem o id, um segundo Salvar
    // tentaria inserir de novo e esbarraria no unique(name).
    setDraft({ ...c, ...payload, id: data[0].id });
    reload();
  }

  // O nome vai para a Meta no disparo: template com nome errado precisava sumir
  // da lista, e não havia como. As FKs são ON DELETE SET NULL — a exclusão não
  // falha, ela desliga em silêncio as boas-vindas e o disparo de quem usava.
  async function remove(template: WhatsAppTemplate) {
    const { data, error } = await supabase.from("whatsapp_templates").delete().eq("id", template.id).select("id");
    if (error) return toast.error("Não foi possível excluir o template", { description: describeError(error, "Tente de novo.") });
    if (!data?.length) return toast.error("Não foi possível excluir o template", { description: SEM_PERMISSAO });
    setExcluindo(null);
    toast.success("Template excluído");
    // Formulário limpo, e não `null`: cair em `templates[0]` repovoava o painel
    // com OUTRO template em silêncio, e a leitura natural era "não excluiu".
    setDraft({ ...NOVO });
    focarNovoAoFechar.current = true;
    reload();
  }

  const efeitos = excluindo ? efeitosDaExclusaoTemplate(excluindo.id, { sources, lists }) : [];

  return (
    <div className="grid md:grid-cols-[280px,1fr] gap-3">
      <Card className="p-3 space-y-2 max-h-[520px] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Templates ({templates.length})</h3>
          {canWrite && (
            <Button ref={novoRef} size="sm" variant="outline" onClick={() => setDraft({ ...NOVO })}>
              <Plus className="h-4 w-4 mr-1" />Novo
            </Button>
          )}
        </div>
        {templates.length === 0 && <p className="text-xs text-muted-foreground">Nenhum template cadastrado.</p>}
        {templates.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setDraft(t)}
            aria-pressed={c.id === t.id}
            className={`w-full text-left border rounded-md p-2 text-xs hover:bg-muted/40 ${c.id === t.id ? "bg-muted" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{t.name}</span>
              <Badge variant="outline" size="sm" className={t.approved ? "border-success text-success" : "border-warning text-warning"}>
                {t.approved ? "aprovado" : "pendente"}
              </Badge>
            </div>
            <div className="text-muted-foreground">
              {t.language} · {t.category} · {(t.variables ?? []).length} variável(is){!t.active && " · arquivado"}
            </div>
          </button>
        ))}
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Credenciais sensíveis ficam nos Secrets do backend. Aqui você espelha o template aprovado pela Meta — o nome,
          o idioma e a quantidade de variáveis têm de ser <b>idênticos</b> aos de lá, senão a Graph API recusa o envio.
          {!canWrite && " Seu papel só consulta: editar template é de admin, marketing ou SDR (policy whatsapp_templates_write, migration 0069)."}
        </p>
        <fieldset disabled={!canWrite} className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
          {/* Visível, e não `sr-only`: a 375px a lista fica acima e fora da
              tela, e o painel não dizia QUAL registro estava aberto. */}
          <legend className="sm:col-span-2 text-sm font-semibold">
            {gravado ? `Editando: ${gravado.name}` : "Novo template"}
            {sujo && <span className="ml-2 font-normal text-xs text-warning">alterações não salvas</span>}
          </legend>
          <div>
            <Label htmlFor="wa-name">Nome do template</Label>
            <Input
              id="wa-name"
              value={c.name || ""}
              onChange={e => set({ name: e.target.value })}
              placeholder="boas_vindas_faceimob"
              aria-invalid={!!problemaNome}
              aria-describedby="wa-name-hint"
            />
            <p id="wa-name-hint" className={`mt-1 text-xs ${problemaNome ? "text-destructive" : "text-muted-foreground"}`}>
              {problemaNome ?? "Igual ao nome do template APROVADO na Meta: é por ele que o disparo casa. Nome que não existe lá falha no envio, não neste cadastro."}
            </p>
          </div>
          <div>
            <Label htmlFor="wa-lang">Idioma</Label>
            <Select value={c.language || "pt_BR"} onValueChange={v => set({ language: v })}>
              <SelectTrigger id="wa-lang" aria-label="Idioma"><SelectValue /></SelectTrigger>
              <SelectContent>
                {idiomas.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="wa-category">Categoria na Meta</Label>
            <Select value={c.category || "MARKETING"} onValueChange={v => set({ category: v })}>
              <SelectTrigger id="wa-category" aria-label="Categoria na Meta"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKETING">MARKETING (campanha, remarketing)</SelectItem>
                <SelectItem value="UTILITY">UTILITY (boas-vindas, aviso de atendimento)</SelectItem>
                <SelectItem value="AUTHENTICATION">AUTHENTICATION (código de acesso)</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Tem de ser a MESMA categoria aprovada na Meta. Fora da janela de 24h só sai template aprovado, e
              <b> MARKETING</b> é o que a Meta limita por contato e barra primeiro quando a qualidade do número cai —
              aviso de atendimento em curso vai como <b>UTILITY</b>.
            </p>
          </div>
          <div>
            <Label htmlFor="wa-vars">Variáveis, na ordem ({"{{1}}, {{2}}"})</Label>
            <Input
              id="wa-vars"
              placeholder="nome, campanha"
              value={variaveis.join(", ")}
              onChange={e => set({ variables: parseVariables(e.target.value) })}
              aria-invalid={bloqueios.length > 0}
              aria-describedby={problemas.length > 0 ? "wa-vars-hint wa-issues" : "wa-vars-hint"}
            />
            {/* O catálogo é o que o disparo automático sabe preencher. Sem ele
                à vista, o operador só descobria o nome aceito errando. */}
            <p id="wa-vars-hint" className="mt-1 text-xs text-muted-foreground">
              O disparo automático (boas-vindas e remarketing) só preenche <b>{Object.keys(VAR_ALIASES).join(", ")}</b>;
              outro nome sai como “-” ali. A <b>quantidade</b>, essa sim, é obrigatória: uma variável a mais (ou a
              menos) do que o corpo usa faz a Meta recusar a mensagem.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="wa-body">Mensagem</Label>
            {/* O motivo do bloqueio precisa chegar a quem tabula até o campo,
                não só a quem enxerga a caixa amarela. */}
            <Textarea
              id="wa-body"
              value={c.body || ""}
              onChange={e => set({ body: e.target.value })}
              placeholder="Olá {{1}}, tudo bem? Vi seu interesse em {{2}}."
              aria-invalid={bloqueios.length > 0}
              aria-describedby={problemas.length > 0 ? "wa-issues" : undefined}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="wa-provider-id">ID do template na Meta (opcional)</Label>
            <Input id="wa-provider-id" value={c.provider_template_id || ""} onChange={e => set({ provider_template_id: e.target.value })} placeholder="Só para conferência: o disparo casa pelo nome." />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="wa-approved" checked={!!c.approved} onCheckedChange={v => set({ approved: v })} />
            <Label htmlFor="wa-approved">Aprovado na Meta</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="wa-active" checked={!!c.active} onCheckedChange={v => set({ active: v })} />
            <Label htmlFor="wa-active">Template ativo (desmarcado = arquivado)</Label>
          </div>
        </fieldset>

        <p className="text-xs text-muted-foreground">
          <b>Aprovado</b> é declaração sua: o app não consulta a Meta. Marcar sem aprovação lá faz o disparo (e as
          boas-vindas) serem recusados na hora do envio.
        </p>

        {/* Sem `role="status"`: a caixa é recalculada a cada tecla e o leitor
            de tela lia a frase inteira no meio da digitação — e de novo no
            toast do Salvar. Os campos apontam para cá por `aria-describedby`. */}
        {problemas.length > 0 && (
          <div id="wa-issues" className="rounded-md border border-warning/40 bg-warning/10 p-2 space-y-1">
            {problemas.map((p) => (
              <p key={p} className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />{p}
              </p>
            ))}
            {c.active && bloqueios.length > 0 && (
              <p className="text-xs text-warning/90">
                A contagem de parâmetros é o que a Meta recusa em qualquer envio: Salvar fica bloqueado enquanto o
                template estiver ativo. Corrija acima, ou desmarque “Template ativo” para arquivá-lo sem perder o
                cadastro.
              </p>
            )}
          </div>
        )}

        {c.body && (
          <div className="rounded-md border bg-muted/30 p-2">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Pré-visualização (dados de exemplo)</p>
            <p className="text-sm whitespace-pre-wrap">{renderPreview(c.body, variaveis)}</p>
          </div>
        )}

        {canWrite && (
          <div className="flex gap-2">
            <Button onClick={save} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
            {/* A linha completa vem da lista, e não do rascunho: `c` pode ser um
                `Partial` com o que o usuário digitou, e é o id gravado que a
                exclusão precisa. */}
            {gravado && (
              <Button variant="outline" className="text-destructive" onClick={() => setExcluindo(gravado)} aria-label={`Excluir template ${gravado.name}`}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />Excluir
              </Button>
            )}
            {/* O botão some no próprio clique: sem devolver o foco a "Novo",
                ele cairia no <body>. */}
            {draft && (
              <Button variant="outline" onClick={() => { setDraft(null); novoRef.current?.focus(); }}>
                Cancelar
              </Button>
            )}
          </div>
        )}
      </Card>

      <AlertDialog open={!!excluindo} onOpenChange={(aberto) => { if (!aberto) setExcluindo(null); }}>
        <AlertDialogContent
          onCloseAutoFocus={(evento) => {
            // Depois de excluir, o alvo natural do Radix (o botão "Excluir")
            // já não existe e o foco iria para o <body>.
            if (!focarNovoAoFechar.current) return;
            focarNovoAoFechar.current = false;
            evento.preventDefault();
            novoRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o template “{excluindo?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {efeitos.length > 0
                ? <>Ficam sem template: <b>{efeitos.join(" · ")}</b>. As boas-vindas dessas origens e o disparo dessas
                  listas param até você escolher outro template.</>
                : <>Nenhuma origem nem lista de remarketing usa este template hoje — a exclusão não interrompe
                  nenhum disparo.</>}
              {" "}Para tirá-lo de circulação sem perder o cadastro, desmarque “Template ativo” e salve.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => excluindo && remove(excluindo)}>Excluir template</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
