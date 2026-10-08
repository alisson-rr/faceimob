import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Campos do formulário de negócio.
 *
 * Cada um recebe o `id` de fora (o `useId` do modal) para que `<Label htmlFor>`
 * aponte para o campo de verdade — eram ~30 rótulos soltos, que o leitor de
 * tela não ligava a campo nenhum (achado X04).
 *
 * A grade é `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`: o `grid-cols-3` fixo
 * dava ~100 px por coluna a 375 px (achado X08).
 *
 * `className` recebe a cor do bloco (`deal-tone-*`, `deal-field-light` — ver
 * `index.css`).
 */
export function Section({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <fieldset className={cn("border-t border-border pt-3", className)}>
      <legend className="text-eyebrow mb-2">{title}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function TextField({ id, label, value, onChange, type, onBlur, inputMode, maxLength, error }: {
  id: string; label: string; value?: string; type?: string; onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  inputMode?: "text" | "numeric" | "tel" | "email";
  maxLength?: number;
  error?: string | null;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-eyebrow">{label}</Label>
      <Input
        id={id} type={type} value={value ?? ""} className="mt-1 text-xs"
        inputMode={inputMode} maxLength={maxLength}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur ? (event) => onBlur(event.target.value) : undefined}
      />
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Valor em R$ com máscara (pedido de 28/09/2026): quem digita "123456" vê
 * "R$ 1.234,56" — os dígitos entram pelos centavos, como na maquininha. Não
 * existe texto intermediário inválido para o banco recusar depois, e o valor
 * que sobe é sempre número. Vazio = 0, com o placeholder "R$ 0,00".
 */
export function MoneyField({ id, label, value, onChange, disabled, hint }: {
  id: string; label: string; value?: number | null; onChange: (value: number) => void;
  disabled?: boolean;
  /** Por que o campo está travado; ligado ao campo por `aria-describedby`. */
  hint?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-eyebrow">{label}</Label>
      <Input
        id={id} inputMode="numeric" className="mt-1 text-xs tabular-nums" placeholder="R$ 0,00"
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={value ? brl(value, { cents: true }) : ""}
        onChange={(event) => {
          // 13 dígitos = R$ 99 bilhões: acima disso o `number` perde centavo.
          const digitos = event.target.value.replace(/\D/g, "").slice(0, 13);
          onChange(digitos ? Number(digitos) / 100 : 0);
        }}
      />
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ChoiceField({ id, label, value, onChange, options }: {
  id: string; label: string; value?: string; options: string[]; onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-eyebrow">{label}</Label>
      <Select value={value || options[0]} onValueChange={onChange}>
        <SelectTrigger id={id} className="mt-1 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

const NONE = "none";

/**
 * Participante do negócio. O VALOR é o `id` do perfil (achado F06) — o Select
 * gravava o NOME e a persistência reencontrava a pessoa por `find(p.name)`:
 * homônimos colidiam e renomear o perfil trocava o dono do rateio de VGV.
 *
 * `fallbackName` cobre o caso real do RLS: o corretor não enxerga o perfil do
 * gerente, então o gerente do negócio não está em `options`. Sem esta entrada o
 * Select abriria vazio e o primeiro salvamento tiraria o gerente do negócio —
 * junto com o acesso dele.
 */
export function PersonField({ id, label, value, fallbackName, options, onChange, optional, hint }: {
  id: string;
  label: string;
  value?: string | null;
  fallbackName?: string;
  /** `{ id, name }` e não `PersonRecord`: a lista de corretores selecionáveis
   *  vem de uma RPC `security definer` que devolve só id e nome (a RLS de
   *  `profiles` esconde o resto), e o Select nunca usou mais do que isso. */
  options: { id: string; name: string }[];
  onChange: (value: string | null) => void;
  optional?: boolean;
  /** Texto curto ao lado do rótulo — hoje o rateio de VGV do participante. */
  hint?: string;
}) {
  const outsideCatalog = Boolean(value) && !options.some((person) => person.id === value);
  const hintId = `${id}-hint`;
  return (
    <div>
      {/* O rateio fica FORA do `<label>`, como descrição.
          Dentro dele o nome acessível do campo virava "Corretor 1 *50% do VGV"
          e mudava sozinho a cada corretor que entra ou sai do negócio: o campo
          deixava de ser alcançável pelo próprio rótulo ("Corretor 1 *") e quem
          usa leitor de tela ouvia um número no lugar do nome. Percentual é
          informação SOBRE o campo — `aria-describedby` é onde ela cabe. */}
      <div className="flex flex-wrap items-baseline gap-1">
        <Label htmlFor={id} className="text-eyebrow">{label}</Label>
        {/* `text-xs` (12 px) e não só `normal-case`: a exceção do piso
            tipográfico é a FORMA — caixa alta com `tracking >= 0.1em` —, e não
            o número. Tirando a caixa alta de `.text-eyebrow` sobrava texto
            corrido de 11 px, abaixo do piso, sem que `type-scale.test.ts`
            reprovasse (ele varre literais `text-[Npx]`, não classe que anula a
            condição da exceção). A 12 px a exceção deixa de ser necessária,
            como o próprio comentário do `index.css` recomenda. */}
        {hint && (
          <span id={hintId} className="text-xs font-normal normal-case tracking-normal text-primary">
            {hint}
          </span>
        )}
      </div>
      <Select
        value={value || (optional ? NONE : "")}
        onValueChange={(next) => onChange(next === NONE ? null : next)}
      >
        <SelectTrigger id={id} aria-describedby={hint ? hintId : undefined} className="mt-1 text-xs">
          <SelectValue placeholder={optional ? "Nenhum" : "Escolher"} />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {optional && <SelectItem value={NONE}>Nenhum</SelectItem>}
          {outsideCatalog && value && (
            <SelectItem value={value}>{fallbackName || "Fora da sua visibilidade"}</SelectItem>
          )}
          {options.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
