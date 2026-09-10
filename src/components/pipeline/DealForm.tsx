import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { brl, dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { isLossStatus } from "@/lib/dealStatus";
import type { DealStage } from "@/types/crm";
import { useAuth } from "@/contexts/AuthContext";
import { listDeveloperProjects } from "@/integrations/supabase/leads";
import type { PersonRecord, SaveLegacyDealInput } from "@/integrations/supabase/newSchema";
import { useCanExitStage, useDealWriteLock, useSelectableBrokers } from "./data";
import { ChoiceField, PersonField, Section, TextField } from "./fields";
import { pct } from "./filters";
import { projectPlaceholder } from "./guards";
import { statusChoices } from "./statuses";
import { funnelStages, type PipelineStage } from "./stages";

const SIM_NAO = ["NÃO", "SIM"];

/** `deal_participants.share_pct` como descrição curta do campo. O NÚMERO sai de
 *  `pct`, a mesma função do cartão, da tabela e do painel — eram quatro cópias
 *  do mesmo `toLocaleString`, e duas já divergiam ("50%" no cartão, "50,0%" no
 *  painel) num valor que define comissão. */
const rateio = (share?: number | null) =>
  share == null ? undefined : `${pct(share)} do VGV`;
const ORIGENS = ["Lead Próprio", "Indicação", "Facebook", "Google", "Stand"];

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
}

