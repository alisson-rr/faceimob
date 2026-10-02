import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/functionError";
import { describeError } from "@/lib/supabaseError";

/**
 * "Diagnosticar e conectar" os leads da Meta (pedido de 29/09/2026: "inseri
 * todas as chaves e tirei a pausa, e os leads não chegam").
 *
 * A edge `meta-ads-connect` confere a corrente inteira — pausa, cofre, token da
 * página, página assinada no app com `leadgen`, última chamada ao webhook — e,
 * quando a página não está assinada, faz a assinatura num clique. A tela só
 * mostra o veredito: nenhum valor de credencial passa por aqui.
 */

type Checagem = { id: string; titulo: string; ok: boolean | null; detalhe: string };
type Diagnostico = {
  ok: true;
  pagina: { id: string; name: string | null } | null;
  paginas?: Array<{ id: string; name: string | null; assinada: boolean; erro?: string }>;
  podeAssinar: boolean;
  checagens: Checagem[];
};

async function chamar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("meta-ads-connect", { body });
  if (error) throw new Error(await functionErrorMessage(error, "Não foi possível falar com a Meta."));
  if (!data) throw new Error("O diagnóstico respondeu sem conteúdo.");
  return data;
}

const SELO = {
  ok: { tone: "success", texto: "OK" },
  falha: { tone: "danger", texto: "Resolver" },
  info: { tone: "neutral", texto: "Info" },
} as const;

export function MetaLeadsDiagnosticoCard() {
  const { can } = useAuth();
  const podeUsar = can("settings.integrations");

  const diagnostico = useMutation({
    mutationFn: () => chamar<Diagnostico>({ action: "diagnosticar_leads" }),
    onError: (e) => toast.error("Diagnóstico falhou", { description: describeError(e, "Tente de novo em instantes.") }),
  });

  const assinar = useMutation({
    mutationFn: () => chamar<{ ok: true; pagina?: { name: string | null }; paginas?: Array<{ name: string | null }> }>({ action: "assinar_pagina" }),
    onSuccess: (r) => {
      toast.success(`${r.paginas?.length ?? (r.pagina ? 1 : 0)} página(s) assinada(s) para receber leads`);
      diagnostico.mutate();
    },
    onError: (e) => toast.error("Não foi possível assinar a página", { description: describeError(e, "Tente de novo em instantes.") }),
  });

  const resultado = diagnostico.data;
  const pageTokenFailed = resultado?.checagens.find((item) => item.id === "page_token")?.ok === false;
  const verifyMismatch = resultado?.checagens.find((item) => item.id === "ultima_chamada")?.detalhe
    .includes("token de verificação") ?? false;

  return (
    <SectionCard
      title="Diagnóstico dos leads"
      icon={Stethoscope}
      description="Confere, na Meta e aqui, cada elo que traz o lead do formulário até a roleta."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => diagnostico.mutate()}
            disabled={!podeUsar || diagnostico.isPending}
          >
            {diagnostico.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Diagnosticar
          </Button>
          {resultado?.podeAssinar && (
            <Button
              type="button"
              variant="outline"
              onClick={() => assinar.mutate()}
              disabled={!podeUsar || assinar.isPending}
            >
              {assinar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Assinar páginas pendentes
            </Button>
          )}
        </div>
        {!podeUsar && (
          <p role="status" className="text-xs text-warning">
            Sem a permissão &quot;Gerenciar integrações&quot;: o diagnóstico é de quem administra o cofre.
          </p>
        )}

        {resultado && (resultado.paginas?.length ?? 0) > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Páginas de Lead Ads configuradas">
            {resultado.paginas!.map((pagina) => (
              <li key={pagina.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{pagina.name || `Página ${pagina.id}`}</span>
                <StatusBadge tone={pagina.assinada ? "success" : "warning"}>
                  {pagina.assinada ? "Recebendo" : pagina.erro ? "Erro" : "Assinar"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}

        {resultado && (
          <ul className="divide-y divide-border" aria-label="Resultado do diagnóstico">
            {resultado.checagens.map((c) => {
              const selo = c.ok === null ? SELO.info : c.ok ? SELO.ok : SELO.falha;
              return (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.titulo}</p>
                    <p className="text-sm text-muted-foreground">{c.detalhe}</p>
                  </div>
                  <StatusBadge tone={selo.tone}>{selo.texto}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}

        {(pageTokenFailed || verifyMismatch) && (
          <div className="rounded-xl border border-warning/45 bg-warning/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden /> São duas credenciais diferentes
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              {pageTokenFailed && (
                <li>
                  Gere um <strong className="text-foreground">token permanente de usuário de sistema</strong> com
                  <code className="mx-1">leads_retrieval</code> e <code>pages_manage_metadata</code>, atribua as
                  Páginas ao usuário e salve cada uma com seu <code className="mx-1">page_id</code> no cofre acima.
                </li>
              )}
              {verifyMismatch && (
                <li>
                  O <strong className="text-foreground">Verify Token</strong> não é o token da Página. Em
                  Webhooks → Page, use exatamente o valor gerado nesta tela e clique em “Verificar e salvar”.
                </li>
              )}
              <li>
                Rode “Diagnosticar” novamente. Quando o acesso às Páginas estiver válido, esta tela libera o botão
                “Assinar páginas pendentes”.
              </li>
            </ol>
            <Button asChild type="button" size="sm" variant="outline" className="mt-3">
              <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">
                Abrir gerador da Meta <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Não envie o token por mensagem: cole-o diretamente no cofre desta tela.
            </p>
          </div>
        )}

        {resultado && (
          <p className="text-xs text-muted-foreground">
            Tudo OK e o lead ainda não chega? Confira na Meta: o app em modo <strong>Ativo</strong> (em
            Desenvolvimento só chegam leads de quem tem papel no app), o campo <strong>leadgen</strong> marcado em
            Webhooks → Page, e o app liberado no <strong>Gerenciador de Acesso a Leads</strong> da página. Teste com a
            Ferramenta de Teste de Anúncios de Cadastro da Meta e rode o diagnóstico de novo.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
