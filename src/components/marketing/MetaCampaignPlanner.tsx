import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileText, Loader2, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, LoadingState, SectionCard, StatusBadge } from "@/components/shared";
import { useDeveloperProjects, useDevelopers } from "@/components/leads/data";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateTime, num } from "@/lib/format";
import { functionErrorMessage } from "@/lib/functionError";
import { dbError, describeError } from "@/lib/supabaseError";
import {
  CANAIS,
  CTAS,
  type Entrada,
  FORMATOS,
  type Formato,
  FRASE_LIMITE_PLANOS,
  type InteresseValidado,
  lerEntrada,
  LIMITE_PLANOS_DIA,
  OBJETIVOS,
  PADROES,
  type Padrao,
  type Plano,
} from "../../../supabase/functions/meta-campaign-planner/plano";

/**
 * Planejador de campanha, na aba Planejador de /marketing (F2.3).
 *
 * "Gerar plano" chama a edge `meta-campaign-planner`, que confere
 * `marketing.meta_manage`, o teto do dia e grava o plano; aqui o botão nasce
 * desligado sem a permissão e no teto. A validação do pedido, os rótulos e o
 * teto vêm do módulo puro da edge — a mesma regra, escrita uma vez.
 *
 * "Imprimir / salvar PDF" é o `window.print()` do navegador: a folha de estilo
 * de impressão abaixo deixa só o plano na página. Sem dependência de PDF.
 */

/** A tabela (0116) e o contador (0123) ainda não estão no types.ts gerado (mesmo cast de analytics.ts). */
const untyped = supabase as unknown as SupabaseClient;

const PLANOS_KEY = ["marketing", "meta", "planos"] as const;
const IMPRESSAO_ID = "plano-impressao";
const SEM_EMPREENDIMENTO = "__sem";

/**
 * Na impressão, só o plano: some tudo o que não é o plano nem o contém, e os
 * ancestrais dele perdem layout, rolagem e fundo (a casca do app tem altura de
 * tela e rolagem própria, que cortariam a folha). Cores do sistema, e não
 * tokens: no tema escuro o texto claro sairia invisível no papel.
 */
const CSS_IMPRESSAO = `
@page { margin: 14mm; }
body :not(#${IMPRESSAO_ID}):not(#${IMPRESSAO_ID} *):not(:has(#${IMPRESSAO_ID})) { display: none !important; }
html, body, :has(#${IMPRESSAO_ID}) {
  display: block !important; position: static !important; overflow: visible !important;
  width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important;
  background: none !important; box-shadow: none !important; transform: none !important;
}
#${IMPRESSAO_ID} { color-scheme: light; color: CanvasText; }
#${IMPRESSAO_ID} * {
  color: inherit !important; background: none !important;
  border-color: GrayText !important; box-shadow: none !important;
}
#${IMPRESSAO_ID} section, #${IMPRESSAO_ID} li { break-inside: avoid; }
`;

type Canal = keyof typeof CANAIS;

type LinhaPlano = {
  id: string;
  nome: string;
  padrao: Padrao;
  formato: Formato;
  canal: Canal;
  verba_diaria: number;
  link: string | null;
  observacoes: string | null;
  plano: Plano;
  model: string | null;
  created_at: string;
};

type Form = {
  developer_id: string;
  project_id: string;
  padrao: string;
  formato: string;
  canal: string;
  verba: string;
  link: string;
  observacoes: string;
};

const FORM_INICIAL: Form = {
  developer_id: "",
  project_id: "",
  padrao: "",
  formato: "imagem",
  canal: "formulario",
  verba: "",
  link: "",
  observacoes: "",
};

