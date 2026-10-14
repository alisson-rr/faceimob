import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { brl } from "@/lib/format";
import { bareStatus } from "@/lib/dealStatus";
import { describeError } from "@/lib/supabaseError";
import { getDealDeveloper, getDealDocumentReview } from "@/integrations/supabase/documents";
import { listDeveloperProjects } from "@/integrations/supabase/leads";
import { chaveDaConstrutora, construtorasDoCcaProprio } from "@/integrations/supabase/central";
import {
  EMPTY_STATUS_CATALOG, moveDealStatus, mudarConstrutoraDoNegocio, reativarNegocio, statusMoveBlock, useDealStatusCatalog,
} from "@/integrations/supabase/dealStatuses";
import type { SaveLegacyDealInput } from "@/integrations/supabase/newSchema";
import { AcaoDoNegocio } from "./AcaoDoNegocio";
import { DealOffToggle } from "./DealOffToggle";
import { MoneyField, TextField } from "./fields";
import { useDevelopers, usePeople } from "./data";

const EXTERNA = "ANÁLISE EXTERNA";
const APROVACOES = [
  { bare: "APROV. COND.", rotulo: "Aprovado condicionado" },
  { bare: "APROV. TOTAL", rotulo: "Aprovado total" },
] as const;
/** Onde o negócio já está fora do alcance da análise externa: encerrado, em contrato ou na esteira da CCA. */
const SEM_ANALISE_EXTERNA = new Set([
  "OFF", "DISTRATO", "QUEDA", "REPROVADO", "EM CONTRATO", "ASSINADO", "RC EMITIDA", "ASS. BANCO",
  "ESTEIRA AGIL", "RET. ESTEIRA AGIL", "ANÁLISE P/ VIRAR NEGÓCIO", "EM ANÁLISE",
]);
const VIROU_NEGOCIO = new Set(["VIROU NEGÓCIO", "VIROU NEGÓCIO COM PENDÊNCIAS"]);
/** Negócio encerrado que gerente, diretor, sócio e administrador podem reativar (0277). */
const REATIVAVEIS = new Set(["OFF", "DISTRATO", "QUEDA"]);
/** Menor texto aceito em motivo e comentário: "ok" não explica nada ao histórico. */
const MIN_TEXTO = 5;
type Acao = "externa" | "retorno" | "contrato" | "assinado" | "reativar" | "troca";

/**
 * Aba Negócio: o movimento do card num lugar só (pedido de 12/10/2026).
 *
 * Aqui entram OFF, a análise externa (e o retorno dela), o contrato e a troca
 * de construtora. Toda ação segue o mesmo molde (`AcaoDoNegocio`): toggle à
 * esquerda, ação descrita à direita, opções com comentário obrigatório ao ligar
 * e card fechado ao confirmar (14/10/2026). Quem pode cada coisa é do banco
 * (`deal_status_move_block`); a tela só deixa de oferecer o que ele recusaria e
 * diz o motivo.
 *
 * Análise externa em construtora de CCA próprio é uma escolha (o toggle); em
 * construtora de CCA externo ela é o caminho. Nos dois casos o negócio não vai
 * para a esteira da nossa CCA e a aprovação é registrada à mão.
 */
