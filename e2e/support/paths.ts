import type { RoleKey } from "./users";

/** Onde fica a sessão salva de cada papel. Diretório ignorado pelo git. */
export const statePathFor = (key: RoleKey | string) => `e2e/.auth/${key}.json`;