async function lerPlanos(): Promise<LinhaPlano[]> {
  const { data, error } = await untyped
    .from("meta_campaign_plans")
    .select("id, nome, padrao, formato, canal, verba_diaria, link, observacoes, plano, model, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw dbError("listar planos de campanha", error);
  return (data ?? []) as LinhaPlano[];
}

/**
 * As tentativas de hoje de quem está na tela, pelo mesmo contador do teto na
 * edge: contar planos salvos divergia quando uma tentativa falhava.
 */
async function contarTentativasDeHoje(): Promise<number> {
  const { data, error } = await untyped.rpc("meta_plano_tentativas_hoje");
  if (error) throw dbError("contar as tentativas de hoje", error);
  if (typeof data !== "number") throw new Error("O contador de tentativas respondeu fora do formato.");
  return data;
}

async function gerarPlano(entrada: Entrada): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; plan_id: string }>("meta-campaign-planner", {
    body: entrada,
  });
  if (error) throw new Error(await functionErrorMessage(error, "Não foi possível gerar o plano."));
  if (!data?.plan_id) throw new Error("O planejador respondeu sem o plano.");
  return data.plan_id;
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Escolha(props: {
  id: string;
  valor: string;
  onChange: (valor: string) => void;
  placeholder: string;
  opcoes: [string, string][];
  disabled: boolean;
}) {
  return (
    <Select value={props.valor} onValueChange={props.onChange} disabled={props.disabled}>
      <SelectTrigger id={props.id}>
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {props.opcoes.map(([valor, rotulo]) => (
          <SelectItem key={valor} value={valor}>
            {rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h4>
      {children}
    </section>
  );
}

const faixa = (i: InteresseValidado) =>
  i.audiencia_min !== null && i.audiencia_max !== null
    ? ` · público de ${num(i.audiencia_min)} a ${num(i.audiencia_max)} pessoas, segundo a Meta`
    : "";

function PlanoDetalhe({ linha }: { linha: LinhaPlano }) {
  const p = linha.plano;
  const n = p.interesses_nao_validados;
  return (
    <>
      <style media="print">{CSS_IMPRESSAO}</style>
      <article id={IMPRESSAO_ID} className="space-y-5">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nome da campanha</p>
          <h3 className="break-all font-mono text-sm font-semibold">{p.nome}</h3>
          <p className="text-xs text-muted-foreground">
            Gerado em {dateTime(linha.created_at)}
            {linha.model ? ` · ${linha.model}` : ""}
          </p>
        </header>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Dado rotulo="Construtora">{p.construtora}</Dado>
          <Dado rotulo="Empreendimento">{p.empreendimento ?? "—"}</Dado>
          <Dado rotulo="Objetivo">
            {OBJETIVOS[p.objetivo] ?? p.objetivo} ({p.objetivo})
          </Dado>
          <Dado rotulo="Categoria especial">Imóvel ({p.categoria_especial})</Dado>
          <Dado rotulo="Padrão · formato · canal">
            {PADROES[linha.padrao]} · {FORMATOS[linha.formato]} · {CANAIS[linha.canal]}
          </Dado>
          <Dado rotulo="Verba diária informada">{brl(linha.verba_diaria, { cents: true })}</Dado>
        </dl>

        <Bloco titulo="Chamada principal">
          <p className="text-sm">{p.titulo}</p>
        </Bloco>

        <Bloco titulo="Público">
          <p className="text-sm">
            {p.publico.localizacao ?? "Localização não informada"}
            {p.publico.raio_km !== null ? ` · raio de ${p.publico.raio_km} km` : ""}
          </p>
          {p.publico.descricao && <p className="text-sm text-muted-foreground">{p.publico.descricao}</p>}
          <p className="text-xs text-muted-foreground">
            Sem idade, gênero nem exclusões: anúncio de imóvel é categoria especial (HOUSING) na Meta.
          </p>
        </Bloco>

        <Bloco titulo="Interesses validados na Meta">
          {p.interesses.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {p.interesses.map((i) => (
                <li key={i.id}>
                  {i.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    · id {i.id}
                    {faixa(i)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum interesse validado.</p>
          )}
          {n > 0 && (
            <p className="text-sm">
              <b>{n}</b> {n === 1 ? "palavra de interesse ficou" : "palavras de interesse ficaram"} sem validação na
              Meta e {n === 1 ? "não entrou" : "não entraram"} no plano.
            </p>
          )}
          {p.interesses_aviso && <p className="text-sm text-warning">{p.interesses_aviso}</p>}
          <p className="text-xs text-muted-foreground">
            Em anúncio de imóvel, a Meta pode recusar alguns interesses ao montar o conjunto.
          </p>
        </Bloco>

        <Bloco titulo="Textos do anúncio">
          <ol className="space-y-3">
            {p.textos.map((t, i) => (
              <li key={i} className="space-y-1 rounded-xl border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground">Texto {i + 1}</p>
                <p className="whitespace-pre-line text-sm">{t.texto}</p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Título:</span> {t.titulo}
                </p>
                {t.descricao && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Descrição:</span> {t.descricao}
                  </p>
                )}
                <p className="text-sm">
                  <span className="text-muted-foreground">Botão:</span> {CTAS[t.cta] ?? t.cta}
                </p>
              </li>
            ))}
          </ol>
        </Bloco>

        <Bloco titulo="Verba sugerida">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {p.verba_sugerida !== null
              ? `${brl(p.verba_sugerida, { cents: true })} por dia`
              : "A IA não sugeriu um valor válido."}
            <StatusBadge tone="info">Sugestão da IA</StatusBadge>
          </p>
          {p.justificativa_verba && <p className="text-sm text-muted-foreground">{p.justificativa_verba}</p>}
          <p className="text-xs text-muted-foreground">
            A IA não estima leads nem custo por lead: resultado, só depois de a campanha rodar.
          </p>
        </Bloco>

        {p.link && (
          <Bloco titulo="Link do imóvel">
            <p className="break-all text-sm">{p.link}</p>
          </Bloco>
        )}
        {linha.observacoes && (
          <Bloco titulo="Observações informadas">
            <p className="whitespace-pre-line text-sm">{linha.observacoes}</p>
          </Bloco>
        )}
      </article>
    </>
  );
}

export function MetaCampaignPlanner() {
  const { can, user } = useAuth();
  const podeGerar = can("marketing.meta_manage");
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const id = useId();
  const [form, setForm] = useState<Form>(FORM_INICIAL);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);

  const construtoras = useDevelopers(true);
  const empreendimentos = useDeveloperProjects(form.developer_id);
  const planos = useQuery({ queryKey: PLANOS_KEY, queryFn: lerPlanos });
  const hoje = useQuery({
    queryKey: [...PLANOS_KEY, "hoje", userId],
    queryFn: contarTentativasDeHoje,
    enabled: podeGerar && Boolean(userId),
  });

  const gerar = useMutation({
    mutationFn: gerarPlano,
    onSuccess: (planId) => {
      setEscolhido(planId);
      toast.success("Plano gerado", { description: "Revise os textos antes de subir na Meta." });
    },
    onError: (e) => toast.error("Não foi possível gerar o plano", { description: e.message }),
    // Também no erro: a tentativa que falha conta no teto. O prefixo relê o contador junto.
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLANOS_KEY }),
  });

  const noTeto = (hoje.data ?? 0) >= LIMITE_PLANOS_DIA;
  const travado = !podeGerar || noTeto || gerar.isPending;
  const mudar = (campo: keyof Form) => (valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const lido = lerEntrada({
      developer_id: form.developer_id,
      project_id: form.project_id || null,
      padrao: form.padrao,
      formato: form.formato,
      canal: form.canal,
      verba_diaria: form.verba.trim() === "" ? Number.NaN : Number(form.verba),
      link: form.link,
      observacoes: form.observacoes,
    });
    // `"error" in`: sem strictNullChecks, `!lido.ok` não estreita a união.
    if ("error" in lido) {
      setErroForm(lido.error);
      return;
    }
    setErroForm(null);
    gerar.mutate(lido.entrada);
  };

  // Recém-gerado: espera a lista recarregar em vez de mostrar outro plano no lugar.
  const exibido = escolhido
    ? planos.data?.find((p) => p.id === escolhido) ?? null
    : planos.data?.[0] ?? null;

  let corpoDoPlano: ReactNode;
  if (exibido) corpoDoPlano = <PlanoDetalhe linha={exibido} />;
  else if (planos.isPending || (escolhido && planos.isFetching)) {
    corpoDoPlano = <LoadingState rows={4} label="Carregando o plano…" />;
  } else if (planos.isError) {
    corpoDoPlano = (
      <p role="status" className="text-sm text-destructive">
        {describeError(planos.error, "Não consegui ler os planos salvos.")}
      </p>
    );
  } else {
    corpoDoPlano = (
      <EmptyState icon={FileText} title="Nenhum plano aberto" description="Gere um plano ou abra um dos salvos." />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <SectionCard
          title="Planejar campanha"
          icon={Sparkles}
          description="A IA redige os textos e sugere público e verba; nome, objetivo e interesses saem do sistema."
        >
          <form className="space-y-4" onSubmit={enviar} noValidate>
            {!podeGerar && (
              <p role="status" className="text-xs text-warning">
                Sem a permissão &quot;Gerenciar campanhas na Meta&quot;: dá para ver os planos salvos, não para gerar.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id={`${id}-construtora`} rotulo="Construtora">
                <Escolha
                  id={`${id}-construtora`}
                  valor={form.developer_id}
                  onChange={(v) => setForm((f) => ({ ...f, developer_id: v, project_id: "" }))}
                  placeholder={construtoras.isPending ? "Carregando…" : "Escolha a construtora"}
                  opcoes={(construtoras.data ?? []).map((c) => [c.id, c.name])}
                  disabled={!podeGerar}
                />
              </Campo>
              <Campo id={`${id}-empreendimento`} rotulo="Empreendimento (opcional)">
                <Escolha
                  id={`${id}-empreendimento`}
                  valor={form.project_id}
                  onChange={(v) => mudar("project_id")(v === SEM_EMPREENDIMENTO ? "" : v)}
                  placeholder="Sem empreendimento"
                  opcoes={[
                    [SEM_EMPREENDIMENTO, "Sem empreendimento"],
                    ...(empreendimentos.data ?? []).map((p): [string, string] => [p.id, p.name]),
                  ]}
                  disabled={!podeGerar || !form.developer_id}
                />
              </Campo>
              <Campo id={`${id}-padrao`} rotulo="Padrão">
                <Escolha
                  id={`${id}-padrao`}
                  valor={form.padrao}
                  onChange={mudar("padrao")}
                  placeholder="Escolha o padrão"
                  opcoes={Object.entries(PADROES)}
                  disabled={!podeGerar}
                />
              </Campo>
              <Campo id={`${id}-formato`} rotulo="Formato">
                <Escolha
                  id={`${id}-formato`}
                  valor={form.formato}
                  onChange={mudar("formato")}
                  placeholder="Escolha o formato"
                  opcoes={Object.entries(FORMATOS)}
                  disabled={!podeGerar}
                />
              </Campo>
              <Campo id={`${id}-canal`} rotulo="Canal">
                <Escolha
                  id={`${id}-canal`}
                  valor={form.canal}
                  onChange={mudar("canal")}
                  placeholder="Escolha o canal"
                  opcoes={Object.entries(CANAIS)}
                  disabled={!podeGerar}
                />
              </Campo>
              <Campo id={`${id}-verba`} rotulo="Verba diária (R$)">
                <Input
                  id={`${id}-verba`}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="0.01"
                  value={form.verba}
                  onChange={(e) => mudar("verba")(e.target.value)}
                  disabled={!podeGerar}
                />
              </Campo>
            </div>

            <Campo id={`${id}-link`} rotulo="Link do imóvel (opcional)">
              <Input
                id={`${id}-link`}
                type="url"
                placeholder="https://…"
                maxLength={500}
                value={form.link}
                onChange={(e) => mudar("link")(e.target.value)}
                disabled={!podeGerar}
              />
              <p className="text-xs text-muted-foreground">Fica no plano como texto: o sistema não abre a página.</p>
            </Campo>

            <Campo id={`${id}-observacoes`} rotulo="Observações (opcional)">
              <Textarea
                id={`${id}-observacoes`}
                rows={3}
                maxLength={1000}
                placeholder="Preço, condições, diferenciais…"
                value={form.observacoes}
                onChange={(e) => mudar("observacoes")(e.target.value)}
                disabled={!podeGerar}
              />
              <p className="text-xs text-muted-foreground">{form.observacoes.length} de 1.000 caracteres</p>
            </Campo>

            {erroForm && (
              <p role="alert" className="text-sm text-destructive">
                {erroForm}
              </p>
            )}
            {/* A falha do servidor já é anunciada pelo toast; a frase fica na tela sem
                role="alert" para o leitor de tela não ouvir o motivo duas vezes. */}
            {!erroForm && gerar.error && <p className="text-sm text-destructive">{gerar.error.message}</p>}
            {noTeto && (
              <p role="status" className="text-sm text-warning">
                {FRASE_LIMITE_PLANOS}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={travado}>
                {gerar.isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden /> Gerando…
                  </>
                ) : (
                  "Gerar plano"
                )}
              </Button>
              {podeGerar && (
                <span className="text-xs text-muted-foreground">
                  {hoje.isSuccess
                    ? `Hoje: ${hoje.data} de ${LIMITE_PLANOS_DIA} tentativas suas (a que falha também conta).`
                    : `Até ${LIMITE_PLANOS_DIA} tentativas por pessoa por dia.`}
                </span>
              )}
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="Plano"
          icon={FileText}
          description="Salvo ao gerar. Nada é publicado na Meta."
          actions={
            exibido && (
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer aria-hidden /> Imprimir / salvar PDF
              </Button>
            )
          }
        >
          {corpoDoPlano}
        </SectionCard>
      </div>

      <SectionCard title="Planos salvos" icon={FileText} description="Os 30 mais recentes da equipe.">
        {planos.isPending ? (
          <LoadingState variant="list" rows={3} label="Carregando planos…" />
        ) : planos.isError ? (
          <p role="status" className="text-sm text-destructive">
            {describeError(planos.error, "Não consegui ler os planos salvos.")}
          </p>
        ) : planos.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum plano salvo ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {planos.data.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={p.id === exibido?.id}
                  onClick={() => setEscolhido(p.id)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md py-2.5 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-primary"
                >
                  <span className="break-all font-mono text-sm font-medium">{p.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {dateTime(p.created_at)} · {PADROES[p.padrao]} · {CANAIS[p.canal]} ·{" "}
                    {brl(p.verba_diaria, { cents: true })} por dia
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
