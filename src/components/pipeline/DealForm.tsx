import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { brl, dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import type { DealStage } from "@/types/crm";
import { useAuth } from "@/contexts/AuthContext";
import { listDeveloperProjects } from "@/integrations/supabase/leads";
import {
  choosesLoss, dealStageCodeFor, saleBlockedReason,
  type PersonRecord, type SaveLegacyDealInput,
} from "@/integrations/supabase/newSchema";
import {
  EMPTY_STATUS_CATALOG, statusKey, statusMoveBlock, useDealStatusCatalog, type DealStatusCatalog,
} from "@/integrations/supabase/dealStatuses";

const ESTEIRA_AGIL = statusKey("13. ESTEIRA AGIL");

/**
 * O Status 2 escolhido na ficha vira envio ao gerente (pedido de 01/10/2026)?
 * Só "Esteira Ágil": é rótulo que só o sistema grava, e a entrada nele é a
 * conferência do gerente — a mesma caixa da aba Anexos.
 */
export const statusPedeConferencia = (value: string): boolean => statusKey(value) === ESTEIRA_AGIL;

/** O Status 2 pede observação ao entrar (0164)? */
const statusRequiresNote = (catalog: DealStatusCatalog, value: string) => {
  const indice = catalog.indexByKey.get(statusKey(value));
  return indice !== undefined && catalog.statuses[indice].requires_note;
};
import { useCanExitStage, useDealWriteLock, useSelectableBrokers, useSelectableLeaders, type LiderancaSelecionavel } from "./data";
import { ChoiceField, MoneyField, PersonField, Section, TextField } from "./fields";
import { pct } from "./filters";
import { groupChoices, statusChoices, statusGroupOf } from "./statuses";
import { offDistratoBlocked } from "./useDealActions";
import { DOCUMENT_REVIEW_META } from "./review";
import { MesBaseComMotivo } from "./MesBaseComMotivo";
import { funnelStages, type PipelineStage } from "./stages";

const SIM_NAO = ["NÃO", "SIM"];

/** `deal_participants.share_pct` como descrição curta do campo. O NÚMERO sai de
 *  `pct`, a mesma função do cartão, da tabela e do painel — eram quatro cópias
 *  do mesmo `toLocaleString`, e duas já divergiam ("50%" no cartão, "50,0%" no
 *  painel) num valor que define comissão. */
const rateio = (share?: number | null) =>
  share == null ? undefined : `${pct(share)} do VGV`;
const ORIGENS = ["Lead Faceimob", "Lead Próprio", "Indicação", "Facebook", "Google", "Stand"];

/** Sufixos do item cinza. Curtos porque vivem DENTRO da opção do Select; a
 *  frase inteira fica no parágrafo abaixo do campo. */
export const SEM_PERMISSAO = "sem permissão";
export const APOS_CONFERENCIA = "depois da conferência";

/**
 * Etapas que o banco recusaria, pelo `code`, e o motivo curto de cada uma.
 *
 * Dois donos, não um:
 *
 * 1. **A matriz** (`stage_permissions`, a metade "entrar" que `deals_guard_stage`
 *    cobra depois do `can_exit_stage` — migration 0101).
 * 2. **A conferência documental na CRIAÇÃO** (0111 §1.b/§1.c). A matriz dá a
 *    casa de "Em análise" a gerente, diretor e CCA porque eles MOVEM o negócio
 *    para lá ao aprovar a conferência; o gatilho recusa o INSERT de quem não é
 *    administrador, porque nascer lá pula o passo do gerente. As duas fontes
 *    estão certas — o que faltava era a tela distinguir CRIAR de MOVER, e quem
 *    responde isso é `saleBlockedReason`, a mesma função que o gravador
 *    (`saveLegacyDeal`) consulta antes de gravar. Ao EDITAR, nada muda.
 *
 * A etapa JÁ escolhida fica de fora da conta, pelos mesmos dois motivos do
 * Select de Status 2: gravar o valor que já está lá não é escrita (a 0101 só
 * cobra a matriz quando `new.stage_id is distinct from old.stage_id`), e o
 * `<SelectValue/>` do Radix espelha os filhos do item escolhido — o sufixo do
 * motivo iria parar dentro do próprio gatilho do Select.
 */
export const blockedStageEntries = (
  stages: PipelineStage[],
  form: Pick<SaveLegacyDealInput, "id" | "stage" | "stage_id" | "document_review_status">,
  opts: { canEnterStage: (stageId: string) => boolean; isAdmin: boolean },
): Map<string, string> => {
  const bloqueadas = new Map<string, string>();
  for (const stage of stages) {
    if (stage.code === form.stage) continue;
    if (!opts.canEnterStage(stage.id)) {
      bloqueadas.set(stage.code, SEM_PERMISSAO);
      continue;
    }
    const recusa = saleBlockedReason(
      // `status: ""` de propósito: a pergunta aqui é sobre a ETAPA, e o Status 2
      // não pode responder por ela — com o valor cru, "VENDA" traduz TODA opção
      // em "Fechado" (`dealStageCodeFor`) e a lista inteira ficaria cinza pelo
      // motivo errado. O Status 2 tem o aviso dele, abaixo do próprio campo.
      // O cast é a mesma fronteira do `onValueChange` do Select logo abaixo: o
      // código vem do catálogo do banco e `DealStage` é o espelho dele.
      { ...form, status: "", stage: stage.code as DealStage },
      stages,
      opts.canEnterStage,
      { isAdmin: opts.isAdmin },
    );
    if (recusa) bloqueadas.set(stage.code, APOS_CONFERENCIA);
  }
  return bloqueadas;
};

interface Props {
  form: SaveLegacyDealInput;
  onChange: (patch: Partial<SaveLegacyDealInput>) => void;
  field: (name: string) => string;
  people: PersonRecord[];
  developers: { id: string; name: string }[];
  stages: PipelineStage[];
  isNew: boolean;
  /** Recusa de `dealRequiredError` depois de uma tentativa de salvar. Vem de
   *  fora porque quem tenta salvar é o rodapé do modal, não este formulário —
   *  e a frase precisa nascer PRESA ao campo que a causou, não num toast que
   *  some sozinho por cima de ~40 campos. */
  developerError?: string | null;
  projectError?: string | null;
  documentNumberError?: { field: "cpf" | "numero_pis" | "cpf2" | "numero_pis2"; message: string } | null;
  /** "Em análise" ou "Esteira Ágil" escolhidos por quem não os grava direto:
   *  abre o envio ao gerente em vez de trocar o Status 2 (01/10/2026). */
  onPedirConferencia?: () => void;
  /** Negócio já gravado: gerente e diretor trocam o mês-base com motivo (0201). */
  dealId?: string | null;
  /** Negócio novo: a batida de CPF roda ao sair do campo (0205). */
  onCpfBlur?: (cpf: string) => void;
}

/** Aba "Detalhes" do negócio: o formulário inteiro. */
const NOMES_DOS_MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "09/2026" -> "setembro/2026". */
const rotuloDoMes = (mes: string) => {
  const [mm, aaaa] = mes.split("/");
  return `${NOMES_DOS_MESES[Number(mm) - 1] ?? mm}/${aaaa}`;
};

/**
 * Meses do seletor de mês-base, do mais novo para o mais antigo: de dois meses
 * à frente (pedido de 03/10/2026; o banco recusa além disso, 0206) até janeiro
 * de dois anos atrás. O mês gravado entra mesmo fora da faixa — negócio antigo
 * não pode abrir com o campo vazio e trocar de mês ao salvar.
 */
const mesesDoSeletor = (atual?: string): string[] => {
  const hoje = new Date();
  const meses: string[] = [];
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 1);
  for (let d = ultimo; d.getFullYear() >= hoje.getFullYear() - 2; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
    meses.push(`${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`);
  }
  if (atual && /^\d{2}\/\d{4}$/.test(atual) && !meses.includes(atual)) meses.push(atual);
  return meses;
};

