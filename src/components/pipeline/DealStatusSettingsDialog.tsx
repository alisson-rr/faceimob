import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { LoadingState, type StatusTone } from "@/components/shared";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";
import {
  EMPTY_STATUS_CATALOG, buildDealStatusCatalog, createDealStatus, createDealStatusGroup,
  dealStatusKeys, statusKey, updateDealStatus, updateDealStatusGroup, useDealStatusCatalog,
  type DealStatus, type DealStatusCatalog, type DealStatusGroup,
} from "@/integrations/supabase/dealStatuses";
import { CCA_TONE_OPTIONS } from "./ccaStage";
import { useInvalidateDeals } from "./data";
import { STATUS_TONE_CLASS, groupChoices, statusGroupCode } from "./statuses";

type Otimista = (catalog: DealStatusCatalog) => DealStatusCatalog;

const comGrupos = (patches: Record<string, Partial<DealStatusGroup>>): Otimista => (catalog) =>
  buildDealStatusCatalog(catalog.groups.map((group) => ({ ...group, ...patches[group.id] })), catalog.statuses);

const comStatus = (patches: Record<string, Partial<DealStatus>>): Otimista => (catalog) =>
  buildDealStatusCatalog(catalog.groups, catalog.statuses.map((status) => ({ ...status, ...patches[status.id] })));

const semMudanca: Otimista = (catalog) => catalog;

const proximaPosicao = (rows: { position: number }[]) => Math.max(0, ...rows.map((row) => row.position)) + 1;

/**
 * Cadastro do Status 1 e do Status 2 (0149) — o que antes só mudava com deploy.
 *
 * Não cria nem apaga negócio e não exclui status: um status que algum negócio
 * usa não pode sumir, e desativar cobre o pedido (sem DELETE no banco). O texto
 * gravado do Status 2 e o código do Status 1 não mudam depois de criados; o
 * nome exibido muda.
 *
 * Toda gravação aparece na hora e, se o banco recusar, a tela volta ao que o
 * banco tem — o padrão do catálogo de tipos de documento (`CcaPipeline`).
 */