/** Aba "Detalhes" do negócio: o formulário inteiro. */
export function DealForm({ form, onChange, field, people, developers, stages, isNew, developerError }: Props) {
  const { isAdmin, roles, canEnterStage } = useAuth();
  const canExitStage = useCanExitStage();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  /** Falha de carga do catálogo de empreendimentos — separada do "não tem
   *  nenhum". `catch { setProjects([]) }` fazia as duas coisas darem a MESMA
   *  tela ("Sem empreendimentos"), num campo obrigatório. */
  const [projectsError, setProjectsError] = useState<string | null>(null);
  /** A troca de construtora acabou de LIMPAR um empreendimento que estava
   *  preenchido. O campo pertence à construtora, então zerá-lo é correto — o
   *  que faltava era dizer. `saveLegacyDeal` sempre inclui `project_id` no
   *  UPDATE, então o negócio que TINHA empreendimento saía do banco sem ele e
   *  sem uma linha na tela; o Select apenas voltava ao placeholder. Aviso em
   *  vez de recusa: cobrar o campo no salvamento reabriria o beco sem saída da
   *  construtora sem catálogo. */
  const [projectCleared, setProjectCleared] = useState(false);
  const selectableBrokers = useSelectableBrokers();

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
  const canLeaveStage = isNew || !form.stage_id || canExitStage(form.stage_id);

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

  const managers = people.filter((person) => person.active
    && (person.roles.includes("manager") || person.roles.includes("director")));

  const loadProjects = useCallback(async (developerName: string) => {
    const developer = developers.find((row) => row.name === developerName);
    setProjectsError(null);
    if (!developer) return setProjects([]);
    try {
      setProjects(await listDeveloperProjects(developer.id));
    } catch (err) {
      setProjects([]);
      setProjectsError(describeError(err, "Não consegui carregar os empreendimentos desta construtora."));
    }
  }, [developers]);

  useEffect(() => {
    if (form.developer) void loadProjects(form.developer);
  }, [form.developer, loadProjects]);

  // Espelho de `saveLegacyDeal` (newSchema.ts) — a MESMA função, não uma cópia
  // da regra. Enquanto o aviso usava três constantes e o gravador outras,
  // "19. REPROVADO" encerrava o negócio pela tabela e não encerrava nada pelo
  // modal, com este aviso vermelho prometendo o que não acontecia. Dívida
  // `ponytail` do handoff-R, quitada: hoje os dois leem `isLossStatus`.
  const willLose = isLossStatus(form.status);

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={field("month")} className="text-eyebrow">Mês-base</Label>
          <Input
            id={field("month")} className="mt-1 text-xs" placeholder="MM/AAAA"
            value={form.month_base || ""} disabled={!isAdmin}
            aria-describedby={isAdmin ? undefined : field("month-hint")}
            onChange={(event) => isAdmin && onChange({ month_base: event.target.value })}
          />
          {/* Terceiro motivo de campo cinza na mesma tela (os outros dois vêm do
              `lock`) e o único sem frase: o mês-base define em qual ciclo o
              negócio conta e o que o fechamento congela, por isso só o admin o
              digita. Sem esta linha o campo parecia defeito. */}
          {!isAdmin && (
            <p id={field("month-hint")} className="mt-1 text-xs text-muted-foreground">
              Só o administrador altera o mês-base: ele decide em qual ciclo o negócio conta.
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
        <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
          <Label htmlFor={field("second-client")} className="text-eyebrow">2º cliente?</Label>
          <Switch
            id={field("second-client")} checked={form.has_second_client || false}
            onCheckedChange={(v) => onChange({ has_second_client: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
          <Label htmlFor={field("informal")} className="text-eyebrow">Renda informal?</Label>
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

      <Section title="Cliente">
        <TextField id={field("client")} label="Cliente *" value={form.client} onChange={(v) => onChange({ client: v })} />
        <TextField id={field("cpf")} label="CPF" value={form.cpf} onChange={(v) => onChange({ cpf: v })} />
        <TextField id={field("contato")} label="Contato" value={form.contato} onChange={(v) => onChange({ contato: v })} />
        <TextField id={field("pis")} label="Número do PIS" value={form.numero_pis} onChange={(v) => onChange({ numero_pis: v })} />
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
        <Section title="2º cliente">
          <TextField id={field("client2")} label="Cliente" value={form.client2} onChange={(v) => onChange({ client2: v })} />
          <TextField id={field("cpf2")} label="CPF" value={form.cpf2} onChange={(v) => onChange({ cpf2: v })} />
          <TextField id={field("contato2")} label="Contato" value={form.contato2} onChange={(v) => onChange({ contato2: v })} />
          <TextField id={field("pis2")} label="Número do PIS" value={form.numero_pis2} onChange={(v) => onChange({ numero_pis2: v })} />
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
        <Section title="Renda informal">
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

      <Section title="Empreendimento">
        <div>
          <Label htmlFor={field("developer")} className="text-eyebrow">Construtora *</Label>
          <Select
            value={form.developer}
            onValueChange={(v) => {
              setProjectCleared(v !== form.developer && Boolean((form.project ?? "").trim()));
              onChange({
                developer: v, project: "", project_id: null,
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
          {/* Sem asterisco: `dealRequiredError` não cobra este campo. O
              Select não aceita digitação livre, e construtora sem nenhum
              empreendimento cadastrado é caso real — exigi-lo aqui recusava o
              "Criar negócio" por algo que a tela não tinha como preencher. A
              outra porta do mesmo registro (`ConvertLeadDialog`) já o trata
              como opcional. */}
          <Label htmlFor={field("project")} className="text-eyebrow">Empreendimento</Label>
          <Select
            value={form.project} disabled={!form.developer}
            onValueChange={(v) => {
              setProjectCleared(false);
              onChange({ project: v, project_id: projects.find((row) => row.name === v)?.id ?? null });
            }}
          >
            <SelectTrigger id={field("project")} className="mt-1 text-xs">
              <SelectValue
                placeholder={projectPlaceholder({
                  developer: form.developer,
                  error: projectsError,
                  count: projects.length,
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {projects.map((row) => <SelectItem key={row.id} value={row.name}>{row.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* A troca de construtora acabou de esvaziar este campo. O Select
              apenas volta ao placeholder, e `saveLegacyDeal` grava
              `project_id: null` — sem esta linha, o negócio que TINHA
              empreendimento o perdia no banco sem nada dizer. Aviso, não
              recusa: cobrar o campo aqui reabriria o beco sem saída da
              construtora sem catálogo. */}
          {projectCleared && !projectsError && (
            <p role="status" className="mt-1 text-xs text-warning">
              Trocar a construtora limpou o empreendimento — ele pertencia à anterior. Escolha o
              novo antes de salvar, senão o negócio fica sem empreendimento.
            </p>
          )}
          {/* Erro de carga tinha a MESMA tela de "esta construtora não tem
              empreendimento": `catch { setProjects([]) }`, o que mandava o
              operador escolher outra construtora por causa de uma falha de
              rede. */}
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

      <Section title="Equipe">
        <PersonField id={field("broker1")} label="Corretor 1 *" hint={rateio(form.broker1_share)} value={form.broker1_id} fallbackName={form.broker1} options={brokers} onChange={(v) => onChange({ broker1_id: v })} />
        <PersonField id={field("broker2")} label="Corretor 2" hint={rateio(form.broker2_share)} value={form.broker2_id} fallbackName={form.broker2} options={brokers} onChange={(v) => onChange({ broker2_id: v })} optional />
        <PersonField id={field("broker3")} label="Corretor 3" hint={rateio(form.broker3_share)} value={form.broker3_id} fallbackName={form.broker3} options={brokers} onChange={(v) => onChange({ broker3_id: v })} optional />
        <PersonField id={field("manager1")} label="Gerente 1 *" value={form.manager1_id} fallbackName={form.manager1} options={managers} onChange={(v) => onChange({ manager1_id: v })} />
        <PersonField id={field("manager2")} label="Gerente 2" value={form.manager2_id} fallbackName={form.manager2} options={managers} onChange={(v) => onChange({ manager2_id: v })} optional />
        <PersonField id={field("manager3")} label="Gerente 3" value={form.manager3_id} fallbackName={form.manager3} options={managers} onChange={(v) => onChange({ manager3_id: v })} optional />
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

      <Section title="VGV">
        <div>
          <Label htmlFor={field("vgv")} className="text-eyebrow">VGV bruto</Label>
          {/* `min={0}` é só a seta do controle e o teclado do celular: sem
              `<form>` nem `checkValidity()`, ele NÃO impede digitar "-5". Quem
              barra antes do banco é `dealRangeError` no salvamento — o CHECK
              `vgv_gross >= 0` sozinho volta como 23514, que a tela traduz para
              "Um dos campos está fora do valor permitido" sem dizer qual. */}
          <Input
            id={field("vgv")} type="number" min={0} inputMode="decimal" className="mt-1 text-xs"
            value={form.vgv_bruto ?? ""}
            onChange={(event) => onChange({ vgv_bruto: Number(event.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor={field("desconto")} className="text-eyebrow">Percentual de desconto</Label>
          {/* Era texto livre: digitar "10%" virava desconto 0 sem aviso nenhum
              (`Number("10%")` é NaN). O campo numérico tira o formato ambíguo;
              a FAIXA quem cobra é `dealRangeError` no salvamento — `max={100}`
              aqui não impede colar "150". */}
          <Input
            id={field("desconto")} type="number" min={0} max={100} step={0.01}
            inputMode="decimal" className="mt-1 text-xs"
            value={form.perc_desconto ?? ""}
            onChange={(event) => onChange({ perc_desconto: event.target.value })}
          />
        </div>
        <div>
          {/* Não é campo: é leitura. Era um `<input disabled>` com o número CRU
              ("1140000") num campo rotulado VGV, enquanto a tabela, o cartão e o
              cabeçalho ao lado mostravam "R$ 1.140.000" — e a explicação de por
              que ele é cinza vivia só no `title`, que num controle desabilitado
              não recebe foco e não existe para teclado nem leitor de tela (a
              mesma "explicação morta" que a tabela já tinha rejeitado).
              `brl` devolve travessão para nulo, em vez de afirmar R$ 0 num
              negócio que ainda não tem VGV. */}
          <p className="text-eyebrow">VGV líquido</p>
          <p className="mt-1 text-xs tabular-nums">{brl(form.vgv_liquido)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Calculado pelo banco a partir do VGV bruto e do desconto.
          </p>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={field("stage")} className="text-eyebrow">Etapa (Status 1)</Label>
          <Select value={form.stage} disabled={!canLeaveStage} onValueChange={(v) => onChange({ stage: v as DealStage })}>
            <SelectTrigger id={field("stage")} className="mt-1 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {/* Cada etapa é oferecida conforme `can_enter_stage()` — a mesma
                  regra que barra o arrastar no kanban. O Select inteiro ficava
                  `disabled={!isAdmin}`, escondendo do gerente o que o banco
                  aceita (achado X01).

                  A etapa de perda fica de fora: escolher "Perdido" aqui
                  encerraria o negócio no salvamento, sem motivo e sem a
                  confirmação que o achado F14 exige. Perder é pela ação
                  própria, na tabela. */}
              {funnelStages(stages).map((stage) => (
                <SelectItem key={stage.id} value={stage.code} disabled={!canEnterStage(stage.id)}>
                  {stage.label}{canEnterStage(stage.id) ? "" : " (sem permissão)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!canLeaveStage && (
            <p className="mt-1 text-xs text-muted-foreground">
              Seu perfil não pode tirar um negócio desta etapa (matriz de etapas do
              admin). Peça a um gestor.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={field("status")} className="text-eyebrow">Status da venda (Status 2)</Label>
          <Select value={form.status} onValueChange={(v) => onChange({ status: v })}>
            <SelectTrigger id={field("status")} className="mt-1 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              {statusChoices(form.status).map((option) => (
                <SelectItem key={option.label} value={option.label}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
