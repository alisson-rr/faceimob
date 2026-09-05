import { test, expect, aguardarCarregamento } from "../support/fixtures";
import { resolveTarget } from "../support/target";
import { mintSession } from "../support/session";
import { E2E_USERS } from "../support/users";

/**
 * Admin > Meta Ads: o que a tela mostra tem de bater com o cofre.
 *
 * O cofre (`private.integration_credentials`) não é exposto pelo PostgREST e
 * não existe RPC de remoção, então o estado inicial NÃO é montado pelo teste:
 * o primeiro caso lê o cofre pela mesma `list_integrations()` da tela e
 * confere que o badge diz o que o banco diz — em qualquer estado. O segundo
 * exercita o caminho de escrita ("Gerar e salvar" / "Gerar novo") e confere
 * pela RPC que o token entrou, com `updated_at` recente.
 *
 * O caso de escrita não roda no alvo remoto: rotacionar o Verify Token da
 * homologação invalidaria o valor que o cliente colou no painel da Meta.
 */
const REMOTO = resolveTarget().name === "remote";

type Integracao = { provider: string; label: string; has_secret: boolean; updated_at: string | null };

/**
 * `list_integrations()` exige `is_admin()`, que olha `auth.uid()` — a
 * service_role não passa. Vai com o JWT do admin E2E, o mesmo que a tela usa.
 */
