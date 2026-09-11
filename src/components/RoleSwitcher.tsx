import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Shield, Eye } from "lucide-react";

const roleLabels: Record<AppRole, string> = {
  admin: 'Administrador',
  partner: 'Sócio',
  director: 'Diretor',
  manager: 'Gerente',
  broker: 'Corretor',
  cca: 'CCA',
  sdr: 'SDR',
  marketing: 'Marketing',
};

const roleColors: Record<AppRole, string> = {
  admin: 'text-destructive',
  partner: 'text-chart-5',
  director: 'text-info',
  manager: 'text-info',
  broker: 'text-success',
  cca: 'text-warning',
  sdr: 'text-success',
  marketing: 'text-chart-5',
};

const PREVIEW_OFF = '__me__';

/**
 * O limite da ferramenta, escrito onde o admin escolhe usá-la.
 *
 * Estava só no comentário do código: na tela, "Ver como Corretor" trazia a
 * interface do corretor com os DADOS do admin e nada dizia isso. Quem
 * conferisse números na prévia concluiria a coisa errada.
 */
const AVISO_PREVIA =
  'A prévia troca menus e botões. Os dados continuam sendo os seus: o banco responde pelos seus papéis reais.';

/**
 * O aviso precisa chegar a quem usa leitor de tela NO INSTANTE da escolha.
 *
 * O parágrafo dentro do `SelectContent` não serve para isso: o Radix põe
 * `role="listbox"` no próprio conteúdo, e dentro de um listbox o leitor de tela
 * só apresenta os filhos com `role="option"` — o texto era pulado. Por isso ele
 * vira `aria-describedby` do gatilho (anunciado junto com o nome do controle) e
 * a versão visual fica `aria-hidden`.
 *
 * Só o `describedby` ainda deixava um buraco: com a lista ABERTA, o Radix
 * chama `hideOthers()` e marca `aria-hidden` em tudo que está fora do popover
 * — inclusive no gatilho. Quem abre a lista e navega pelas opções sai do
 * alcance da descrição justamente enquanto escolhe. Daí o `aria-label` no
 * próprio listbox (`SelectContent`): é o nome que o leitor de tela anuncia ao
 * abrir, e ele carrega o limite junto.
 *
 * (Esse mesmo `aria-hidden` é o motivo de um teste de ponta a ponta não poder
 * procurar o gatilho por papel enquanto a lista está aberta: ele não está na
 * árvore de acessibilidade nesse instante.)
 */
const AVISO_ID = 'roleswitcher-aviso-previa';
const LISTA_LABEL = `Ver a tela como outro papel. ${AVISO_PREVIA}`;

/** Mesmo texto no gatilho e na lista — senão o rótulo do papel diverge do item marcado. */
const optionLabel = (r: AppRole, isMine: boolean) =>
  isMine ? `${roleLabels[r]} (você)` : `Ver como ${roleLabels[r]}`;

/**
 * Pré-visualização de papel — ferramenta de admin para conferir o que cada
 * perfil enxerga depois de mexer na matriz de permissões.
 *
 * Só afeta a interface: o RLS continua respondendo pelos papéis reais do
 * usuário, então uma tela pré-visualizada como "corretor" ainda traz os dados
 * do admin. Serve para validar menu e botões, não para auditar dados.
 *
 * O seletor lê `realRole`/`realRoles`, não `role`/`roles`: desde 05/09/2026 os
 * segundos são os EFETIVOS, e com eles o item "(você)" passaria a apontar para o
 * papel pré-visualizado — o admin em prévia de corretor veria "Corretor (você)"
 * e perderia o caminho de volta. Pela mesma razão o gate abaixo é
 * `realIsAdmin`, e não `isAdmin`: o efetivo fica falso durante a prévia e o
 * seletor sumiria da tela, trancando o admin dentro dela.
 */
