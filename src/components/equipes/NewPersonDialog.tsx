import { useId, useState, type FormEvent } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage, suggestEmail } from "@/integrations/supabase/people";
import { functionErrorMessage } from "@/lib/functionError";

export type CreatedPerson = {
  id: string;
  full_name: string;
  email: string;
  /**
   * `true` = a pessoa JÁ existia (409 com `existing_profile_id`), o cadastro só
   * abriu a ficha dela. Quem recebe o callback não pode tratar os dois casos
   * igual: para quem já existe, status, equipe e e-mail confirmado vêm do
   * banco, não do que acabou de ser digitado aqui.
   */
  existing?: boolean;
};

/**
 * Cadastro de colaborador — a porta de entrada de gente no CRM pela tela.
 *
 * Criar usuário exige a service role, que não pode sair do navegador: quem cria
 * é a edge function `provision-broker-user` (ela confere sozinha se o chamador
 * é admin). Sem `profile_id` no corpo, ela cai no ramo de criação; o trigger
 * `on_auth_user_created` grava o perfil e o papel 'broker'. Função definitiva,
 * equipe e ficha ficam para o modal de edição, que já existe.
 *
 * Não há senha para entregar: o login é por código enviado ao e-mail.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Corpo JSON de uma resposta não-2xx da edge function.
 *
 * O SDK transforma 4xx em `error` e esconde o corpo em `error.context`; sem
 * abrir esse corpo o 409 com `existing_profile_id` (o caminho de recuperação do
 * cadastro duplicado) nunca chegaria à tela.
 */
async function bodyOfFunctionError(error: unknown) {
  const contexto = (error as { context?: Response }).context;
  try {
    return await contexto?.clone().json() as
      { existing_profile_id?: string; existing_full_name?: string; error?: string } | undefined;
  } catch {
    return undefined;
  }
}

export function NewPersonDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (person: CreatedPerson) => void;
}) {
  const nameId = useId();
  const emailId = useId();
  const emailErrorId = useId();
  const [name, setName] = useState("");
  // `null` = ninguém digitou ainda, então o e-mail segue o nome. Derivar na
  // renderização evita sincronizar dois estados com efeito.
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const email = typedEmail ?? suggestEmail(name);
  const emailValid = EMAIL_RE.test(email.trim());
  const canSave = name.trim().length > 0 && emailValid && !saving;

  const reset = () => { setName(""); setTypedEmail(null); };

  const change = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    const endereco = email.trim().toLowerCase();
    try {
      const { data, error } = await supabase.functions.invoke<{
        user_id?: string;
        email?: string;
        error?: string;
        login_ready?: boolean;
        existing_profile_id?: string;
        existing_full_name?: string;
      }>("provision-broker-user", { body: { email: endereco, full_name: name.trim() } });

      // A mensagem útil vem no corpo da resposta, não no `error.message`.
      const corpo = data ?? (error
        ? await bodyOfFunctionError(error)
        : null);

      // E-MAIL JÁ EM USO — inclusive a retentativa de uma chamada cuja resposta
      // se perdeu por timeout. Antes o diálogo só dizia "já existe" e não havia
      // caminho nenhum: a pessoa recém-criada só era alcançável pelo lápis na
      // coluna Corretores. Agora a ficha dela abre daqui mesmo.
      if (corpo?.existing_profile_id) {
        const jaExiste: CreatedPerson = {
          id: corpo.existing_profile_id,
          full_name: corpo.existing_full_name ?? name.trim(),
          email: endereco,
          existing: true,
        };
        reset();
        toast({
          title: "Já existe um acesso com esse e-mail",
          description: `Abrindo a ficha de ${jaExiste.full_name} para você concluir o cadastro.`,
        });
        onCreated(jaExiste);
        return;
      }

      if (error) throw new Error(authErrorMessage(await functionErrorMessage(error, "Não foi possível cadastrar o colaborador.")));
      if (data?.error) throw new Error(authErrorMessage(data.error));
      if (!data?.user_id) throw new Error("A função não devolveu o colaborador criado.");

      const person = { id: data.user_id, full_name: name.trim(), email: data.email ?? endereco };
      reset();
      toast({
        title: "Colaborador cadastrado",
        // Só `true` explícito promete o código: campo ausente (função antiga
        // no ar) tem de cair no aviso, nunca no silêncio otimista.
        description: data.login_ready === true
          ? "Defina função e equipe na ficha que abriu."
          : "Defina função e equipe na ficha que abriu. Atenção: o código de login ainda não é enviado — falta configurar o SMTP.",
      });
      onCreated(person);
    } catch (error: unknown) {
      toast({
        title: "Falha ao cadastrar",
        description: error instanceof Error ? error.message : "Não foi possível cadastrar o colaborador.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Novo colaborador
          </DialogTitle>
          <DialogDescription className="text-xs">
            Cria o acesso e o perfil. A pessoa entra em /login com esse e-mail e recebe um código —
            não há senha para repassar. Função e equipe você define na ficha, logo em seguida.
          </DialogDescription>
        </DialogHeader>

        {/* Credencial de terceiro que ainda falta: dizer antes é melhor do que
            entregar uma conta que não entra e descobrir depois. */}
        <p className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-xs text-warning">
          O envio do código de 6 dígitos depende do SMTP (Brevo) configurado em
          Authentication → Emails e do template de Magic Link aplicado no projeto.
          Enquanto isso não estiver feito, a conta é criada mas o colaborador não recebe o código.
        </p>

        <form onSubmit={submit} aria-label="Novo colaborador" className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={nameId} className="text-xs">Nome completo</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="Maria Souza"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={emailId} className="text-xs">E-mail de acesso</Label>
            <Input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setTypedEmail(e.target.value)}
              autoComplete="off"
              aria-invalid={email.trim() !== "" && !emailValid}
              aria-describedby={emailErrorId}
            />
            <p id={emailErrorId} className="text-xs text-muted-foreground">
              {email.trim() !== "" && !emailValid
                ? "Informe um e-mail válido"
                : "Sugerido a partir do nome; troque se o endereço for outro."}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => change(false)}>Cancelar</Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
