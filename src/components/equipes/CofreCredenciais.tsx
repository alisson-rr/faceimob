import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Eye, EyeOff, ExternalLink, KeySquare, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, LoadingState, SectionCard } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import {
  apagarCredencial, listarCredenciais, listarRevelacoes, revelarCredencial,
  salvarCredencial, type CredencialCofre, type RevelacaoCofre,
} from "@/integrations/supabase/cofre";
import { DefinirSenhaCard } from "./cofre/DefinirSenhaCard";

/**
 * Aba "Cofre" de Equipes — os logins da operação num lugar só.
 *
 * O QUE ESTA TELA NÃO FAZ, e é o desenho: ela não carrega senha nenhuma. A
 * listagem vem sem segredo (`list_operation_credentials`), e o valor só vai
 * para o browser quando alguém aperta "Revelar" — um item por vez, com linha em
 * `credential_reveal_log` gravada na mesma transação da leitura. Trazer tudo de
 * uma vez seria mais simples e deixaria todas as senhas da empresa no network
 * tab de quem apenas abriu a aba.
 *
 * Só administrador e sócio veem — e as duas coisas são a mesma pela decisão do
 * cliente (10/09/2026), então o gate é o `isAdmin` do contexto, que já embute o
 * sócio. O banco recusa igual, com `is_admin()` dentro de cada RPC: esconder o
 * botão é conveniência, a trava é lá.
 */
