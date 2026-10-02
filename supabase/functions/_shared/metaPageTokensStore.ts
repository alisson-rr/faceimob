import { getSecret } from "./secrets.ts";
import { parseMetaPageCredentials, type MetaPageCredential } from "./metaPageTokens.ts";

export async function getMetaPageCredentials(): Promise<MetaPageCredential[]> {
  const [bundle, legacy] = await Promise.all([
    getSecret("META_PAGE_ACCESS_TOKENS_JSON"),
    getSecret("META_PAGE_ACCESS_TOKEN"),
  ]);
  const credentials = parseMetaPageCredentials(bundle);
  // O pacote é autoritativo: quando existe, não mistura um token legado
  // (que pode ter expirado) e não duplica a página principal.
  if (!credentials.length && legacy) {
    credentials.push({ pageId: null, name: null, token: legacy });
  }
  return credentials;
}