type Lideranca = Pick<PersonRecord, "id" | "manager_id" | "director_id">;

/**
 * Gerente N e Diretor N sugeridos ao trocar o Corretor N. Trocar o corretor
 * troca a sugestão: quando o novo corretor não tem líder a sugerir (sem equipe,
 * líder fora da lista, ou o líder já está em outro slot), o líder que o
 * corretor ANTERIOR tinha posto no slot sai — antes ele ficava, e o negócio
 * gravava o gerente da equipe errada. Líder escolhido à mão, que não era o do
 * corretor anterior, fica.
 */
export function sugestaoDeLideres(
  form: Pick<SaveLegacyDealInput, "broker1_id" | "broker2_id" | "broker3_id" | "manager1_id" | "manager2_id"
    | "manager3_id" | "director1_id" | "director2_id">,
  brokerId: string | null,
  slot: 1 | 2 | 3,
  people: Lideranca[],
  managers: { id: string }[],
  directors: { id: string }[],
): Partial<SaveLegacyDealInput> {
  const campoGerente = (["manager1_id", "manager2_id", "manager3_id"] as const)[slot - 1];
  const campoDiretor = slot < 3 ? (["director1_id", "director2_id"] as const)[slot - 1] : null;
  const anterior = people.find((person) => person.id === form[(["broker1_id", "broker2_id", "broker3_id"] as const)[slot - 1]]);
  const corretor = people.find((person) => person.id === brokerId);
  const gerentes = [form.manager1_id, form.manager2_id, form.manager3_id];
  const diretores = [form.director1_id, form.director2_id];
  const gerente = corretor?.manager_id && managers.some((p) => p.id === corretor.manager_id)
    && !gerentes.some((id, i) => i !== slot - 1 && id === corretor.manager_id) ? corretor.manager_id : null;
  const diretor = campoDiretor && corretor?.director_id && directors.some((p) => p.id === corretor.director_id)
    && !diretores.some((id, i) => i !== slot - 1 && id === corretor.director_id) ? corretor.director_id : null;
  const patch: Partial<SaveLegacyDealInput> = {};
  if (gerente) patch[campoGerente] = gerente;
  else if (anterior?.manager_id && form[campoGerente] === anterior.manager_id) patch[campoGerente] = null;
  if (campoDiretor) {
    if (diretor) patch[campoDiretor] = diretor;
    else if (anterior?.director_id && form[campoDiretor] === anterior.director_id) patch[campoDiretor] = null;
  }
  return patch;
}

/**
 * Opções de Gerente e Diretor e a liderança de cada corretor para a sugestão.
 * Mesma união da lista de corretores: a visível mais a das RPCs da 0199, que
 * entregam ao corretor os gerentes e diretores que a RLS de `profiles` esconde
 * dele. A equipe de quem a lista visível já traz prevalece.
 */
