import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, StatusBadge } from "@/components/shared";
import { describeError } from "@/lib/supabaseError";
import { dateTime } from "@/lib/format";
import { SITUACAO_CONTATO, type RemarketingContact } from "./types";

/**
 * Contatos de uma lista de remarketing, com o motivo da falha de cada um.
 *
 * O toast do disparo prometia que "o motivo ficou gravado nele" e não havia
 * onde ler: `remarketing_contacts.last_error` só existia no banco. Sem esta
 * tabela, um lote inteiro em 'failed' virava um número na tela e o operador não
 * tinha como distinguir "template não aprovado na Meta" de "número inválido" —
 * a diferença entre reeditar o template e limpar a planilha.
 *
 * A RLS (`remarketing_contacts_all`) já libera admin/marketing/sdr, que são
 * exatamente os papéis que veem esta aba: não é preciso RPC.
 */

/** Teto por consulta. Lista de dezenas de milhares não cabe numa tabela sem
 *  paginação, e o caso que importa (ver por que falhou) fica nas primeiras
 *  linhas porque a ordenação põe 'failed' na frente. */
const LIMITE = 200;

const TODOS = "__todos__";

export function ListContacts({ listId, total }: { listId: string; total: number }) {
  const [rows, setRows] = useState<RemarketingContact[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<string>(TODOS);

  useEffect(() => {
    let cancelado = false;
    setRows(null);
    setErro(null);
    let q = supabase
      .from("remarketing_contacts")
      .select("id,full_name,phone,status,sent_at,replied_at,last_error")
      .eq("list_id", listId);
    if (situacao !== TODOS) q = q.eq("status", situacao);
    // 'failed' primeiro: é a única situação que exige uma decisão de quem olha.
    void q.order("last_error", { ascending: false, nullsFirst: false })
      .order("created_at")
      .limit(LIMITE)
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) { setErro(describeError(error, "Não foi possível carregar os contatos desta lista.")); setRows([]); return; }
        setRows((data ?? []) as RemarketingContact[]);
      });
    return () => { cancelado = true; };
  }, [listId, situacao]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="h-8 w-56" aria-label="Filtrar contatos por situação"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as situações</SelectItem>
            {Object.entries(SITUACAO_CONTATO).map(([valor, s]) => (
              <SelectItem key={valor} value={valor}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {total} contato(s) na lista.
          {rows && rows.length === LIMITE && ` Mostrando os ${LIMITE} primeiros — filtre pela situação para ver o resto.`}
        </p>
      </div>

      {rows === null && <LoadingState variant="table" rows={3} label="Carregando contatos…" />}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
      {rows && !erro && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {situacao === TODOS ? "Esta lista não tem contatos." : "Nenhum contato nessa situação."}
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <caption className="sr-only">Contatos da lista de remarketing e o motivo de cada falha</caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="p-2 text-left font-medium">Contato</th>
                <th scope="col" className="p-2 text-left font-medium">Telefone</th>
                <th scope="col" className="p-2 text-left font-medium">Situação</th>
                <th scope="col" className="p-2 text-left font-medium">Quando</th>
                <th scope="col" className="p-2 text-left font-medium">Motivo da falha</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const s = SITUACAO_CONTATO[c.status] ?? { label: c.status, tone: "neutral" as const };
                return (
                  <tr key={c.id} className="border-b border-border/40 align-top">
                    <td className="p-2">{c.full_name || "—"}</td>
                    <td className="p-2 font-mono">{c.phone || "—"}</td>
                    <td className="p-2"><StatusBadge tone={s.tone}>{s.label}</StatusBadge></td>
                    <td className="p-2 whitespace-nowrap">{dateTime(c.replied_at ?? c.sent_at)}</td>
                    {/* O erro vem da Graph API como JSON: quebrar a palavra
                        evita que uma linha só estoure a largura em 375 px. */}
                    <td className="p-2 break-all text-muted-foreground">{c.last_error || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Botão que abre/fecha a tabela acima. Fica aqui para o rótulo e o
 *  `aria-expanded` não se separarem do painel que eles controlam. */
export function ToggleContatos({ aberto, onToggle, nome }: { aberto: boolean; onToggle: () => void; nome: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      aria-expanded={aberto}
      onClick={onToggle}
    >
      {aberto ? "Ocultar contatos" : "Ver contatos"}
      <span className="sr-only"> da lista {nome}</span>
    </Button>
  );
}