export function MovimentoDoNegocio({
  dealId, form, readOnly, onPatch, onAplicarOff, onGravar, onMovido, onConcluido,
}: {
  dealId: string;
  form: SaveLegacyDealInput;
  readOnly: boolean;
  onPatch: (next: Partial<SaveLegacyDealInput>) => void;
  onAplicarOff: (motivo: string, valorOff: string) => Promise<boolean>;
  /** Grava a ficha (com o Status 2 novo, se vier). `false` = não gravou. `silencioso` = sem o aviso de salvo. */
  onGravar: (status?: string, silencioso?: boolean) => Promise<boolean>;
  /** Depois de mover pela RPC: o parent atualiza o status da ficha e renova o dossiê. */
  onMovido: (status: string) => Promise<void>;
  /** Depois de um movimento que muda o negócio de lugar: o card fecha e o toast confirma. */
  onConcluido?: () => void;
}) {
  const id = useId();
  const { can, isAdmin, roles, user } = useAuth();
  const catalog = useDealStatusCatalog().data ?? EMPTY_STATUS_CATALOG;
  const atual = bareStatus(form.status);

  const construtora = useQuery({ queryKey: ["deal-developer", dealId], queryFn: () => getDealDeveloper(dealId) });
  const revisao = useQuery({ queryKey: ["deal-review", dealId, form.status], queryFn: () => getDealDocumentReview(dealId) });
  const ccaProprio = useQuery({ queryKey: ["cca-proprio"], queryFn: construtorasDoCcaProprio, staleTime: 300_000 });

  // Uma ação aberta por vez: o comentário é um só e o card fica curto.
  const [aberta, setAberta] = useState<Acao | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [projetos, setProjetos] = useState<{ id: string; name: string }[]>([]);
  const [corretorReativar, setCorretorReativar] = useState("");
  const pessoas = usePeople().data;
  const [novaConstrutora, setNovaConstrutora] = useState("");
  const [novoEmpreendimento, setNovoEmpreendimento] = useState("");
  const [projetosDaNova, setProjetosDaNova] = useState<{ id: string; name: string }[]>([]);
  const construtoras = useDevelopers().data ?? [];
  // Quem reativa escolhe o corretor: o antigo pode não ser quem pega de volta. Admin
  // e sócio veem a casa toda; gerente e diretor, só a própria liderança (o banco repete a trava).
  const corretores = useMemo(
    () => (pessoas ?? [])
      .filter((p) => p.active && p.roles.includes("broker"))
      .filter((p) => isAdmin || !user?.id || p.manager_id === user.id || p.director_id === user.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [pessoas, isAdmin, user?.id],
  );

  useEffect(() => {
    if (!isAdmin || !form.developer_id) return;
    let vivo = true;
    listDeveloperProjects(form.developer_id).then((lista) => { if (vivo) setProjetos(lista); }).catch(() => { if (vivo) setProjetos([]); });
    return () => { vivo = false; };
  }, [isAdmin, form.developer_id]);

  useEffect(() => {
    setProjetosDaNova([]);
    if (!novaConstrutora) return;
    let vivo = true;
    listDeveloperProjects(novaConstrutora).then((lista) => { if (vivo) setProjetosDaNova(lista); }).catch(() => { if (vivo) setProjetosDaNova([]); });
    return () => { vivo = false; };
  }, [novaConstrutora]);

  const alternar = (acao: Acao) => (ligado: boolean) => {
    setAberta(ligado ? acao : null);
    setNota("");
    setCorretorReativar("");
    setNovaConstrutora("");
    setNovoEmpreendimento("");
  };
  const fechar = () => alternar("externa")(false);

  const valorDe = (bare: string) => catalog.statuses.find((item) => bareStatus(item.value) === bare)?.value ?? null;
  const bloqueio = (bare: string): string | null => {
    const destino = valorDe(bare);
    if (!destino) return `${bare} não está no cadastro de Status 2.`;
    if (!can("deals.edit_status_detail")) return "Seu perfil não pode alterar o Status 2.";
    return statusMoveBlock(catalog, form.status, destino, { isAdmin, roles });
  };

  /** Move o Status 2 pela RPC (a regra de quem pode é do banco), com o comentário, e fecha o card. */
  const mover = async (bare: string, titulo: string, antes?: () => Promise<boolean>) => {
    const destino = valorDe(bare);
    if (!destino) return;
    setOcupado(true);
    try {
      if (antes && !(await antes())) return;
      await moveDealStatus(dealId, destino, nota);
      await onMovido(destino);
      toast({ variant: "success", title: titulo, description: "O comentário ficou no histórico." });
      fechar();
      onConcluido?.();
    } catch (erro) {
      toast({ variant: "destructive", title: "Não foi possível mover o negócio", description: describeError(erro, "Tente de novo.") });
    } finally {
      setOcupado(false);
    }
  };

  const reativar = async () => {
    setOcupado(true);
    try {
      await reativarNegocio(dealId, nota, corretorReativar);
      await onMovido(valorDe("INCOMPLETO") ?? "INCOMPLETO");
      toast({ variant: "success", title: "Negócio reativado", description: "Voltou para Incompleto no mês atual. O motivo ficou no histórico." });
      fechar();
      onConcluido?.();
    } catch (erro) {
      toast({ variant: "destructive", title: "Não foi possível reativar o negócio", description: describeError(erro, "Tente de novo.") });
    } finally {
      setOcupado(false);
    }
  };

  const trocarConstrutora = async () => {
    setOcupado(true);
    try {
      const cadastrado = projetosDaNova.find((p) => p.name.toLowerCase() === novoEmpreendimento.trim().toLowerCase());
      await mudarConstrutoraDoNegocio({
        dealId, developerId: novaConstrutora, project: novoEmpreendimento,
        projectId: cadastrado?.id ?? null, comentario: nota,
      });
      await onMovido(valorDe("ANÁLISE P/ VIRAR NEGÓCIO") ?? "ANÁLISE P/ VIRAR NEGÓCIO");
      toast({
        variant: "success", title: "Construtora trocada",
        description: "O negócio voltou à CCA para uma nova virada, com o comentário no histórico.",
      });
      fechar();
      onConcluido?.();
    } catch (erro) {
      toast({ variant: "destructive", title: "Não foi possível trocar a construtora", description: describeError(erro, "Tente de novo.") });
    } finally {
      setOcupado(false);
    }
  };

  const nome = construtora.data?.name ?? form.developer;
  const cca = ccaProprio.data;
  const ccaExterno = construtora.data?.flow === "external"
    || Boolean(nome && cca && cca.size > 0 && !cca.has(chaveDaConstrutora(nome)));
  const conferenciaPendente = revisao.data?.document_review_status === "pending";
  const podeOferecerExterna = !readOnly && !SEM_ANALISE_EXTERNA.has(atual) && atual !== EXTERNA && !conferenciaPendente;
  const motivoExterna = bloqueio(EXTERNA);
  const comentarioOk = nota.trim().length >= MIN_TEXTO;
  // Reativar não olha `readOnly`: o caso típico é um OFF de mês fechado, que a ficha
  // trava para edição — a regra de quem pode e de que mês vale é do banco (0277).
  const podeReativar = isAdmin || roles.includes("manager") || roles.includes("director");
  const reativavel = REATIVAVEIS.has(atual);
  const podeTrocarConstrutora = !readOnly && VIROU_NEGOCIO.has(atual);
  const trocaCompleta = novaConstrutora !== "" && novoEmpreendimento.trim().length >= 2 && comentarioOk;
  const vgvLiquido = form.vgv_bruto ? Math.max(form.vgv_bruto - (form.desconto ?? 0), 0) : null;
  const virouNegocio = VIROU_NEGOCIO.has(atual);

  const campoComentario = (sufixo: string, rotulo: string, exemplo: string) => (
    <>
      <Label htmlFor={`${id}-${sufixo}`} className="text-xs">{rotulo}</Label>
      <Textarea id={`${id}-${sufixo}`} rows={2} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} placeholder={exemplo} />
    </>
  );
  const botao = (rotulo: string, aoClicar: () => void, desabilitado: boolean, variante: "default" | "outline" = "default") => (
    <Button size="sm" variant={variante} disabled={ocupado || desabilitado} onClick={aoClicar}>
      {ocupado && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
      {rotulo}
    </Button>
  );

  return (
    <div className="space-y-4">
      {atual === EXTERNA && (
        <AcaoDoNegocio
          titulo="Registrar o retorno da análise externa"
          descricao="O negócio está em análise fora da casa e não passa pela nossa CCA. Quando a análise voltar, registre o resultado, sempre com um comentário."
          aberta={aberta === "retorno"} onAlternar={alternar("retorno")} desabilitado={readOnly}
          aviso={bloqueio(APROVACOES[0].bare)}
        >
          {campoComentario("retorno", "Comentário do retorno (obrigatório)", "Ex.: aprovado pela Caixa com condicionante de renda")}
          <div className="flex flex-wrap gap-2">
            {APROVACOES.map(({ bare, rotulo }) => (
              <span key={bare} title={bloqueio(bare) ?? undefined}>
                {botao(rotulo, () => void mover(bare, `Negócio em ${rotulo.toLowerCase()}`), !comentarioOk || Boolean(bloqueio(bare)), "outline")}
              </span>
            ))}
          </div>
        </AcaoDoNegocio>
      )}

      {podeOferecerExterna && (
        <AcaoDoNegocio
          titulo="Enviar para análise externa"
          descricao={ccaExterno
            ? `${nome ? `${nome} tem CCA externo` : "Esta construtora tem CCA externo"}: a análise é feita fora e não vai para a nossa CCA.`
            : "Ligado, o negócio vira Análise Externa em vez de ir para a nossa CCA, e a aprovação é registrada à mão."}
          aberta={aberta === "externa"} onAlternar={alternar("externa")} desabilitado={Boolean(motivoExterna)} aviso={motivoExterna}
        >
          {campoComentario("envio", "Comentário (obrigatório)", "Ex.: enviado ao correspondente para análise de crédito")}
          {botao("Colocar em análise externa", () => void mover(EXTERNA, "Negócio em análise externa"), !comentarioOk)}
        </AcaoDoNegocio>
      )}
      {!ccaExterno && conferenciaPendente && !SEM_ANALISE_EXTERNA.has(atual) && (
        <p className="text-xs text-muted-foreground">
          Há uma conferência do gerente pendente: resolva-a antes de mandar o negócio para a análise externa.
        </p>
      )}

      {isAdmin && (
        <section className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-3">
          <h3 className="flex items-center gap-2 text-sm font-bold"><FileSignature className="h-4 w-4" aria-hidden /> Dados do contrato (administrador e sócio)</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${id}-empreendimento`} className="text-eyebrow">Empreendimento</Label>
              <Input id={`${id}-empreendimento`} list={`${id}-sugestoes`} maxLength={120} className="mt-1 text-xs"
                disabled={readOnly} value={form.project || ""}
                onChange={(e) => {
                  const texto = e.target.value;
                  const cadastrado = projetos.find((p) => p.name.toLowerCase() === texto.trim().toLowerCase());
                  onPatch({ project: texto, project_id: cadastrado?.id ?? null });
                }} />
              <datalist id={`${id}-sugestoes`}>{projetos.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            </div>
            <TextField id={`${id}-unidade`} label="Bloco | unidade" value={form.unit} onChange={(v) => onPatch({ unit: v })} />
            <MoneyField id={`${id}-bruto`} label="VGV bruto" value={form.vgv_bruto} disabled={readOnly} onChange={(v) => onPatch({ vgv_bruto: v })} />
            <MoneyField id={`${id}-desconto`} label="Desconto" value={form.desconto} disabled={readOnly} onChange={(v) => onPatch({ desconto: v })} />
          </div>
          <div>
            <p className="text-eyebrow">VGV líquido do negócio</p>
            <p className="deal-readout mt-1 rounded-xl border px-3.5 py-2.5 text-xs font-semibold tabular-nums">{brl(vgvLiquido, { cents: true })}</p>
          </div>
          <Button size="sm" variant="outline" disabled={readOnly || ocupado} onClick={() => void onGravar()}>Salvar dados do contrato</Button>
        </section>
      )}

      {isAdmin && (
        <AcaoDoNegocio
          titulo="Colocar em contrato" tom="sucesso"
          descricao="Vale depois de o negócio virar negócio e pede o VGV bruto. O VGV e os dados acima são gravados junto."
          aberta={aberta === "contrato"} onAlternar={alternar("contrato")}
          desabilitado={readOnly || !virouNegocio || !form.vgv_bruto}
          aviso={!virouNegocio ? "Só vale com o Status 2 em Virou negócio." : !form.vgv_bruto ? "Informe o VGV bruto." : null}
        >
          {campoComentario("contrato", "Comentário (obrigatório)", "Ex.: contrato emitido, VGV conferido com a construtora")}
          {botao("Colocar em contrato", () => void mover("EM CONTRATO", "Negócio em contrato", () => onGravar(undefined, true)), !comentarioOk)}
        </AcaoDoNegocio>
      )}

      {isAdmin && (
        <AcaoDoNegocio
          titulo="Confirmar contrato assinado" tom="sucesso"
          descricao="Confirma que o contrato foi assinado."
          aberta={aberta === "assinado"} onAlternar={alternar("assinado")}
          desabilitado={readOnly || atual !== "EM CONTRATO"}
          aviso={atual !== "EM CONTRATO" ? "Só vale com o Status 2 em Em contrato." : null}
        >
          {campoComentario("assinado", "Comentário (obrigatório)", "Ex.: assinado em cartório em 14/10")}
          {botao("Confirmar assinado", () => void mover("ASSINADO", "Negócio assinado"), !comentarioOk)}
        </AcaoDoNegocio>
      )}

      {reativavel && podeReativar && (
        <AcaoDoNegocio
          titulo="Reativar negócio" tom="atencao"
          descricao={`O negócio está em ${atual}. Reativar leva ele de volta para Incompleto, no mês atual, com o corretor que você escolher, e o motivo fica no histórico.`}
          aberta={aberta === "reativar"} onAlternar={alternar("reativar")}
        >
          <Label htmlFor={`${id}-reativar-corretor`} className="text-xs">Corretor que recebe o negócio (obrigatório)</Label>
          <Select value={corretorReativar || undefined} onValueChange={setCorretorReativar}>
            <SelectTrigger id={`${id}-reativar-corretor`} className="text-xs"><SelectValue placeholder="Escolha o corretor" /></SelectTrigger>
            <SelectContent>
              {corretores.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.team ? ` · ${c.team}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">A equipe é refeita com o gerente e o diretor atuais do corretor escolhido.</p>
          {campoComentario("reativar", "Motivo da reativação (obrigatório)", "Ex.: cliente retomou o contato e quer seguir com a compra")}
          {botao("Reativar para Incompleto no mês atual", () => void reativar(), !corretorReativar || !comentarioOk)}
        </AcaoDoNegocio>
      )}

      {podeTrocarConstrutora && (
        <AcaoDoNegocio
          titulo="Mudar construtora p/ negócio"
          descricao="Para virar negócio em outra construtora: o negócio volta à CCA para uma nova virada. Informe a nova construtora, o empreendimento e o motivo da troca."
          aberta={aberta === "troca"} onAlternar={alternar("troca")}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${id}-nova-construtora`} className="text-xs">Nova construtora (obrigatório)</Label>
              <Select value={novaConstrutora || undefined} onValueChange={(v) => { setNovaConstrutora(v); setNovoEmpreendimento(""); }}>
                <SelectTrigger id={`${id}-nova-construtora`} className="mt-1 text-xs"><SelectValue placeholder="Escolha a construtora" /></SelectTrigger>
                <SelectContent>
                  {construtoras.filter((c) => c.id !== form.developer_id).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-novo-empreendimento`} className="text-xs">Empreendimento (obrigatório)</Label>
              <Input id={`${id}-novo-empreendimento`} list={`${id}-projetos-nova`} maxLength={120} className="mt-1 text-xs"
                disabled={!novaConstrutora} value={novoEmpreendimento} onChange={(e) => setNovoEmpreendimento(e.target.value)} />
              <datalist id={`${id}-projetos-nova`}>{projetosDaNova.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            </div>
          </div>
          {campoComentario("troca", "Comentário (obrigatório)", "Ex.: cliente preferiu outro empreendimento; reprovado na construtora anterior")}
          {botao("Voltar à CCA com a nova construtora", () => void trocarConstrutora(), !trocaCompleta)}
        </AcaoDoNegocio>
      )}

      <DealOffToggle status={form.status} isNew={false} readOnly={readOnly} onAplicar={onAplicarOff} />
    </div>
  );
}
