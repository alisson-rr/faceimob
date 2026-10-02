export type MetaPageCredential = {
  pageId: string | null;
  name: string | null;
  token: string;
};

type StoredPage = {
  page_id?: unknown;
  pageId?: unknown;
  name?: unknown;
  access_token?: unknown;
  token?: unknown;
};

/**
 * Formato do cofre: [{"page_id":"123","name":"Faceimob","access_token":"..."}].
 * Também aceita {"pages":[...]} para facilitar exportação de ferramentas.
 * Valor inválido nunca é logado: ele contém credenciais.
 */
export function parseMetaPageCredentials(value: string | null): MetaPageCredential[] {
  if (!value) return [];
  try {
    const decoded: unknown = JSON.parse(value);
    const rows = Array.isArray(decoded)
      ? decoded
      : Array.isArray((decoded as { pages?: unknown } | null)?.pages)
        ? (decoded as { pages: unknown[] }).pages
        : [];
    const seen = new Set<string>();
    return rows.flatMap((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const row = raw as StoredPage;
      const pageIdRaw = row.page_id ?? row.pageId;
      const tokenRaw = row.access_token ?? row.token;
      const pageId = typeof pageIdRaw === "string" ? pageIdRaw.trim() : "";
      const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
      if (!/^\d{5,30}$/.test(pageId) || token.length < 20 || seen.has(pageId)) return [];
      seen.add(pageId);
      return [{
        pageId,
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
        token,
      }];
    });
  } catch {
    return [];
  }
}

/** Escolhe sempre pelo id do evento; o token legado só é fallback. */
export function tokenForMetaPage(credentials: MetaPageCredential[], pageId: string | null): string | null {
  if (pageId) {
    const exact = credentials.find((item) => item.pageId === pageId);
    if (exact) return exact.token;
  }
  const legacy = credentials.find((item) => item.pageId === null);
  if (legacy) return legacy.token;
  return credentials.length === 1 ? credentials[0].token : null;
}
