import { useId, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";
import { VARIAVEIS_DA_MENSAGEM, preencherMensagem, type MensagemPronta } from "./mensagensProntas";
import {
  useExcluirMensagemPronta, useMeuApelido, useSalvarMensagemPronta, type MensagemProntaRascunho,
} from "./mensagensProntasData";

const VAZIO: MensagemProntaRascunho = { titulo: "", texto: "", compartilhada: false };

/**
 * Criar, editar e excluir mensagens prontas, dentro do diálogo de WhatsApp.
 * Cada um mexe nas suas; as da equipe (compartilhadas) só admin e sócio — a
 * mesma regra da RLS da 0193, que é quem decide de verdade.
 */
export function MensagensProntasEditor({ mensagens, onFechar }: { mensagens: MensagemPronta[]; onFechar: () => void }) {
  const id = useId();
  const { user, isAdmin } = useAuth();
  const apelido = useMeuApelido();
  const salvar = useSalvarMensagemPronta();
  const excluir = useExcluirMensagemPronta();
  const [rascunho, setRascunho] = useState<MensagemProntaRascunho | null>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  const editavel = (m: MensagemPronta) => isAdmin || (m.dono === user?.id && !m.compartilhada);

  // Insere a variável onde está o cursor, não só no fim do texto.
  const inserir = (chave: string) => {
    if (!rascunho) return;
    const campo = textoRef.current;
    const inicio = campo?.selectionStart ?? rascunho.texto.length;
    const fim = campo?.selectionEnd ?? inicio;
    const texto = rascunho.texto.slice(0, inicio) + chave + rascunho.texto.slice(fim);
    setRascunho({ ...rascunho, texto });
    requestAnimationFrame(() => {
      campo?.focus();
      campo?.setSelectionRange(inicio + chave.length, inicio + chave.length);
    });
  };

  const gravar = () => {
    if (!rascunho) return;
    salvar.mutate(rascunho, {
      onSuccess: () => {
        toast({ title: rascunho.id ? "Mensagem atualizada" : "Mensagem criada" });
        setRascunho(null);
      },
      onError: (err) => toast({ variant: "destructive", title: "Não consegui salvar", description: describeError(err, "Tente de novo.") }),
    });
  };

  if (rascunho) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-titulo`}>Nome da mensagem</Label>
          <Input
            id={`${id}-titulo`} maxLength={80} value={rascunho.titulo} placeholder="Ex.: Primeiro contato"
            onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-texto`}>Texto</Label>
          <div className="flex flex-wrap gap-1.5">
            {VARIAVEIS_DA_MENSAGEM.map((v) => (
              <Button key={v.chave} type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => inserir(v.chave)}>
                + {v.rotulo}
              </Button>
            ))}
          </div>
          <Textarea
            id={`${id}-texto`} ref={textoRef} rows={5} maxLength={2000} value={rascunho.texto}
            placeholder="{saudacao}, {primeiro_nome}! Aqui é {corretor}, da Faceimob…"
            onChange={(e) => setRascunho({ ...rascunho, texto: e.target.value })}
          />
          {rascunho.texto.trim() && (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              Prévia: {preencherMensagem(rascunho.texto, { cliente: "Maria Souza", corretor: apelido })}
            </p>
          )}
        </div>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={rascunho.compartilhada}
              onCheckedChange={(v) => setRascunho({ ...rascunho, compartilhada: v === true })}
            />
            Mensagem da equipe (todos os corretores veem)
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setRascunho(null)}>Cancelar</Button>
          <Button type="button" disabled={salvar.isPending || !rascunho.titulo.trim() || !rascunho.texto.trim()} onClick={gravar}>
            Salvar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {mensagens.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma mensagem pronta ainda. Crie a primeira.</p>
      )}
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        {mensagens.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {m.titulo}
              {m.compartilhada && <span className="ml-1 text-xs text-muted-foreground">· equipe</span>}
            </span>
            {editavel(m) && (
              <>
                <Button
                  type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Editar ${m.titulo}`}
                  onClick={() => setRascunho({ id: m.id, titulo: m.titulo, texto: m.texto, compartilhada: m.compartilhada })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`Excluir ${m.titulo}`}
                  disabled={excluir.isPending}
                  onClick={() => excluir.mutate(m.id, {
                    onSuccess: () => toast({ title: "Mensagem excluída" }),
                    onError: (err) => toast({ variant: "destructive", title: "Não consegui excluir", description: describeError(err, "Tente de novo.") }),
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onFechar}>Voltar</Button>
        <Button type="button" size="sm" className="gap-1" onClick={() => setRascunho(VAZIO)}>
          <Plus className="h-4 w-4" /> Nova mensagem
        </Button>
      </div>
    </div>
  );
}