export function lideresDoNegocio(people: PersonRecord[], daRpc: LiderancaSelecionavel | null) {
  const unir = (visiveis: { id: string; name: string }[], extras: { id: string; name: string }[]) => {
    const porId = new Map(visiveis.map((p) => [p.id, { id: p.id, name: p.name }]));
    for (const row of extras) if (!porId.has(row.id)) porId.set(row.id, { id: row.id, name: row.name });
    return [...porId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  };
  const lideres = daRpc?.lideres ?? [];
  const equipes = new Map((daRpc?.equipes ?? []).map((e) => [e.id, e]));
  const lideranca: Lideranca[] = [
    // Campo a campo: a lista visível pode trazer o gerente e não o diretor (ou
    // nenhum dos dois, quando a RLS esconde a equipe do corretor).
    ...people.map((p) => {
      const e = equipes.get(p.id);
      return { ...p, manager_id: p.manager_id ?? e?.manager_id ?? null, director_id: p.director_id ?? e?.director_id ?? null };
    }),
    ...[...equipes.values()].filter((e) => !people.some((p) => p.id === e.id)),
  ];
  return {
    managers: unir(
      people.filter((person) => person.active && (person.roles.includes("manager") || person.roles.includes("director"))),
      lideres.filter((l) => l.isManager || l.isDirector),
    ),
    directors: unir(people.filter((person) => person.active && person.roles.includes("director")), lideres.filter((l) => l.isDirector)),
    lideranca,
  };
}

export function DealForm({
  form, onChange, field, people, developers, stages, isNew, developerError, projectError, documentNumberError, onPedirConferencia, dealId, onCpfBlur,
}: Props) {
  const { isAdmin, roles, canEnterStage, can } = useAuth();
  const vgvTravado = !isNew && !can("deals.edit_value");
  const canExitStage = useCanExitStage();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  /** Falha de carga do catálogo de empreendimentos — separada do "não tem
   *  nenhum". `catch { setProjects([]) }` fazia as duas coisas darem a MESMA
   *  tela ("Sem empreendimentos"), num campo obrigatório. */
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const selectableBrokers = useSelectableBrokers();
  const selectableLeaders = useSelectableLeaders();
  const catalog = useDealStatusCatalog().data ?? EMPTY_STATUS_CATALOG;

  // Status 1 (0149). O banco o deriva do Status 2 e só aceita troca à mão de
  // quem tem `deals.edit_status_group`. Sem valor no formulário — negócio novo,
  // ou o Status 2 acabou de mudar aqui — a tela mostra o grupo que o catálogo
  // dá ao Status 2 escolhido, e o gravador não manda nada: quem deriva é o
  // gatilho, com o catálogo do banco.
  const podeTrocarStatus1 = can("deals.edit_status_group");
  const status1 = form.status_group_id ?? statusGroupOf(catalog, form.status);

  // Duas recusas do banco numa resposta só (`useDealWriteLock`): o papel sem
  // escrita (`can_edit_deal`/`deals_insert`) e o mês congelado
  // (`deals_guard_closed_month`, 0010 — `before insert or update`, bypass só
  // para `is_admin()`). A segunda vivia só na LINHA da tabela e no cartão: o
  // nome do cliente abre este modal sem passar o `dealLock`, então o mesmo
  // negócio que exibia cadeado abria o formulário INTEIRO habilitado, para o
  // "Salvar" cair em P0001.
  //
  // O hook mora em `./data` para que o rodapé do modal leia a MESMA resposta —
  // enquanto a conta era feita aqui dentro, o botão de salvar não a enxergava.
  const lock = useDealWriteLock(form);

  // A etapa só muda se o perfil puder SAIR da atual: `deals_guard_stage` cobra
  // `can_exit_stage(old.stage_id)` antes de olhar a etapa de destino.
  // Desde a 0164 a etapa de um negócio que já existe SEGUE o Status 2: quem a
  // muda é o cadastro de status. Negócio novo ainda escolhe onde nasce, e o
  // admin segue podendo corrigir à mão.
  const etapaSegueStatus = !isNew && !isAdmin;
  // A etapa que o Status 2 leva (cadastro de status, 0164), se houver. Fechado
  // e Perdido ficam de fora: esses o gravador decide pelo desfecho.
  const etapaDoStatus = (value: string | null | undefined) => {
    const indice = catalog.indexByKey.get(statusKey(value));
    const stageId = indice === undefined ? null : catalog.statuses[indice].stage_id;
    const code = stages.find((stage) => stage.id === stageId)?.code;
    return code && code !== "closed" && code !== "lost" ? (code as DealStage) : null;
  };
  // Status 2 trocado agora (o Status 1 volta à derivação, ver o Select): a
  // ficha já mostra a etapa para onde o banco vai levar o negócio ao salvar,
  // em vez da antiga. Só exibição — quem move é o gatilho `deals_ab_status_stage`;
  // mandar a etapa junto faria `deals_guard_stage` cobrar a matriz de etapas.
  const etapaExibida = etapaSegueStatus && form.status_group_id === undefined
    ? etapaDoStatus(form.status) ?? form.stage
    : form.stage;
  const canLeaveStage = !etapaSegueStatus && (isNew || !form.stage_id || canExitStage(form.stage_id));

  // A etapa de perda fica fora da lista (ver o comentário do Select). As
  // bloqueadas saem daqui para que o item cinza e a frase que o explica leiam a
  // MESMA conta.
  const etapas = funnelStages(stages);
  const etapasBloqueadas = blockedStageEntries(etapas, form, { canEnterStage, isAdmin });
  // Quais das duas frases o parágrafo abaixo do Select precisa dizer.
  const motivosBloqueio = new Set(etapasBloqueadas.values());

  // "VENDA" no Status 2 não é só rótulo: `dealStageCodeFor` o traduz em etapa
  // "Fechado", que tem dois donos — a matriz de etapas e a conferência do
  // gerente. `saveLegacyDeal` recusa com ESTA mesma frase, então o aviso aqui é
  // a mesma regra lida antes do clique, não uma segunda. `stages` cru, e não
  // `etapas`: `funnelStages` filtra, e "Fechado" pode não estar na lista.
  //
  // O `=== "closed"` é o recorte do que pertence a ESTE campo:
  // `saleBlockedReason` também responde pela etapa escolhida na criação, e essa
  // frase tem lugar próprio — o item cinza da lista de etapas, logo acima. Uma
  // recusa de etapa impressa embaixo do Status 2 mandaria mexer no campo errado.
  const vendaBloqueada = dealStageCodeFor(form) === "closed"
    ? saleBlockedReason(form, stages, canEnterStage, { isAdmin })
    : null;

  // "Esteira Ágil" é rótulo do sistema e fica fora do catálogo escolhível; aqui
  // ela volta como porta de entrada da conferência do gerente.
  const esteiraAgil = catalog.statuses.find((status) => statusKey(status.value) === ESTEIRA_AGIL);
  const pedeConferencia = (value: string) => Boolean(onPedirConferencia) && statusPedeConferencia(value);
  const conferenciaPendente = form.document_review_status === "pending";

  // Revisão do cliente em 10/09/2026, no tamanho que ele pediu: dos rótulos do
  // Status 2, só OFF e DISTRATO viraram de administrador e sócio — o resto do
  // catálogo continua de quem edita o negócio. A ETAPA não tem código próprio:
  // quem a decide é a matriz de etapas (`canEnterStage`/`canLeaveStage` logo
  // acima), a mesma que o banco cobra em `deals_guard_stage`. Um código à parte
  // passava por cima dela e deixava o admin sem como conceder pela tela.

  // A lista da RPC (`selectable_brokers`, security definer) unida à visível: a
  // RLS de `profiles` entrega ao corretor só o próprio perfil, e sem a união os
  // campos "Corretor 2"/"Corretor 3" abrem com uma opção só — ele mesmo. Quando
  // a função ainda não existe no banco, `data` é `null` e sobra a lista de
  // sempre; o aviso abaixo do bloco diz quando a carga falhou.
  const brokers = useMemo(() => {
    const visiveis = people.filter((person) => person.active && person.roles.includes("broker"));
    const porId = new Map<string, { id: string; name: string }>(
      visiveis.map((person) => [person.id, person]),
    );
    for (const row of selectableBrokers.data ?? []) if (!porId.has(row.id)) porId.set(row.id, row);
    return [...porId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [people, selectableBrokers.data]);

  const { managers, directors, lideranca } = useMemo(
    () => lideresDoNegocio(people, selectableLeaders.data ?? null),
    [people, selectableLeaders.data],
  );

  /**
   * Sugestão de gerente e diretor pela equipe do corretor (pedido de
   * 28/09/2026; Corretor 2 e 3 desde 29/09). É só sugestão: o Corretor N
   * preenche Gerente N e Diretor N (não há Diretor 3) ao ser trocado, e os
   * campos continuam editáveis. Quem já está em outro slot não se repete — dois
   * corretores da mesma equipe não viram "Gerente 1 = Gerente 2". Vem de `people`, que traz o gestor
   * da equipe de cada perfil, e só preenche quem a lista mostra — um id fora da
   * visibilidade apareceria como "Fora da sua visibilidade". Para o corretor,
   * que não enxerga a equipe pela RLS, a liderança e os nomes vêm das RPCs da
   * 0199; o gatilho `deal_participants_autofill` continua cobrindo o resto.
   */
  const sugestaoDaEquipe = (brokerId: string | null, slot: 1 | 2 | 3) =>
    sugestaoDeLideres(form, brokerId, slot, lideranca, managers, directors);

  // O negócio que nasce do lead já vem com o Corretor 1 preenchido e o
  // `onChange` do campo nunca dispara: sem isto, Gerente 1 e Diretor 1 abriam
  // em branco (03/10/2026). Preenche só o que está vazio, uma vez por corretor.
  const sugeridoPara = useRef<string | null>(null);
  useEffect(() => {
    const corretor = form.broker1_id;
    // Espera a liderança das RPCs (0199): sem ela, o corretor via só o próprio
    // perfil sem equipe, a sugestão saía vazia e ficava marcada como feita —
    // Gerente 1 e Diretor 1 abriam em branco (Rudinei, 05/10/2026).
    if (selectableLeaders.isPending) return;
    if (!corretor || sugeridoPara.current === corretor || !lideranca.some((p) => p.id === corretor)) return;
    sugeridoPara.current = corretor;
    const patch = sugestaoDeLideres(form, corretor, 1, lideranca, managers, directors);
    const vazio: Partial<SaveLegacyDealInput> = {};
    if (patch.manager1_id && !form.manager1_id) vazio.manager1_id = patch.manager1_id;
    if (patch.director1_id && !form.director1_id) vazio.director1_id = patch.director1_id;
    if (Object.keys(vazio).length) onChange(vazio);
  }, [form, lideranca, managers, directors, onChange, selectableLeaders.isPending]);

  const loadProjects = useCallback(async (developerName: string) => {
    const developer = developers.find((row) => row.name === developerName);
    setProjectsError(null);
    if (!developer) return setProjects([]);
    try {
      setProjects(await listDeveloperProjects(developer.id));
    } catch (err) {
      setProjects([]);
      setProjectsError(describeError(err, "Não consegui carregar as sugestões de empreendimento desta construtora. Dá para digitar o nome assim mesmo."));
    }
  }, [developers]);

  useEffect(() => {
    if (form.developer) void loadProjects(form.developer);
  }, [form.developer, loadProjects]);

  // Espelho de `saveLegacyDeal` (newSchema.ts) — a MESMA função, não uma cópia
  // da regra: `choosesLoss` é o que `dealStageCodeFor` lê para mandar a Perdido.
  // Só o Status 2 trocado aqui encerra: o "19. REPROVADO" que a coluna da CCA já
  // gravou num negócio aberto não acende este aviso nem encerra ao salvar.
  const willLose = choosesLoss(form);

  return (
    <>
      {/* O MOTIVO da trava não mora mais aqui: o `DealDetailModal` o escreve
          acima das abas. Este formulário só existe na aba "Detalhes", e o botão
          que ele desabilita fica desabilitado nas cinco — o analista do CCA
          encontrava o "Confirmar alterações" apagado sem explicação nenhuma.
          Uma frase só, do mesmo `lock`, no lugar onde as cinco a enxergam. */}

      {/* `fieldset disabled` é a trava nativa: desabilita todo controle
          descendente de uma vez, inclusive os gatilhos de Select do Radix.
          `contents` mantém o espaçamento do modal, que é do pai. */}
      <fieldset disabled={lock.readOnly} className="contents">
      {/* Terceiro motivo do `lock`, e o único que o modal ainda não escreve
          acima das abas: a consulta de meses fechados não respondeu. A trava
          fecha em vez de abrir — sem saber se o mês está congelado, deixar
          gravar é prometer o que o gatilho do banco recusa. */}
      {lock.reason === "unknown" && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Não consegui confirmar se o mês <strong className="text-foreground">{lock.month}</strong> está
          fechado, então o formulário fica bloqueado: gravar sem essa resposta arriscaria perder
          tudo no gatilho do banco. Recarregue a página para tentar de novo.
        </p>
      )}
      <div className="deal-tone-blue grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={field("month")} className="text-eyebrow">Mês-base</Label>
          {/* Seletor, não texto (pedido de 28/09/2026): "9/2026" ou "set/26"
              digitados iam crus ao banco e voltavam como erro de data. O valor
              continua "MM/AAAA" — o mesmo que `displayMonthToIso` grava como o
              1º dia do mês, que é como `month_base`, o fechamento e o game
              comparam. */}
          <Select
            value={form.month_base || undefined} disabled={!isAdmin}
            onValueChange={(v) => isAdmin && onChange({ month_base: v })}
          >
            <SelectTrigger
              id={field("month")} className="mt-1 text-xs"
              aria-describedby={isAdmin ? undefined : field("month-hint")}
            >
              <SelectValue placeholder="Escolher o mês" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {mesesDoSeletor(form.month_base).map((mes) => (
                <SelectItem key={mes} value={mes}>{rotuloDoMes(mes)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Terceiro motivo de campo cinza na mesma tela (os outros dois vêm do
              `lock`) e o único sem frase: o mês-base define em qual ciclo o
              negócio conta e o que o fechamento congela, por isso só o admin o
              digita. Sem esta linha o campo parecia defeito. */}
          {!isAdmin && dealId && (roles.includes("manager") || roles.includes("director")) ? (
            <>
            <p id={field("month-hint")} className="mt-1 text-xs text-muted-foreground">Para trocar, informe o motivo.</p>
            <MesBaseComMotivo
              dealId={dealId}
              atual={form.month_base}
              opcoes={mesesDoSeletor(form.month_base).map((mes) => ({ value: mes, label: rotuloDoMes(mes) }))}
              onTrocado={(mes) => onChange({ month_base: mes })}
            />
            </>
          ) : !isAdmin && (
            <p id={field("month-hint")} className="mt-1 text-xs text-muted-foreground">
              Só o administrador, o gerente ou o diretor altera o mês-base: ele decide em qual ciclo o negócio conta.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={field("origin")} className="text-eyebrow">Origem do lead</Label>
          <Select value={form.lead_origin || ORIGENS[0]} onValueChange={(v) => onChange({ lead_origin: v })}>
            <SelectTrigger id={field("origin")} className="mt-1 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORIGENS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {/* Nome e toggle no mesmo cartão (10/10/2026): separados, o rótulo
            ficava longe do interruptor e não dava para saber qual era qual.
            `sm:mt-5` alinha o cartão aos campos ao lado, que têm rótulo em cima. */}
        <div className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 sm:mt-5">
          <Label htmlFor={field("second-client")} className="cursor-pointer text-sm font-semibold">2º cliente?</Label>
          <Switch
            id={field("second-client")} checked={form.has_second_client || false}
            onCheckedChange={(v) => onChange({ has_second_client: v })}
          />
        </div>
        <div className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 sm:mt-5">
          <Label htmlFor={field("informal")} className="cursor-pointer text-sm font-semibold">Renda informal?</Label>
          <Switch
            id={field("informal")} checked={form.has_informal_income || false}
            onCheckedChange={(v) => onChange({ has_informal_income: v })}
          />
        </div>
      </div>

      {!isNew && (
        <p className="text-xs text-muted-foreground">
          Criado em <strong className="text-foreground">{dateTime(form.created_at)}</strong>
          {form.month_base && <> · mês-base <strong className="text-foreground">{form.month_base}</strong></>}
        </p>
      )}

      <Section title="Cliente" className="deal-tone-blue deal-field-light">
        <TextField id={field("client")} label="Cliente *" value={form.client} onChange={(v) => onChange({ client: v })} />
        <TextField id={field("cpf")} label="CPF" value={form.cpf} inputMode="numeric" maxLength={14} error={documentNumberError?.field === "cpf" ? documentNumberError.message : null} onChange={(v) => onChange({ cpf: v })} onBlur={onCpfBlur} />
        <TextField id={field("contato")} label="Contato" value={form.contato} onChange={(v) => onChange({ contato: v })} />
        <TextField id={field("pis")} label="Número do PIS" value={form.numero_pis} inputMode="numeric" maxLength={14} error={documentNumberError?.field === "numero_pis" ? documentNumberError.message : null} onChange={(v) => onChange({ numero_pis: v })} />
        <TextField id={field("civil")} label="Estado civil" value={form.estado_civil} onChange={(v) => onChange({ estado_civil: v })} />
        <TextField id={field("email")} label="E-mail" type="email" value={form.email_client} onChange={(v) => onChange({ email_client: v })} />
        <TextField id={field("natural")} label="Naturalidade" value={form.naturalidade} onChange={(v) => onChange({ naturalidade: v })} />
        <ChoiceField id={field("cotista")} label="Cotista" value={form.cotista} options={SIM_NAO} onChange={(v) => onChange({ cotista: v })} />
        <ChoiceField id={field("dependente")} label="Dependente" value={form.dependente} options={SIM_NAO} onChange={(v) => onChange({ dependente: v })} />
        <TextField id={field("admissao")} label="Data de admissão" value={form.data_admissao} onChange={(v) => onChange({ data_admissao: v })} />
        <TextField id={field("cch")} label="Referência CCH" value={form.referencia_cch} onChange={(v) => onChange({ referencia_cch: v })} />
        <TextField id={field("cep")} label="CEP" value={form.cep} onChange={(v) => onChange({ cep: v })} />
      </Section>

      {form.has_second_client && (
        <Section title="2º cliente" className="deal-tone-gold deal-field-light">
          <TextField id={field("client2")} label="Cliente" value={form.client2} onChange={(v) => onChange({ client2: v })} />
          <TextField id={field("cpf2")} label="CPF" value={form.cpf2} inputMode="numeric" maxLength={14} error={documentNumberError?.field === "cpf2" ? documentNumberError.message : null} onChange={(v) => onChange({ cpf2: v })} onBlur={onCpfBlur} />
          <TextField id={field("contato2")} label="Contato" value={form.contato2} onChange={(v) => onChange({ contato2: v })} />
          <TextField id={field("pis2")} label="Número do PIS" value={form.numero_pis2} inputMode="numeric" maxLength={14} error={documentNumberError?.field === "numero_pis2" ? documentNumberError.message : null} onChange={(v) => onChange({ numero_pis2: v })} />
          <TextField id={field("civil2")} label="Estado civil" value={form.estado_civil2} onChange={(v) => onChange({ estado_civil2: v })} />
          <TextField id={field("email2")} label="E-mail" type="email" value={form.email_client2} onChange={(v) => onChange({ email_client2: v })} />
          <TextField id={field("natural2")} label="Naturalidade" value={form.naturalidade2} onChange={(v) => onChange({ naturalidade2: v })} />
          <ChoiceField id={field("cotista2")} label="Cotista" value={form.cotista2} options={SIM_NAO} onChange={(v) => onChange({ cotista2: v })} />
          <ChoiceField id={field("dependente2")} label="Dependente" value={form.dependente2} options={SIM_NAO} onChange={(v) => onChange({ dependente2: v })} />
          <TextField id={field("admissao2")} label="Data de admissão" value={form.data_admissao2} onChange={(v) => onChange({ data_admissao2: v })} />
          <TextField id={field("cch2")} label="Referência CCH" value={form.referencia_cch2} onChange={(v) => onChange({ referencia_cch2: v })} />
          <TextField id={field("cep2")} label="CEP" value={form.cep2} onChange={(v) => onChange({ cep2: v })} />
        </Section>
      )}

      {form.has_informal_income && (
        <Section title="Renda informal" className="deal-tone-blue deal-field-light">
          <TextField id={field("segmento")} label="Segmento/atividade" value={form.segmento_atividade} onChange={(v) => onChange({ segmento_atividade: v })} />
          <TextField id={field("atuacao")} label="Forma de atuação" value={form.forma_atuacao} onChange={(v) => onChange({ forma_atuacao: v })} />
          <TextField id={field("tempo")} label="Tempo de atividade" value={form.tempo_atividade} onChange={(v) => onChange({ tempo_atividade: v })} />
          <ChoiceField
            id={field("divulgacao")} label="Forma de divulgação" value={form.forma_divulgacao}
            options={["Emite Nota/Recibo/Documento similar", "Não emite"]}
            onChange={(v) => onChange({ forma_divulgacao: v })}
          />
          <ChoiceField id={field("ir")} label="Declara IR" value={form.declara_ir} options={["SIM", "NÃO"]} onChange={(v) => onChange({ declara_ir: v })} />
          <TextField id={field("rendimento")} label="Rendimento mensal" value={form.rendimento_mensal} onChange={(v) => onChange({ rendimento_mensal: v })} />
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor={field("obs-renda")} className="text-eyebrow">Observações da renda</Label>
            <Textarea
              id={field("obs-renda")} rows={2} className="mt-1 text-xs"
              value={form.observacoes_renda || ""}
              onChange={(event) => onChange({ observacoes_renda: event.target.value })}
            />
          </div>
        </Section>
      )}

      <Section title="Empreendimento" className="deal-tone-gold">
        <div>
          <Label htmlFor={field("developer")} className="text-eyebrow">Construtora *</Label>
          <Select
            value={form.developer}
            onValueChange={(v) => {
              // O empreendimento digitado fica (0160, desvinculado da
              // construtora); só o vínculo com o cadastro da anterior sai —
              // `saveLegacyDeal` refaz o vínculo pelo nome na construtora nova.
              onChange({
                developer: v, project_id: null,
                developer_id: developers.find((row) => row.name === v)?.id ?? null,
              });
            }}
          >
            <SelectTrigger
              id={field("developer")}
              aria-invalid={Boolean(developerError)}
              aria-describedby={developerError ? field("developer-erro") : undefined}
              className="mt-1 text-xs"
            >
              <SelectValue placeholder="Escolher" />
            </SelectTrigger>
            <SelectContent>
              {developers.map((row) => <SelectItem key={row.id} value={row.name}>{row.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* A recusa mora no campo. Ela viajava como erro de banco falso
              (`P0001`) e chegava ao operador num toast "Erro ao salvar" que
              some sozinho — sem `aria-invalid`, sem `aria-describedby` e sem
              apontar qual dos ~40 campos era. `role="alert"` anuncia a frase
              uma vez, quando ela aparece. */}
          {developerError && (
            <p id={field("developer-erro")} role="alert" className="mt-1 text-xs text-destructive">
              {developerError}
            </p>
          )}
        </div>
        <div>
          {/* Texto livre (pedido de 28/09/2026): a lista fechada dos
              cadastrados travava o negócio enquanto o admin não cadastrasse o
              empreendimento. Os cadastrados da construtora viram sugestão
              (`datalist`); escolher um deles liga o vínculo `project_id`,
              digitar outro nome grava só o texto. Desde 08/10 ele é obrigatório
              em toda gravação (`dealRequiredError`). */}
          <Label htmlFor={field("project")} className="text-eyebrow">Empreendimento *</Label>
          <Input
            id={field("project")} list={field("project-sugestoes")} maxLength={120}
            className="mt-1 text-xs" placeholder="Digite o empreendimento"
            aria-invalid={Boolean(projectError) || undefined}
            aria-describedby={projectError ? field("project-error") : undefined}
            value={form.project || ""}
            onChange={(event) => {
              const nome = event.target.value;
              const cadastrado = projects.find((row) => row.name.toLowerCase() === nome.trim().toLowerCase());
              onChange({ project: nome, project_id: cadastrado?.id ?? null });
            }}
          />
          {projectError && <p id={field("project-error")} className="mt-1 text-xs text-destructive">{projectError}</p>}
          <datalist id={field("project-sugestoes")}>
            {projects.map((row) => <option key={row.id} value={row.name} />)}
          </datalist>
          {/* Sem as sugestões o campo continua valendo (texto livre); a frase
              diz por que a lista não aparece, em vez de parecer vazia. */}
          {projectsError && (
            <p className="mt-1 text-xs text-destructive">
              {projectsError}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => void loadProjects(form.developer)}
              >
                Tentar de novo
              </button>
            </p>
          )}
        </div>
        <TextField id={field("unit")} label="Bloco | unidade" value={form.unit} onChange={(v) => onChange({ unit: v })} />
      </Section>

      <Section title="Equipe" className="deal-tone-gold">
        <PersonField id={field("broker1")} label="Corretor 1 *" hint={rateio(form.broker1_share)} value={form.broker1_id} fallbackName={form.broker1} options={brokers} onChange={(v) => onChange({ broker1_id: v, ...sugestaoDaEquipe(v, 1) })} />
        <PersonField id={field("broker2")} label="Corretor 2" hint={rateio(form.broker2_share)} value={form.broker2_id} fallbackName={form.broker2} options={brokers} onChange={(v) => onChange({ broker2_id: v, ...sugestaoDaEquipe(v, 2) })} optional />
        <PersonField id={field("broker3")} label="Corretor 3" hint={rateio(form.broker3_share)} value={form.broker3_id} fallbackName={form.broker3} options={brokers} onChange={(v) => onChange({ broker3_id: v, ...sugestaoDaEquipe(v, 3) })} optional />
        <PersonField id={field("manager1")} label="Gerente 1 *" value={form.manager1_id} fallbackName={form.manager1} options={managers} onChange={(v) => onChange({ manager1_id: v })} />
        <PersonField id={field("manager2")} label="Gerente 2" value={form.manager2_id} fallbackName={form.manager2} options={managers} onChange={(v) => onChange({ manager2_id: v })} optional />
        <PersonField id={field("manager3")} label="Gerente 3" value={form.manager3_id} fallbackName={form.manager3} options={managers} onChange={(v) => onChange({ manager3_id: v })} optional />
        <PersonField id={field("director1")} label="Diretor 1" value={form.director1_id} fallbackName={form.director1_name ?? undefined} options={directors} onChange={(v) => onChange({ director1_id: v })} optional />
        <PersonField id={field("director2")} label="Diretor 2" value={form.director2_id} fallbackName={form.director2_name ?? undefined} options={directors} onChange={(v) => onChange({ director2_id: v })} optional />
        {/* O rateio é do banco (`recalc_deal_shares`, disparado por gatilho ao
            inserir ou remover corretor) e até aqui não aparecia em tela
            nenhuma: nem o diretor, nem o gerente, nem o próprio corretor viam
            com quantos e em que proporção dividiam o VGV que define comissão.

            A frase descreve uma regra que só quem pode ACRESCENTAR corretor
            consegue exercer: com um único nome na lista (o próprio), ela
            explicava uma divisão impossível de montar. */}
        <div className="space-y-1 text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
          {brokers.length > 1 && (
            <p>
              O VGV é dividido em partes iguais entre os corretores do negócio; gerente e
              diretor acompanham sem dividir. O percentual é recalculado pelo banco a cada
              entrada ou saída de corretor.
            </p>
          )}
          {/* A RPC de corretores selecionáveis falhou: a lista fica com o que a
              RLS entrega (para o corretor, ele mesmo). Dizer isso é melhor do
              que um Select curto sem explicação. */}
          {selectableBrokers.error != null && (
            <p className="text-destructive">
              {describeError(selectableBrokers.error, "Não consegui carregar a lista de corretores.")}
              {" "}Só quem seu perfil já enxerga aparece nos campos de corretor.
            </p>
          )}
          {brokers.length <= 1 && selectableBrokers.error == null && (
            <p>
              Seu perfil só enxerga o próprio cadastro, então não há como acrescentar um
              segundo corretor por aqui — peça ao gerente para incluí-lo no negócio.
            </p>
          )}
          {/* Campo obrigatório que abre vazio para o corretor: `auth_visible_profiles()`
              não entrega o gerente a quem não lidera equipe. O gatilho
              `deal_participants_autofill` preenche pela equipe depois de salvar —
              sem esta frase, o asterisco pedia algo impossível. */}
          {managers.length === 0 && (
            <p>
              Nenhum gerente aparece na sua visibilidade: deixe &ldquo;Gerente 1&rdquo; em branco
              que o sistema vincula o gerente da sua equipe ao salvar.
            </p>
          )}
        </div>
      </Section>

      <Section title="VGV" className="deal-tone-green">
        {/* Os dois em R$ com máscara (pedido de 28/09/2026). Negativo não se
            digita; desconto acima do bruto quem barra é `dealRangeError` no
            salvamento, com o nome do campo — o CHECK da 0159 sozinho voltaria
            como 23514 sem dizer qual. */}
        {/* Depois de criado, VGV e desconto são de quem tem `deals.edit_value`
            (gerente, diretor, admin; `deals_guard_value`). Campo aberto para
            quem não tem deixava digitar e só recusava no salvar, levando junto
            o resto da ficha (06/10/2026). */}
        <MoneyField
          id={field("vgv")} label="VGV bruto" value={form.vgv_bruto} onChange={(v) => onChange({ vgv_bruto: v })}
          disabled={vgvTravado} hint={vgvTravado ? "Só gerente, diretor e admin alteram o VGV." : undefined}
        />
        <MoneyField
          id={field("desconto")} label="Desconto" value={form.desconto} onChange={(v) => onChange({ desconto: v })}
          disabled={vgvTravado}
        />
        <div>
          {/* Não é campo: é leitura, e não se edita. A conta é a mesma da coluna
              gerada `vgv_net` (0159), feita aqui na hora para quem digita ver o
              resultado antes de salvar; o banco refaz ao gravar. Sem bruto,
              travessão, e não "R$ 0,00" num negócio que ainda não tem VGV. */}
          <p className="text-eyebrow">VGV líquido</p>
          <p className="deal-readout mt-1 rounded-xl border px-3.5 py-2.5 text-xs font-semibold tabular-nums">
            {form.vgv_bruto ? brl(Math.max(form.vgv_bruto - (form.desconto ?? 0), 0), { cents: true }) : brl(null)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">VGV bruto menos o desconto.</p>
        </div>
      </Section>

      <div className="deal-tone-gold grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor={field("stage")} className="text-eyebrow">Etapa</Label>
          <Select
            value={etapaExibida} disabled={!canLeaveStage}
            onValueChange={(v) => onChange({ stage: v as DealStage })}
          >
            {/* Desabilitado, e não escondido: um campo que some não ensina de
                quem é a decisão. `aria-describedby` porque `title` em controle
                desabilitado não recebe foco e não existe para teclado nem
                leitor de tela — é a mesma escolha do mês-base acima. */}
            <SelectTrigger
              id={field("stage")} className="mt-1 text-xs"
              aria-describedby={
                etapaSegueStatus || !canLeaveStage || etapasBloqueadas.size > 0 ? field("stage-hint") : undefined
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Cada etapa é oferecida conforme `can_enter_stage()` — a mesma
                  regra que barra o arrastar no kanban —, e quem abre a lista é
                  `can_exit_stage()` da etapa atual. As duas metades da MESMA
                  matriz, e nada além dela: não é a volta do `disabled={!isAdmin}`
                  do achado X01 (aquele era literal no código; este sai da
                  matriz, e o admin solta pela tela, sem deploy).

                  A etapa de perda fica de fora: escolher "Perdido" aqui
                  encerraria o negócio no salvamento, sem motivo e sem a
                  confirmação que o achado F14 exige. Perder é pela ação
                  própria, na tabela. */}
              {etapas.map((stage) => {
                const motivo = etapasBloqueadas.get(stage.code);
                return (
                  <SelectItem key={stage.id} value={stage.code} disabled={Boolean(motivo)}>
                    {/* Rótulo e motivo em `<span>` separados, como no Select de
                        Status 2 logo abaixo e no da tabela. */}
                    <span>{stage.label}</span>
                    {motivo && (
                      <span className="text-muted-foreground"> ({motivo})</span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {/* Um motivo só, e ele é acionável: a matriz de etapas diz quem tira
              o negócio de onde ele está e quem entra em cada destino, e o
              administrador muda isso na tela de permissões. A frase anterior
              ("só o administrador e o sócio mudam a etapa") mandava pedir uma
              mudança que gestor nenhum faz — e, com o desenho atual, nem sequer
              descrevia quem decide.

              As duas frases dividem o mesmo `id` porque nunca aparecem juntas:
              sem poder SAIR, o Select inteiro está desabilitado e a lista de
              destinos não chega a abrir. */}
          {etapaSegueStatus ? (
            <p id={field("stage-hint")} className="mt-1 text-xs text-muted-foreground">
              A etapa segue o Status 2: mude o Status 2 e ela acompanha.
            </p>
          ) : !canLeaveStage ? (
            <p id={field("stage-hint")} className="mt-1 text-xs text-muted-foreground">
              Seu perfil não pode tirar um negócio desta etapa (matriz de etapas, em
              Admin · Permissões → Etapas). Peça a um gestor.
            </p>
          ) : etapasBloqueadas.size > 0 && (
            <p id={field("stage-hint")} className="mt-1 text-xs text-muted-foreground">
              {motivosBloqueio.has(SEM_PERMISSAO) && (
                <>
                  As etapas marcadas &ldquo;sem permissão&rdquo; não estão liberadas para o
                  seu perfil na matriz de etapas (Admin · Permissões → Etapas).{" "}
                </>
              )}
              {motivosBloqueio.has(APOS_CONFERENCIA) && (
                <>
                  Negócio novo começa no funil: a etapa de análise vem depois da conferência
                  do gerente. Crie o negócio numa etapa aberta, envie o dossiê e o gerente
                  leva o negócio para a esteira.{" "}
                </>
              )}
              As demais continuam com você.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={field("status1")} className="text-eyebrow">Status 1</Label>
          {/* Desabilitado, e não escondido, com o motivo em `aria-describedby`
              — a mesma escolha do mês-base e da etapa acima. */}
          <Select
            value={status1 ?? ""}
            disabled={!podeTrocarStatus1}
            onValueChange={(v) => onChange({ status_group_id: v })}
          >
            <SelectTrigger id={field("status1")} className="mt-1 text-xs" aria-describedby={field("status1-hint")}>
              <SelectValue placeholder="Sem Status 1" />
            </SelectTrigger>
            <SelectContent>
              {groupChoices(catalog, status1).map((group) => (
                <SelectItem key={group.id} value={group.id}>{group.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={field("status1-hint")} className="mt-1 text-xs text-muted-foreground">
            {podeTrocarStatus1
              ? "Segue o Status 2. A troca à mão vale até o Status 2 mudar de novo."
              : "Segue o Status 2. Trocar à mão é do administrador e do sócio."}
          </p>
        </div>
        <div className="deal-tone-green">
          <Label htmlFor={field("status")} className="text-eyebrow">Status do negócio</Label>
          {/* Trocar o Status 2 devolve o Status 1 à derivação: é a regra do
              banco (a troca manual vale até o Status 2 mudar), e mandar o grupo
              antigo junto seria uma troca manual que ninguém pediu. */}
          <Select value={form.status} disabled={!can("deals.edit_status_detail")} onValueChange={(v) => {
            if (pedeConferencia(v)) {
              onPedirConferencia?.();
              return;
            }
            // O admin, que escolhe a etapa à mão, vê a etapa do Status 2 já
            // selecionada e continua podendo trocar. A matriz dele é inteira.
            const etapa = isAdmin ? etapaDoStatus(v) : null;
            onChange({ status: v, status_group_id: undefined, ...(etapa ? { stage: etapa } : {}) });
          }}>
            <SelectTrigger
              id={field("status")}
              className="mt-1 text-xs"
              aria-describedby={vendaBloqueada ? field("status-hint") : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {/* `value` é o valor gravado; o texto vai sem o prefixo numerado.
                  O campo inteiro NÃO fica cinza: o cliente reservou ao
                  administrador dois desfechos (OFF e distrato), não o catálogo
                  todo — trancar o resto tirava do corretor rótulos que sempre
                  foram dele. Os dois saem desabilitados com o motivo, a mesma
                  forma da lista de etapas acima e do Select da tabela. */}
              {/* Só no negócio novo: depois de criado, o envio é pelo "Próximo
                  passo" do topo da ficha (09/10/2026), um caminho só. */}
              {isNew && esteiraAgil && onPedirConferencia && !conferenciaPendente && statusKey(form.status) !== ESTEIRA_AGIL && (
                <SelectItem value={esteiraAgil.value}>
                  <span>{esteiraAgil.label}</span>
                  <span className="text-muted-foreground"> (enviar ao gerente)</span>
                </SelectItem>
              )}
              {statusChoices(catalog, form.status).map((option) => {
                // O rótulo ATUAL fica de fora: escolher o que já está escolhido
                // não é escrita, e `<SelectValue/>` espelha os filhos do item —
                // o sufixo iria parar dentro do próprio gatilho do Select.
                // E a matriz por função do cadastro (0164): quem coloca e quem
                // tira cada Status 2. Status com observação obrigatória vai pelo
                // Pipeline, que pede o texto.
                const bloqueio = option.value === form.status || pedeConferencia(option.value)
                  ? null
                  : offDistratoBlocked(can, option.value, isNew ? null : form.status)
                    ?? (isNew ? null : statusMoveBlock(catalog, form.status, option.value, { isAdmin, roles }))
                    ?? (!isAdmin && statusRequiresNote(catalog, option.value) ? "com observação, pelo Pipeline" : null);
                const semPermissao = bloqueio;
                return (
                  <SelectItem key={option.value} value={option.value} disabled={Boolean(semPermissao)}>
                    {/* O nome no próprio `<span>` e o motivo em outro: o texto
                        exibido continua sendo só `option.label`, que é o que o
                        `statusLabels.test.ts` lê daqui. */}
                    <span>{option.label}</span>
                    {!semPermissao && option.value !== form.status && pedeConferencia(option.value) && (
                      <span className="text-muted-foreground"> (enviar ao gerente)</span>
                    )}
                    {semPermissao && (
                      <span className="text-muted-foreground">
                        {" "}({semPermissao.startsWith("Só administrador") ? "só administrador e sócio" : semPermissao.startsWith("Seu perfil") ? "fora da sua função" : semPermissao})
                      </span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {!can("deals.edit_status_detail") && <p className="mt-1 text-xs text-muted-foreground">Seu perfil pode consultar o Status 2. A edição depende da permissão “Alterar Status 2”.</p>}
          {vendaBloqueada && (
            <p id={field("status-hint")} className="mt-1 text-xs text-muted-foreground">
              {vendaBloqueada}
            </p>
          )}
          {conferenciaPendente && (
            <p className="mt-1 text-xs font-medium text-warning">
              {DOCUMENT_REVIEW_META.pending.label}: aguardando o gerente.
            </p>
          )}
        </div>
      </div>

      {willLose && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          Salvar com este status encerra o negócio: ele sai do funil e deixa de contar no VGV e
          no ranking do game.
        </p>
      )}
      </fieldset>
    </>
  );
}