async function cofreComoAdmin(): Promise<Integracao[]> {
  const t = resolveTarget();
  const { access_token } = await mintSession(E2E_USERS.find((u) => u.key === "admin")!.email);
  const res = await fetch(`${t.supabaseUrl}/rest/v1/rpc/list_integrations`, {
    method: "POST",
    headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`list_integrations → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const slot = (linhas: Integracao[], label: string) =>
  linhas.find((r) => r.provider === "meta" && r.label === label);
const configurado = (linhas: Integracao[], label: string) => !!slot(linhas, label)?.has_secret;

test("o badge do topo diz a verdade sobre o cofre", async ({ page }) => {
  const cofre = await cofreComoAdmin();
  const pronto = configurado(cofre, "page_access_token") && configurado(cofre, "webhook_verify_token");

  await page.goto("/admin/meta-ads");
  await aguardarCarregamento(page);

  await expect(page.getByRole("heading", { name: "Configuração do Meta Ads", level: 1 })).toBeVisible();
  await expect(page.getByText(pronto ? "Webhook pronto" : "Falta credencial")).toBeVisible();
  if (!pronto) {
    // O aviso deixou de mandar o admin para outra tela no meio do passo a
    // passo: as credenciais que faltam têm campo aqui embaixo. Mandar embora
    // era o que quebrava o fluxo — o link continua no rodapé do card, para
    // quem quer o cofre inteiro (teste de conexão e revogação).
    const aviso = page.getByRole("status").filter({ hasText: "O webhook ainda não valida" });
    await expect(aviso).toContainText(/não é preciso sair daqui/i);
    await expect(aviso.getByRole("link")).toHaveCount(0);
  }

  await expect(page.getByLabel("Callback URL", { exact: true })).toHaveValue(/\/functions\/v1\/meta-ads-webhook$/);
  // O token fixo do bundle antigo não pode voltar a aparecer.
  await expect(page.getByText("faceimob_meta_verify")).toHaveCount(0);
});

test("gerar o Verify Token grava no cofre e some da tela ao recarregar", async ({ page }) => {
  test.skip(REMOTO, "rotaciona o token da Meta: no remoto invalidaria o valor colado no painel da Meta");

  const jaTinha = configurado(await cofreComoAdmin(), "webhook_verify_token");
  const inicio = Date.now();

  await page.goto("/admin/meta-ads");
  await aguardarCarregamento(page);

  if (jaTinha) {
    await page.getByRole("button", { name: "Gerar novo" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Gerar novo" }).click();
  } else {
    await page.getByRole("button", { name: "Gerar e salvar" }).click();
  }

  const campo = page.getByLabel("Verify Token", { exact: true });
  await expect(campo).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
  // Texto exato: o toast do sonner também diz "Copie agora" e fica uns 4 s na tela.
  await expect(page.getByText("Copie agora: ele não será mostrado de novo.")).toBeVisible();

  await expect(async () => {
    const depois = slot(await cofreComoAdmin(), "webhook_verify_token");
    expect(depois?.has_secret).toBe(true);
    // Tolerância de um minuto: relógio do banco e da máquina não são o mesmo.
    expect(new Date(depois!.updated_at!).getTime()).toBeGreaterThanOrEqual(inicio - 60_000);
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await aguardarCarregamento(page);
  await expect(page.getByText(/definido em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await expect(page.getByLabel("Verify Token", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar novo" })).toBeVisible();
});

/**
 * "Testar Callback URL": a tela era só instrução — não havia como saber se a
 * Meta consegue alcançar a function antes de tentar a verificação no painel
 * dela. O teste faz o mesmo handshake GET que a Meta faz.
 *
 * Sem token gerado nesta sessão o botão manda um valor de teste, e o 403 é o
 * desfecho correto: prova que a URL está publicada e recusando token errado.
 * O 403 aparece como erro de rede no console — é a prova, não um defeito.
 */
test.describe(() => {
  test.use({ errosEsperados: [/status of 403/i] });

  test("o teste da Callback URL diz se a function responde", async ({ page }) => {
    await page.goto("/admin/meta-ads");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: "Testar Callback URL" }).click();

    const resultado = page.getByRole("status").filter({ hasText: /URL/ });
    await expect(resultado).toBeVisible({ timeout: 20_000 });
    await expect(
      resultado,
      "sem alcançar a function o admin não sabe se pode verificar no painel da Meta",
    ).toContainText(/A URL está no ar|A Meta consegue verificar/);
  });
});

// O SDR só responde ao lead se o webhook de mensagens também estiver assinado,
// no mesmo app da Meta. A tela precisa entregar essa URL.
test("a tela entrega também a URL do webhook de mensagens do WhatsApp", async ({ page }) => {
  await page.goto("/admin/meta-ads");
  await aguardarCarregamento(page);

  await expect(page.getByLabel("Callback URL (mensagens do WhatsApp)", { exact: true }))
    .toHaveValue(/\/functions\/v1\/whatsapp-inbound-webhook$/);
  await expect(page.getByText(/Assine também o campo messages/i)).toBeVisible();
});

/**
 * O passo a passo desta tela cita `page_access_token` e `app_secret` e mandava
 * o admin para /admin/integrations no meio do fluxo: sai da tela, cola a chave,
 * volta e reencontra o passo. Agora cada slot da Meta tem campo aqui.
 *
 * A gravação é interceptada de propósito: colar um app secret de mentira no
 * cofre da homologação faria o `whatsapp-inbound-webhook` passar a recusar por
 * "assinatura inválida" em vez de "credencial ausente", e o cliente perderia o
 * valor que colou no painel da Meta. O que se prova aqui é que a tela manda o
 * slot certo pelo mesmo caminho de sempre (`set_integration_secret`).
 */
test("cada credencial da Meta tem campo na própria tela", async ({ page }) => {
  let enviado: unknown = null;
  await page.route("**/rest/v1/rpc/set_integration_secret", async (route) => {
    enviado = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify("00000000-0000-0000-0000-000000000000"),
    });
  });

  await page.goto("/admin/meta-ads");
  await aguardarCarregamento(page);

  const campo = page.getByLabel("Meta — app secret (assinatura do webhook)", { exact: true });
  await expect(campo, "o passo a passo cita o app secret e não deixava cadastrá-lo aqui").toBeVisible();
  await campo.fill("segredo-de-teste-que-nao-e-gravado");

  await page.getByRole("button", { name: /^Salvar Meta — app secret/i }).click();
  await expect(page.getByText(/credencial salva no cofre/i)).toBeVisible({ timeout: 15_000 });
  expect(enviado, "a tela gravou em outro slot").toMatchObject({
    p_provider: "meta",
    p_label: "app_secret",
  });

  // O valor não pode ficar na tela: o cofre nunca o devolve, então um campo
  // preenchido depois de salvar sugeriria que dá para reler o que foi gravado.
  await expect(campo).toHaveValue("");
});

/**
 * O Verify Token tem gerador próprio logo acima. Um campo de colagem para ele
 * aqui convidaria a inventar um valor à mão — e a perder o que a tela gerou,
 * que é o único momento em que ele aparece.
 */
test("o Verify Token não ganha campo de colagem — ele é gerado", async ({ page }) => {
  await page.goto("/admin/meta-ads");
  await aguardarCarregamento(page);

  await expect(
    page.getByLabel("Meta — token de verificação do webhook", { exact: true }),
  ).toHaveCount(0);
});

/**
 * Recusa por permissão não vira "falha ao ler o cofre" com um retry inútil.
 *
 * A rota é gateada por `menu.admin_lead_automation`; `list_integrations()` e
 * `set_integration_secret()` guardam por `settings.integrations` (0044) — dois
 * códigos diferentes. Quem receber só o do menu abre esta tela, leva 42501 na
 * leitura e, antes, ganhava um "Tentar de novo" que devolveria o mesmo 42501
 * para sempre. Simulado pela resposta, e não concedendo um menu sem a feature
 * ao usuário E2E, porque a matriz de permissões é lida por outros specs.
 *
 * O 403 é provocado de propósito; o navegador registra o recurso que falhou.
 */
test.describe(() => {
  test.use({ errosEsperados: [/status of 403/i] });

  test("sem a permissão do cofre a tela explica, em vez de oferecer repetição", async ({ page }) => {
    await page.route("**/rest/v1/rpc/list_integrations", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: "Sem permissão para gerenciar integrações." }),
      }));

    await page.goto("/admin/meta-ads");
    await aguardarCarregamento(page);

    await expect(page.getByText("Sem permissão para gerenciar integrações")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);
    await expect(page.getByText("Não consegui ler o cofre")).toHaveCount(0);
    // Sem cofre lido, nenhum campo de credencial pode aparecer prometendo
    // gravação — o banco recusaria com o mesmo 42501.
    await expect(page.getByRole("button", { name: /^Salvar Meta/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Gerar (e salvar|novo)/ })).toHaveCount(0);
  });
});
