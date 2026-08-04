import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Slug para colunas `slug` NOT NULL (`teams`, `distribution_groups`, …).
 *
 * Espelha o `slugify` do banco. Existe porque vários inserts esqueciam a coluna
 * e o banco recusava — erro que ficava invisível enquanto o typecheck do
 * projeto não olhava arquivo nenhum.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
