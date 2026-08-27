import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { dateTime } from "@/lib/format";
import { normalizeStatus } from "@/lib/dealStatus";
import type { DealStage } from "@/types/crm";
import { useAuth } from "@/contexts/AuthContext";
import { listDeveloperProjects } from "@/integrations/supabase/leads";
import type { PersonRecord, SaveLegacyDealInput } from "@/integrations/supabase/newSchema";
import { ChoiceField, PersonField, Section, TextField } from "./fields";
import { statusChoices } from "./statuses";
import { funnelStages, type PipelineStage } from "./stages";

const SIM_NAO = ["NÃO", "SIM"];
const ORIGENS = ["Lead Próprio", "Indicação", "Facebook", "Google", "Stand"];

interface Props {
  form: SaveLegacyDealInput;
  onChange: (patch: Partial<SaveLegacyDealInput>) => void;
  field: (name: string) => string;
  people: PersonRecord[];
  developers: { id: string; name: string }[];
  stages: PipelineStage[];
  isNew: boolean;
}

/** Aba "Detalhes" do negócio: o formulário inteiro. */
export function DealForm({ form, onChange, field, people, developers, stages, isNew }: Props) {
  const { isAdmin, canEnterStage } = useAuth();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const brokers = people.filter((person) => person.active && person.roles.includes("broker"));
  const managers = people.filter((person) => person.active
    && (person.roles.includes("manager") || person.roles.includes("director")));

  const loadProjects = useCallback(async (developerName: string) => {
    const developer = developers.find((row) => row.name === developerName);
    if (!developer) return setProjects([]);
    try {
      setProjects(await listDeveloperProjects(developer.id));
    } catch {
      setProjects([]);
    }
  }, [developers]);

  useEffect(() => {
    if (form.developer) void loadProjects(form.developer);
  }, [form.developer, loadProjects]);

  // Espelho de `saveLegacyDeal` (newSchema.ts), NÃO da lista de motivos de
  // perda: o aviso tem de dizer o que o gravador vai fazer. Por isso ele
  // continua em três constantes e não em `isLossStatus` — "19. REPROVADO" é
  // motivo de perda na tabela e no diálogo, mas salvar por aqui ainda mantém a
  // etapa. Trocar só este `willLose` faria a tela prometer o que o gravador não
  // cumpre; consertar de verdade é mexer em `saveLegacyDeal` junto.
  // ponytail: dívida registrada no handoff-R; some quando `saveLegacyDeal`
  // passar a usar `isLossStatus`.
  const outcome = normalizeStatus(form.status);
  const willLose = outcome === "QUEDA" || outcome === "DISTRATO" || outcome === "OFF";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={field("month")} className="text-eyebrow">Mês-base</Label>
          <Input
            id={field("month")} className="mt-1 text-xs" placeholder="MM/AAAA"
            value={form.month_base || ""} disabled={!isAdmin}
            onChange={(event) => isAdmin && onChange({ month_base: event.target.value })}
          />
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
            onValueChange={(v) => onChange({
              developer: v, project: "", project_id: null,
              developer_id: developers.find((row) => row.name === v)?.id ?? null,
            })}
          >
            <SelectTrigger id={field("developer")} className="mt-1 text-xs">
              <SelectValue placeholder="Escolher" />
            </SelectTrigger>
            <SelectContent>
              {developers.map((row) => <SelectItem key={row.id} value={row.name}>{row.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={field("project")} className="text-eyebrow">Empreendimento *</Label>
          <Select
            value={form.project} disabled={!form.developer}
            onValueChange={(v) => onChange({ project: v, project_id: projects.find((row) => row.name === v)?.id ?? null })}
          >
            <SelectTrigger id={field("project")} className="mt-1 text-xs">
              <SelectValue placeholder={projects.length ? "Escolher" : "Sem empreendimentos"} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((row) => <SelectItem key={row.id} value={row.name}>{row.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <TextField id={field("unit")} label="Bloco | unidade" value={form.unit} onChange={(v) => onChange({ unit: v })} />
      </Section>

      <Section title="Equipe">
        <PersonField id={field("broker1")} label="Corretor 1 *" value={form.broker1_id} fallbackName={form.broker1} options={brokers} onChange={(v) => onChange({ broker1_id: v })} />
        <PersonField id={field("broker2")} label="Corretor 2" value={form.broker2_id} fallbackName={form.broker2} options={brokers} onChange={(v) => onChange({ broker2_id: v })} optional />
        <PersonField id={field("broker3")} label="Corretor 3" value={form.broker3_id} fallbackName={form.broker3} options={brokers} onChange={(v) => onChange({ broker3_id: v })} optional />
        <PersonField id={field("manager1")} label="Gerente 1 *" value={form.manager1_id} fallbackName={form.manager1} options={managers} onChange={(v) => onChange({ manager1_id: v })} />
        <PersonField id={field("manager2")} label="Gerente 2" value={form.manager2_id} fallbackName={form.manager2} options={managers} onChange={(v) => onChange({ manager2_id: v })} optional />
        <PersonField id={field("manager3")} label="Gerente 3" value={form.manager3_id} fallbackName={form.manager3} options={managers} onChange={(v) => onChange({ manager3_id: v })} optional />
      </Section>

      <Section title="VGV">
        <div>
          <Label htmlFor={field("vgv")} className="text-eyebrow">VGV bruto</Label>
          <Input
            id={field("vgv")} type="number" inputMode="decimal" className="mt-1 text-xs"
            value={form.vgv_bruto ?? ""}
            onChange={(event) => onChange({ vgv_bruto: Number(event.target.value) })}
          />
        </div>
        <TextField id={field("desconto")} label="Percentual de desconto" value={form.perc_desconto} onChange={(v) => onChange({ perc_desconto: v })} />
        <div>
          <Label htmlFor={field("vgv-liq")} className="text-eyebrow">VGV líquido</Label>
          <Input
            id={field("vgv-liq")} className="mt-1 text-xs opacity-70" readOnly disabled
            value={form.vgv_liquido ?? 0}
            title="Calculado pelo banco a partir do VGV bruto e do desconto"
          />
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={field("stage")} className="text-eyebrow">Etapa (Status 1)</Label>
          <Select value={form.stage} onValueChange={(v) => onChange({ stage: v as DealStage })}>
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
    </>
  );
}