export function RoleSwitcher() {
  const { realRole: role, realRoles: roles, realIsAdmin, previewRole, setPreviewRole } = useAuth();

  /**
   * Como a PESSOA se chama — que não é o mesmo que o papel de maior poder dela.
   *
   * Quem é sócio COM poder de administrador carrega {admin, partner}, e `admin`
   * tem precedência em `primaryRole` — precisa ter, porque `primaryRole`
   * espelha `auth_effective_role()` do banco nas travas de escrita. Sem esta
   * linha ele lia "Administrador (você)" no cabeçalho e o papel dele sumia da
   * tela.
   *
   * A mesma regra, para listas de gente, vive em `roleLabelFor`
   * (`integrations/supabase/permissions.ts`). Aqui ela é repetida em uma linha
   * de propósito: importar aquele módulo traria o cliente do Supabase para
   * dentro de um componente de cabeçalho e do teste dele.
   */
  const meuPapel: AppRole = roles.includes('partner') ? 'partner' : role;

  /**
   * Quem não é admin não troca de papel: veria um menu que não corresponde ao
   * que pode fazer. A trava real está no AuthContext; isto é a UI.
   *
   * `realIsAdmin` e não `isAdmin`: o segundo é o EFETIVO, e na prévia de
   * corretor ele fica falso — o seletor sumiria e quem está conferindo ficaria
   * sem caminho de volta. `realIsAdmin` é exatamente a resposta que
   * `setPreviewRole` usa para autorizar, então a tela oferece o que o contexto
   * libera, sem repetir a regra (sócio incluído desde 10/09/2026) aqui.
   */
  if (!realIsAdmin) {
    return (
      <div className="flex items-center gap-2">
        <Shield className={cn("h-3.5 w-3.5 shrink-0", roleColors[meuPapel])} />
        <span className="text-xs text-muted-foreground">{roleLabels[meuPapel]}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {previewRole
        ? <Eye className="h-3.5 w-3.5 shrink-0 text-warning" />
        : <Shield className={cn("h-3.5 w-3.5 shrink-0", roleColors[meuPapel])} />}
      <Select
        value={previewRole ?? PREVIEW_OFF}
        onValueChange={(v) => setPreviewRole(v === PREVIEW_OFF ? null : (v as AppRole))}
      >
        {/* A 375 px o gatilho encolhe para ícone + seta (~52 px em vez de 150).
            O que sai é o RÓTULO DO PAPEL, que é o último da fila de importância
            no cabeçalho — atrás do sino e do avatar. O `aria-label` continua
            nomeando o controle, então o encolhimento é só visual. */}
        <SelectTrigger
          className="h-7 w-auto gap-1 border-border/50 bg-transparent px-2 text-xs sm:w-36 sm:px-3"
          aria-label="Pré-visualizar como papel"
          aria-describedby={AVISO_ID}
        >
          <SelectValue>
            <span className={cn("hidden sm:inline", previewRole ? "text-warning" : roleColors[meuPapel])}>
              {previewRole ? optionLabel(previewRole, false) : optionLabel(meuPapel, true)}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent aria-label={LISTA_LABEL}>
          <p aria-hidden className="max-w-56 px-2 py-1.5 text-xs leading-snug text-muted-foreground">
            {AVISO_PREVIA}
          </p>
          <SelectItem value={PREVIEW_OFF} className="text-xs">
            <span className={roleColors[meuPapel]}>{optionLabel(meuPapel, true)}</span>
          </SelectItem>
          {(Object.keys(roleLabels) as AppRole[]).filter(r => r !== 'admin' && r !== meuPapel).map(r => (
            <SelectItem key={r} value={r} className="text-xs">
              <span className={roleColors[r]}>{optionLabel(r, false)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Este aviso NÃO some no estreito: saber que você está vendo a tela como
          outra pessoa importa mais no celular, não menos. Por isso ele é curto
          — cabe a 375 px sem empurrar o sino para fora. O texto inteiro fica no
          tooltip e, para leitor de tela, no `sr-only` ao lado. */}
      {/* `previewRole` sozinho: o `&& !isAdmin` de antes lia o isAdmin EFETIVO,
          que só ficava falso porque toda prévia derrubava o poder de admin.
          Desde 10/09/2026 o sócio TEM esse poder, então "Ver como Sócio"
          mantinha `isAdmin` verdadeiro e apagava o selo justamente na prévia
          que mais confunde — a que continua parecendo a tela do administrador.
          O aviso não depende do papel escolhido; depende de haver prévia. */}
      {previewRole && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" size="sm" className="shrink-0 border-warning/60 text-warning">
              prévia
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-xs">{AVISO_PREVIA}</TooltipContent>
        </Tooltip>
      )}
      {/* Sempre no DOM: `aria-describedby` só resolve para elemento existente,
          e o limite tem de ser anunciado ANTES da escolha, não depois. */}
      <span id={AVISO_ID} className="sr-only">{AVISO_PREVIA}</span>
    </div>
  );
}