export function CofreCredenciais() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [itens, setItens] = useState<CredencialCofre[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Segredos revelados NESTA sessão de tela, por id. Nunca vem do `listar`.
  const [revelados, setRevelados] = useState<Record<string, string>>({});
  const [revelando, setRevelando] = useState<string | null>(null);
  const [emEdicao, setEmEdicao] = useState<CredencialCofre | "nova" | null>(null);
  const [aApagar, setAApagar] = useState<CredencialCofre | null>(null);
  const [apagandoAgora, setApagandoAgora] = useState(false);
  const [trilha, setTrilha] = useState<RevelacaoCofre[] | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setItens(await listarCredenciais());
      setErro(null);
    } catch (falha: unknown) {
      setItens([]);
      setErro(describeError(falha, "Não foi possível abrir o cofre."));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) void carregar(); }, [isAdmin, carregar]);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={KeySquare}
        tone="danger"
        title="Cofre restrito"
        description="Só administradores e sócios veem as credenciais da operação."
      />
    );
  }

  const revelar = async (item: CredencialCofre) => {
    // Já revelado nesta tela: esconder é só tirar da memória, sem nova consulta
    // (e sem uma segunda linha de auditoria que ninguém pediu).
    if (revelados[item.id]) {
      setRevelados((antes) => { const proximo = { ...antes }; delete proximo[item.id]; return proximo; });
      return;
    }
    setRevelando(item.id);
    try {
      const valor = await revelarCredencial(item.id);
      setRevelados((antes) => ({ ...antes, [item.id]: valor }));
      // A trilha aberta acabou de ficar velha: a revelação atual não está nela.
      if (trilha) void listarRevelacoes().then(setTrilha, () => undefined);
    } catch (falha: unknown) {
      toast({
        variant: "destructive",
        title: "Não foi possível revelar",
        description: describeError(falha, "Falha ao ler a credencial no cofre."),
      });
    } finally {
      setRevelando(null);
    }
  };

  const apagar = async () => {
    if (!aApagar) return;
    setApagandoAgora(true);
    try {
      const havia = await apagarCredencial(aApagar.id);
      toast({
        title: havia ? "Credencial apagada" : "Nada a apagar",
        description: havia
          ? aApagar.profile_id
            ? "O cofre esqueceu a senha. O acesso da pessoa continua valendo — para tirá-lo, use o desligamento na ficha."
            : "O valor saiu do cofre."
          : "Esta credencial já não estava no cofre.",
        variant: havia ? "success" : undefined,
      });
      setAApagar(null);
      await carregar();
    } catch (falha: unknown) {
      toast({
        variant: "destructive",
        title: "Não foi possível apagar",
        description: describeError(falha, "Falha ao apagar a credencial."),
      });
    } finally {
      setApagandoAgora(false);
    }
  };

  const abrirTrilha = async () => {
    if (trilha) {
      setTrilha(null);
      return;
    }
    try {
      setTrilha(await listarRevelacoes());
    } catch (falha: unknown) {
      toast({
        variant: "destructive",
        title: "Não foi possível ler a trilha",
        description: describeError(falha, "Falha ao ler quem revelou credenciais."),
      });
    }
  };

  return (
    <div className="space-y-4">
      <DefinirSenhaCard onDefinida={() => void carregar()} />

      <SectionCard
        title="Cofre de acessos da operação"
        description="E-mail, pipeline, painel de construtora e as senhas de acesso ao sistema. Só administradores e sócios."
        icon={KeySquare}
        actions={
          <Button size="sm" onClick={() => setEmEdicao("nova")}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Novo acesso
          </Button>
        }
        footer={
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              aria-expanded={!!trilha}
              onClick={() => void abrirTrilha()}
            >
              <ScrollText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {trilha ? "Ocultar quem revelou" : "Ver quem revelou"}
            </Button>
            {trilha && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {trilha.length === 0 && <li>Ninguém revelou nada ainda.</li>}
                {trilha.map((linha, indice) => (
                  <li key={`${linha.created_at}-${indice}`}>
                    {dateTime(linha.created_at)} · {linha.actor_email ?? "—"} revelou “{linha.credential_label}”
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
      >
        {carregando && <LoadingState variant="list" rows={3} label="Abrindo o cofre…" />}

        {!carregando && erro && (
          <EmptyState
            icon={KeySquare}
            tone="danger"
            title="Não foi possível abrir o cofre"
            description={erro}
            action={<Button size="sm" onClick={() => void carregar()}>Tentar de novo</Button>}
          />
        )}

        {!carregando && !erro && itens.length === 0 && (
          <EmptyState
            icon={KeySquare}
            title="Nenhum acesso guardado"
            description="Cadastre o e-mail da empresa, o pipeline, o painel da construtora — o que a equipe hoje pergunta no grupo."
            action={<Button size="sm" onClick={() => setEmEdicao("nova")}>Novo acesso</Button>}
          />
        )}

        {!carregando && !erro && itens.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="p-2 text-left font-medium">O que é</th>
                  <th className="p-2 text-left font-medium">Login</th>
                  <th className="p-2 text-left font-medium">Senha</th>
                  <th className="p-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id} className="border-b border-border/40 align-top">
                    <td className="p-2">
                      <span className="block">{item.label}</span>
                      {item.profile_id && (
                        <span className="text-xs text-muted-foreground">
                          Acesso ao sistema · {item.profile_name ?? "colaborador"}
                        </span>
                      )}
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                        >
                          Abrir <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </td>
                    <td className="p-2 break-all">{item.login}</td>
                    <td className="p-2">
                      <code className="select-all font-mono text-sm">
                        {revelados[item.id] ?? "••••••••"}
                      </code>
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={revelando === item.id}
                          aria-pressed={!!revelados[item.id]}
                          onClick={() => void revelar(item)}
                        >
                          {revelados[item.id]
                            ? <><EyeOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Ocultar</>
                            : <><Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Revelar</>}
                        </Button>
                        {/* Senha de pessoa muda pelo card acima: o banco recusa
                            editá-la por aqui, porque o cofre passaria a afirmar
                            uma senha que o login não tem. */}
                        {!item.profile_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            aria-label={`Editar ${item.label}`}
                            onClick={() => setEmEdicao(item)}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive"
                          aria-label={`Apagar ${item.label}`}
                          onClick={() => setAApagar(item)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <CredencialDialog
        alvo={emEdicao}
        onFechar={() => setEmEdicao(null)}
        onSalvo={() => { setEmEdicao(null); void carregar(); }}
      />

      <AlertDialog
        open={!!aApagar}
        onOpenChange={(aberto) => { if (!aberto && !apagandoAgora) setAApagar(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{aApagar?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O valor sai do cofre e não volta.{" "}
              {aApagar?.profile_id
                ? "O acesso da pessoa continua valendo — o cofre só deixa de saber a senha."
                : "Quem usa esse acesso vai precisar dele de outra fonte."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagandoAgora}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={apagandoAgora} onClick={(evento) => { evento.preventDefault(); void apagar(); }}>
              {apagandoAgora ? "Apagando…" : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Cadastro e edição de uma credencial da operação.
 *
 * A validação repete a do banco (rótulo, login, link absoluto) porque a recusa
 * do Postgres chega à tela como "um dos campos está fora do valor permitido",
 * sem dizer qual. A trava continua sendo a de lá.
 */
function CredencialDialog({
  alvo, onFechar, onSalvo,
}: {
  alvo: CredencialCofre | "nova" | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { toast } = useToast();
  const labelId = useId();
  const loginId = useId();
  const secretId = useId();
  const linkId = useId();

  const editando = alvo && alvo !== "nova" ? alvo : null;
  const [label, setLabel] = useState("");
  const [login, setLogin] = useState("");
  const [secret, setSecret] = useState("");
  const [link, setLink] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Deriva o formulário do item aberto. Sem isto, abrir "editar" depois de
  // "novo" mostraria o rascunho anterior.
  useEffect(() => {
    setLabel(editando?.label ?? "");
    setLogin(editando?.login ?? "");
    setLink(editando?.link ?? "");
    // A senha nunca volta do servidor: editar exige digitá-la de novo, e é o
    // que impede a tela de gravar um placeholder por cima do valor bom.
    setSecret("");
  }, [editando]);

  const linkOk = link.trim() === "" || /^https?:\/\/[^\s]+$/i.test(link.trim());
  const podeSalvar =
    label.trim().length > 0 && label.trim().length <= 120 &&
    login.trim().length > 0 && login.trim().length <= 200 &&
    secret.length > 0 && secret.length <= 500 &&
    linkOk && !salvando;

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      await salvarCredencial({
        id: editando?.id ?? null,
        label: label.trim(),
        login: login.trim(),
        secret,
        link: link.trim() || null,
      });
      toast({ title: editando ? "Acesso atualizado" : "Acesso guardado no cofre", variant: "success" });
      onSalvo();
    } catch (falha: unknown) {
      toast({
        variant: "destructive",
        title: "Não foi possível salvar",
        description: describeError(falha, "Falha ao gravar a credencial no cofre."),
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(aberto) => { if (!aberto && !salvando) onFechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editando ? "Editar acesso" : "Novo acesso"}</DialogTitle>
          <DialogDescription>
            O valor fica guardado e só aparece quando alguém aperta “Revelar” — e essa consulta é
            registrada.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submeter} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor={labelId}>O que é</Label>
            <Input
              id={labelId}
              value={label}
              maxLength={120}
              onChange={(evento) => setLabel(evento.target.value)}
              placeholder="E-mail da empresa, painel da construtora Alfa…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={loginId}>Login</Label>
            <Input
              id={loginId}
              value={login}
              maxLength={200}
              autoComplete="off"
              onChange={(evento) => setLogin(evento.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={secretId}>Senha</Label>
            {/* `text`, não `password`: quem digita aqui está guardando a senha
                de OUTRO sistema e precisa conferir o que colou. */}
            <Input
              id={secretId}
              type="text"
              value={secret}
              maxLength={500}
              autoComplete="off"
              onChange={(evento) => setSecret(evento.target.value)}
              placeholder={editando ? "Digite o valor de novo para substituir" : ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={linkId}>Link (opcional)</Label>
            <Input
              id={linkId}
              type="url"
              value={link}
              maxLength={500}
              onChange={(evento) => setLink(evento.target.value)}
              placeholder="https://painel.construtora.com.br"
              aria-invalid={!linkOk}
            />
            {!linkOk && (
              <p className="text-xs text-destructive">
                O link precisa começar com http:// ou https:// e não pode ter espaços.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={salvando} onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!podeSalvar}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