export function DealStatusSettingsDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const invalidateDeals = useInvalidateDeals();
  const query = useDealStatusCatalog();
  const catalog = query.data ?? EMPTY_STATUS_CATALOG;
  const [salvando, setSalvando] = useState(0);
  const alterou = useRef(false);
  /**
   * Controles que recebem de volta o foco que a gravação otimista derrubou, em
   * ordem de preferência. Quando a linha só muda de lugar o React devolve o foco
   * sozinho; ele não consegue quando o botão apertado fica desabilitado no limite
   * da lista, nem quando trocar o Status 1 remonta a linha em outra seção. Aí o
   * foco caía e o `FocusScope` do Radix o levava ao topo do diálogo — quem usa
   * teclado atravessava dezenas de controles de novo.
   */
  const focoDepois = useRef<string[] | null>(null);

  useEffect(() => {
    const ids = focoDepois.current;
    focoDepois.current = null;
    if (!ids) return;
    // Só devolve o foco que caiu (no corpo ou no próprio diálogo).
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body && ativo.getAttribute("role") !== "dialog") return;
    ids.map((alvo) => document.getElementById(alvo))
      .find((elemento) => elemento && !elemento.matches(":disabled"))
      ?.focus();
  }, [catalog]);

  const [nomeGrupo, setNomeGrupo] = useState("");
  const [textoStatus, setTextoStatus] = useState("");
  const [grupoStatus, setGrupoStatus] = useState("");
  const [tomStatus, setTomStatus] = useState<StatusTone>("info");

  const codigoGrupo = statusGroupCode(nomeGrupo);
  const grupoRepetido = Boolean(codigoGrupo) && catalog.groups.some((group) => group.code === codigoGrupo);
  const textoNovo = textoStatus.trim();
  const statusRepetido = Boolean(textoNovo) && catalog.indexByKey.has(statusKey(textoNovo));

  // O cadastro não reescreve negócio nenhum (0149), então a lista de negócios
  // recarrega uma vez, ao fechar — e não a cada interruptor: são 7.579 linhas
  // para trazer de volta os mesmos dados.
  const fechar = () => {
    if (alterou.current) void invalidateDeals();
    onClose();
  };

  const gravar = async (otimista: Otimista, escrever: () => Promise<void>, sucesso: string) => {
    setSalvando((total) => total + 1);
    await queryClient.cancelQueries({ queryKey: dealStatusKeys.catalog });
    const anterior = queryClient.getQueryData<DealStatusCatalog>(dealStatusKeys.catalog);
    if (anterior) queryClient.setQueryData(dealStatusKeys.catalog, otimista(anterior));
    try {
      await escrever();
      alterou.current = true;
      toast.success(sucesso, { duration: 2500 });
      return true;
    } catch (erro) {
      if (anterior) queryClient.setQueryData(dealStatusKeys.catalog, anterior);
      toast.error("Não foi possível salvar", {
        description: describeError(erro, "O cadastro continua como estava."),
      });
      return false;
    } finally {
      setSalvando((total) => total - 1);
      // A releitura é a palavra final: com duas gravações em voo, o `anterior`
      // de uma pode não ter a outra.
      await queryClient.invalidateQueries({ queryKey: dealStatusKeys.catalog });
    }
  };

  // ponytail: troca a posição com o vizinho; empate de `position` (só por SQL,
  // a tela sempre cria no fim) não reordena. Renumerar a lista quando existir.
  const mover = (
    lista: { id: string; label: string; position: number }[],
    index: number,
    delta: -1 | 1,
    aplicar: (patches: Record<string, { position: number }>) => Otimista,
    salvar: (rowId: string, patch: { position: number }) => Promise<void>,
    campo: string,
  ) => {
    const atual = lista[index];
    const vizinho = lista[index + delta];
    if (!atual || !vizinho) return;
    // O botão apertado; o outro da linha quando ele fica desabilitado no limite.
    focoDepois.current = delta < 0
      ? [`${campo}-subir`, `${campo}-descer`]
      : [`${campo}-descer`, `${campo}-subir`];
    void gravar(
      aplicar({ [atual.id]: { position: vizinho.position }, [vizinho.id]: { position: atual.position } }),
      async () => {
        await salvar(atual.id, { position: vizinho.position });
        await salvar(vizinho.id, { position: atual.position });
      },
      `"${atual.label}" ${delta < 0 ? "subiu" : "desceu"} na ordem`,
    );
  };

  const criarGrupo = async () => {
    const label = nomeGrupo.trim();
    if (!label || !codigoGrupo || grupoRepetido) return;
    const ok = await gravar(
      semMudanca,
      () => createDealStatusGroup({ code: codigoGrupo, label, position: proximaPosicao(catalog.groups) }),
      `Status 1 "${label}" criado`,
    );
    if (ok) setNomeGrupo("");
  };

  const criarStatus = async () => {
    if (!textoNovo || !grupoStatus || statusRepetido) return;
    const ok = await gravar(
      semMudanca,
      () => createDealStatus({
        value: textoNovo, group_id: grupoStatus, tone: tomStatus,
        position: proximaPosicao(catalog.statuses.filter((status) => status.group_id === grupoStatus)),
      }),
      `Status 2 "${textoNovo}" criado`,
    );
    if (ok) setTextoStatus("");
  };

  /** Nome exibido editado no campo: grava ao sair, e campo vazio volta ao nome atual. */
  const aoSairDoNome = (atual: string, gravarNome: (label: string) => void) =>
    (event: React.FocusEvent<HTMLInputElement>) => {
      const label = event.target.value.trim();
      event.target.value = label || atual;
      if (label && label !== atual) gravarNome(label);
    };

  return (
    <Dialog open onOpenChange={(open) => !open && fechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Status do negócio</DialogTitle>
          <DialogDescription>
            Cada Status 2 pertence a um Status 1, e trocar o Status 2 de um negócio leva o Status 1
            junto. Mudar o cadastro não reescreve os negócios que já têm o status. Desativar tira das
            opções de escolha, sem apagar nada.
          </DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <LoadingState variant="list" rows={5} label="Carregando o cadastro de status…" />
        ) : query.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            {describeError(query.error, "Não consegui ler o cadastro de status.")}
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Tentar de novo</Button>
          </div>
        ) : (
          <div className="space-y-6">
            <section aria-labelledby={`${id}-s1`} className="space-y-2">
              <h3 id={`${id}-s1`} className="text-sm font-semibold">Status 1</h3>
              {catalog.groups.map((group, index) => {
                const campo = `${id}-g-${group.id}`;
                return (
                  <div
                    key={group.id}
                    role="group"
                    aria-label={`Status 1 ${group.label}`}
                    className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 p-2"
                  >
                    <div className="min-w-[10rem] flex-1">
                      <Label htmlFor={`${campo}-nome`} className="text-xs">Nome</Label>
                      {/* A `key` amarra o campo ao nome em cache: quando o banco
                          recusa e a tela volta, o campo remonta com o nome real. */}
                      <Input
                        key={`${group.id}-${group.label}`}
                        id={`${campo}-nome`} className="mt-1 h-8 text-xs" maxLength={80}
                        defaultValue={group.label}
                        onBlur={aoSairDoNome(group.label, (label) => void gravar(
                          comGrupos({ [group.id]: { label } }),
                          () => updateDealStatusGroup(group.id, { label }),
                          "Nome do Status 1 atualizado",
                        ))}
                      />
                    </div>
                    <p className="pb-2 text-xs text-muted-foreground">
                      Código <span className="font-mono text-foreground">{group.code}</span>
                    </p>
                    <div className="flex items-center gap-2 pb-1.5">
                      <Switch
                        id={`${campo}-ativo`} checked={group.active}
                        onCheckedChange={(active) => void gravar(
                          comGrupos({ [group.id]: { active } }),
                          () => updateDealStatusGroup(group.id, { active }),
                          active ? `"${group.label}" ativado` : `"${group.label}" desativado`,
                        )}
                      />
                      <Label htmlFor={`${campo}-ativo`} className="text-xs">Ativo</Label>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8" aria-label={`Subir ${group.label}`}
                        disabled={index === 0}
                        id={`${campo}-subir`} onClick={() => mover(catalog.groups, index, -1, comGrupos, updateDealStatusGroup, campo)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8" aria-label={`Descer ${group.label}`}
                        disabled={index === catalog.groups.length - 1}
                        id={`${campo}-descer`} onClick={() => mover(catalog.groups, index, 1, comGrupos, updateDealStatusGroup, campo)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-2">
                <div className="min-w-[12rem] flex-1">
                  <Label htmlFor={`${id}-novo-grupo`} className="text-xs">Novo Status 1</Label>
                  <Input
                    id={`${id}-novo-grupo`} className="mt-1 h-8 text-xs" maxLength={80}
                    placeholder="Ex.: Pós-venda" value={nomeGrupo}
                    aria-describedby={`${id}-novo-grupo-codigo`}
                    aria-invalid={grupoRepetido}
                    onChange={(event) => setNomeGrupo(event.target.value)}
                  />
                </div>
                <Button size="sm" disabled={!codigoGrupo || grupoRepetido} onClick={() => void criarGrupo()}>
                  <Plus className="mr-1 h-4 w-4" /> Criar Status 1
                </Button>
                <p
                  id={`${id}-novo-grupo-codigo`}
                  className={cn("basis-full text-xs", grupoRepetido ? "text-destructive" : "text-muted-foreground")}
                >
                  {grupoRepetido
                    ? `Já existe um Status 1 com o código ${codigoGrupo}.`
                    : codigoGrupo
                      ? `Código ${codigoGrupo}. Ele sai do nome e não muda depois.`
                      : "O código sai do nome, em caixa alta, e não muda depois."}
                </p>
              </div>
            </section>

            <section aria-labelledby={`${id}-s2`} className="space-y-3">
              <h3 id={`${id}-s2`} className="text-sm font-semibold">Status 2</h3>
              {catalog.groups.map((group) => {
                const lista = catalog.statuses.filter((status) => status.group_id === group.id);
                return (
                  <div key={group.id} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                      {group.label}{!group.active && " (inativo)"}
                    </h4>
                    {lista.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhum Status 2 neste Status 1.</p>
                    )}
                    {lista.map((status, index) => {
                      const campo = `${id}-s-${status.id}`;
                      return (
                        <div
                          key={status.id}
                          role="group"
                          aria-label={`Status 2 ${status.label}`}
                          className="space-y-2 rounded-xl border border-border bg-muted/20 p-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("rounded px-2 py-0.5 text-xs font-bold", STATUS_TONE_CLASS[status.tone])}>
                              {status.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Texto gravado <span className="font-mono text-foreground">{status.value}</span>
                            </span>
                            {status.locked && (
                              <span id={`${campo}-trava`} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Lock className="h-3 w-3" aria-hidden />
                                Usado por regras do sistema: não se desativa.
                              </span>
                            )}
                            <div className="ml-auto flex gap-1">
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8" aria-label={`Subir ${status.label}`}
                                disabled={index === 0}
                                id={`${campo}-subir`} onClick={() => mover(lista, index, -1, comStatus, updateDealStatus, campo)}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8" aria-label={`Descer ${status.label}`}
                                disabled={index === lista.length - 1}
                                id={`${campo}-descer`} onClick={() => mover(lista, index, 1, comStatus, updateDealStatus, campo)}
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <div>
                              <Label htmlFor={`${campo}-nome`} className="text-xs">Nome exibido</Label>
                              <Input
                                key={`${status.id}-${status.label}`}
                                id={`${campo}-nome`} className="mt-1 h-8 text-xs" maxLength={80}
                                defaultValue={status.label}
                                onBlur={aoSairDoNome(status.label, (label) => void gravar(
                                  comStatus({ [status.id]: { label } }),
                                  () => updateDealStatus(status.id, { label }),
                                  "Nome exibido atualizado",
                                ))}
                              />
                            </div>
                            <div>
                              <Label htmlFor={`${campo}-grupo`} className="text-xs">Status 1</Label>
                              <Select
                                value={status.group_id}
                                onValueChange={(groupId) => {
                                  // Entra no fim do Status 1 de destino.
                                  const position = proximaPosicao(
                                    catalog.statuses.filter((other) => other.group_id === groupId),
                                  );
                                  focoDepois.current = [`${campo}-grupo`];
                                  void gravar(
                                    comStatus({ [status.id]: { group_id: groupId, position } }),
                                    () => updateDealStatus(status.id, { group_id: groupId, position }),
                                    `"${status.label}" mudou de Status 1`,
                                  );
                                }}
                              >
                                <SelectTrigger id={`${campo}-grupo`} className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {groupChoices(catalog, status.group_id).map((option) => (
                                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor={`${campo}-cor`} className="text-xs">Cor</Label>
                              <Select
                                value={status.tone}
                                onValueChange={(value) => {
                                  const tone = value as StatusTone;
                                  void gravar(
                                    comStatus({ [status.id]: { tone } }),
                                    () => updateDealStatus(status.id, { tone }),
                                    "Cor atualizada",
                                  );
                                }}
                              >
                                <SelectTrigger id={`${campo}-cor`} className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {CCA_TONE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Switch
                              id={`${campo}-ativo`} checked={status.active} disabled={status.locked}
                              aria-describedby={status.locked ? `${campo}-trava` : undefined}
                              onCheckedChange={(active) => void gravar(
                                comStatus({ [status.id]: { active } }),
                                () => updateDealStatus(status.id, { active }),
                                active ? `"${status.label}" ativado` : `"${status.label}" desativado`,
                              )}
                            />
                            <Label htmlFor={`${campo}-ativo`} className="text-xs">Ativo</Label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <div className="grid grid-cols-1 gap-2 rounded-xl border border-dashed border-border p-2 sm:grid-cols-3">
                <div>
                  <Label htmlFor={`${id}-novo-status`} className="text-xs">Novo Status 2</Label>
                  <Input
                    id={`${id}-novo-status`} className="mt-1 h-8 text-xs" maxLength={80}
                    placeholder="Ex.: AGUARDANDO VISTORIA" value={textoStatus}
                    aria-describedby={`${id}-novo-status-dica`}
                    aria-invalid={statusRepetido}
                    onChange={(event) => setTextoStatus(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor={`${id}-novo-status-grupo`} className="text-xs">Status 1</Label>
                  <Select value={grupoStatus} onValueChange={setGrupoStatus}>
                    <SelectTrigger id={`${id}-novo-status-grupo`} className="mt-1 h-8 text-xs">
                      <SelectValue placeholder="Escolha o Status 1" />
                    </SelectTrigger>
                    <SelectContent>
                      {groupChoices(catalog).map((option) => (
                        <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`${id}-novo-status-cor`} className="text-xs">Cor</Label>
                  <Select value={tomStatus} onValueChange={(value) => setTomStatus(value as StatusTone)}>
                    <SelectTrigger id={`${id}-novo-status-cor`} className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CCA_TONE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p
                  id={`${id}-novo-status-dica`}
                  className={cn("text-xs sm:col-span-3", statusRepetido ? "text-destructive" : "text-muted-foreground")}
                >
                  {statusRepetido
                    ? "Já existe um Status 2 com esse texto. O número na frente e as maiúsculas não contam."
                    : "O texto é gravado nos negócios e não muda depois. Na tela ele aparece sem o número da frente, e o nome exibido dá para trocar. VENDA, PROPOSTA, QUEDA e textos que começam com OFF ou DISTRATO são reservados."}
                </p>
                <div className="sm:col-span-3">
                  <Button
                    size="sm" disabled={!textoNovo || !grupoStatus || statusRepetido}
                    onClick={() => void criarStatus()}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Criar Status 2
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {/* Sempre montado: `role="status"` só anuncia a mudança de um nó que já existia. */}
          <p role="status" className="mr-auto text-xs text-muted-foreground">
            {salvando > 0 ? "Salvando…" : ""}
          </p>
          <Button variant="outline" onClick={fechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
