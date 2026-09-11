import { useEffect, useId, useState, type FormEvent } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SectionCard } from "@/components/shared";
import { useToast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import {
  SENHA_MAX, SENHA_MIN, definirSenhaDeAcesso, listarPessoasComAcesso,
  type PessoaComAcesso,
} from "@/integrations/supabase/cofre";

/**
 * Definir a senha de acesso de um colaborador.
 *
 * A FRASE QUE PRECISA ESTAR NA TELA, e por isso ela aparece antes do
 * formulário: o Supabase Auth guarda HASH. A senha que a pessoa usa hoje não
 * pode ser lida por ninguém, nem pelo dono do banco. O que acontece aqui é
 * outra coisa — o administrador DEFINE uma senha nova, ela passa a valer no
 * login e fica guardada no cofre para consulta. Sem esse aviso, alguém abre a
 * tela achando que está vendo a senha antiga.
 *
 * O valor é mostrado uma vez, aqui, logo depois de definir: é o único momento
 * em que ele existe na tela sem passar pelo botão "revelar" (que audita). Nos
 * acessos seguintes ele sai da lista do cofre, com registro de quem viu.
 */
export function DefinirSenhaCard({ onDefinida }: { onDefinida: () => void }) {
  const { toast } = useToast();
  const pessoaId = useId();
  const senhaId = useId();
  const avisoId = useId();

  const [pessoas, setPessoas] = useState<PessoaComAcesso[]>([]);
  const [erroPessoas, setErroPessoas] = useState<string | null>(null);
  const [alvo, setAlvo] = useState("");
  const [senha, setSenha] = useState("");
  const [salvando, setSalvando] = useState(false);
  // A senha recém-definida, mostrada uma vez. Sai da tela ao definir outra.
  const [recemDefinida, setRecemDefinida] = useState<{ nome: string; valor: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    listarPessoasComAcesso().then(
      (linhas) => { if (ativo) { setPessoas(linhas); setErroPessoas(null); } },
      (erro: unknown) => {
        if (ativo) setErroPessoas(describeError(erro, "Não foi possível listar os colaboradores."));
      },
    );
    return () => { ativo = false; };
  }, []);

  // Bytes, e não `length`: o limite é do bcrypt do Auth e um acento ocupa dois.
  // A mesma conta roda no servidor — esta aqui só evita a ida e volta.
  const bytes = new TextEncoder().encode(senha).length;
  const senhaOk = bytes >= SENHA_MIN && bytes <= SENHA_MAX;
  const podeSalvar = !!alvo && senhaOk && !salvando;

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      const { guardadaNoCofre } = await definirSenhaDeAcesso(alvo, senha);
      const nome = pessoas.find((p) => p.id === alvo)?.full_name ?? "colaborador";
      setRecemDefinida({ nome, valor: senha });
      setSenha("");
      toast({
        title: "Senha definida",
        description: guardadaNoCofre
          ? `${nome} já entra com a senha nova, e ela fica consultável no cofre.`
          : `${nome} já entra com a senha nova, mas ela NÃO foi guardada no cofre. Anote agora: ela não aparecerá na lista.`,
        variant: guardadaNoCofre ? "success" : "destructive",
      });
      onDefinida();
    } catch (erro: unknown) {
      toast({
        variant: "destructive",
        title: "Não foi possível definir a senha",
        description: describeError(
          erro,
          erro instanceof Error ? erro.message : "Falha ao definir a senha de acesso.",
        ),
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <SectionCard
      title="Definir senha de acesso"
      description="Para o corretor que perdeu a senha ou nunca definiu uma."
      icon={KeyRound}
    >
      <p
        id={avisoId}
        className="mb-4 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <span>
          <strong>Isto define uma senha NOVA.</strong> A senha que a pessoa usa hoje não pode ser
          lida por ninguém — o sistema de login guarda só um resumo cifrado dela. Depois de definir
          aqui, a senha nova passa a valer no login e fica consultável no cofre abaixo.
        </span>
      </p>

      <form onSubmit={submeter} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor={pessoaId}>Colaborador</Label>
          <Select value={alvo} onValueChange={setAlvo}>
            <SelectTrigger id={pessoaId} aria-describedby={avisoId}>
              <SelectValue placeholder="Escolha quem recebe a senha" />
            </SelectTrigger>
            <SelectContent>
              {pessoas.map((pessoa) => (
                <SelectItem key={pessoa.id} value={pessoa.id}>
                  {pessoa.full_name}{pessoa.email ? ` · ${pessoa.email}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {erroPessoas && <p className="text-xs text-destructive">{erroPessoas}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={senhaId}>Senha nova</Label>
          <Input
            id={senhaId}
            type="text"
            autoComplete="off"
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
            placeholder={`De ${SENHA_MIN} a ${SENHA_MAX} caracteres`}
            aria-invalid={senha.length > 0 && !senhaOk}
          />
        </div>

        <Button type="submit" disabled={!podeSalvar}>
          {salvando ? "Definindo…" : "Definir senha"}
        </Button>
      </form>

      {recemDefinida && (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
          Senha de <strong>{recemDefinida.nome}</strong>:{" "}
          <code className="select-all font-mono text-sm">{recemDefinida.valor}</code>
          <span className="block text-muted-foreground">
            Some daqui quando você sair da tela. Depois disso, use "Revelar" na lista do cofre —
            e a consulta fica registrada.
          </span>
        </p>
      )}
    </SectionCard>
  );
}
