/**
 * Admin > Integrações: a tela do cofre só pode dizer o que o cofre diz.
 *
 * O cofre (`private.integration_credentials`) não é exposto pelo PostgREST e
 * não existe RPC de remoção, então o estado inicial NÃO é montado pelo teste:
 * o primeiro caso lê o cofre pela mesma `list_integrations()` da tela e cobra
 * que cada slot do catálogo apareça com o estado que o banco tem — em qualquer
 * estado. Antes o slot vazio dizia "usando secret META_*", como se a chave
 * estivesse garantida na variável de ambiente; `getSecret` só TENTA o
 * `Deno.env` depois do cofre, e ninguém promete que o secret exista.
 *
 * Os dois últimos casos interceptam a resposta da RPC em vez de mexer no
 * banco: rotacionar credencial de homologação (ou apagar uma) para exercitar
 * pendência e falha de leitura sairia mais caro que o defeito. O caminho real
 * de escrita, com conferência no banco, é o de `meta-ads.spec.ts`.
 */
import { test, expect, aguardarCarregamento } from "../support/fixtures";
import { resolveTarget } from "../support/target";
import { mintSession } from "../support/session";
import { E2E_USERS } from "../support/users";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INTEGRATION_SLOTS, slotKey } from "../../src/lib/integrationCatalog";

type Integracao = { provider: string; label: string; has_secret: boolean };

/** Slot com nome de secret de function de verdade; "—" no catálogo marca os que
 *  só o banco lê e que, por isso, não têm retaguarda de ambiente para prometer. */
const COM_RETAGUARDA = /^[A-Z][A-Z0-9_]*$/;

/**
 * `list_integrations()` guarda por `has_permission('settings.integrations')`,
 * que olha `auth.uid()` — a service_role não passa. Vai com o JWT do admin E2E,
 * o mesmo que a tela usa.
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

test("cada slot do catálogo mostra o estado que o cofre tem", async ({ page }) => {
  const cofre = await cofreComoAdmin();

  await page.goto("/admin/integrations");
  await aguardarCarregamento(page);
  await expect(page.getByRole("heading", { name: "Integrações", level: 1 })).toBeVisible();

  for (const slot of INTEGRATION_SLOTS) {
    const cartao = page.getByRole("group", { name: slot.title, exact: true });
    await expect(cartao, `o slot ${slot.provider}/${slot.label} sumiu da tela`).toBeVisible();

    const gravado = cofre.some(
      (r) => r.provider === slot.provider && r.label === slot.label && r.has_secret,
    );
    await expect(cartao.getByText(gravado ? "no cofre" : "não configurado", { exact: true })).toBeVisible();

    if (gravado) {
      // `dateTime` do app: 02/09/2026 14:30. Slot gravado sem data seria estado
      // pela metade — o admin não sabe se a troca de ontem pegou.
      await expect(cartao.getByText(/Última atualização: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)).toBeVisible();
    } else {
      // Slot vazio tem de dizer o que acontece agora, não prometer o ambiente.
      await expect(cartao.getByText(/^Nada no cofre\./)).toBeVisible();
      if (COM_RETAGUARDA.test(slot.envName)) {
        await expect(cartao.getByText(slot.envName, { exact: true })).toBeVisible();
      }
    }
  }

  // A copy antiga afirmava que a function estava usando o secret do ambiente.
  await expect(page.getByText(/usando secret/i)).toHaveCount(0);
});

test("o botão de salvar continua com nome acessível enquanto grava", async ({ page }) => {
  const slot = INTEGRATION_SLOTS[0];

  // Segura a resposta para que a fase pendente exista pelo tempo da asserção.
  // `fulfill` responde no lugar do PostgREST: nenhuma credencial é gravada.
  let liberar: () => void = () => undefined;
  const preso = new Promise<void>((resolve) => { liberar = resolve; });
  await page.route("**/rest/v1/rpc/set_integration_secret", async (route) => {
    await preso;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify("00000000-0000-0000-0000-000000000000"),
    });
  });

  await page.goto("/admin/integrations");
  await aguardarCarregamento(page);

  const cartao = page.getByRole("group", { name: slot.title, exact: true });
  // O cartão tem DOIS botões de propósito: "Salvar <slot>" e, nos slots com
  // sonda, "Testar conexão <slot>" (`PROBES` em AdminIntegrations — e o slot 0
  // é justamente um deles). O que separa os dois é o nome acessível; o prefixo
  // acompanha o botão de salvar nos dois estados, porque durante a gravação ele
  // passa a se chamar "Salvando… <slot>", que é o que este caso confere.
  const botao = cartao.getByRole("button", { name: /^Salv/ });
  await expect(botao).toHaveAccessibleName(`Salvar ${slot.title}`);
  // Sem credencial digitada não há o que salvar.
  await expect(botao).toBeDisabled();

  // `type="password"` não tem papel ARIA, então `getByRole` não alcança o campo;
  // o placeholder cobre os dois estados (vazio × já gravado).
  await cartao.getByPlaceholder(/Colar credencial|Digite para substituir/)
    .fill("valor-que-nao-sai-do-navegador");
  await botao.click();

  // Antes o conteúdo virava só `<Loader2 aria-hidden />`: o botão continuava
  // no foco e sem nome nenhum para quem usa leitor de tela ou comando de voz.
  await expect(botao).toHaveAccessibleName(`Salvando… ${slot.title}`);
  await expect(botao).toBeDisabled();

  liberar();
  await expect(botao).toHaveAccessibleName(`Salvar ${slot.title}`);
});

// O 500 é provocado de propósito; o navegador registra o recurso que falhou.
test.describe(() => {
  test.use({ errosEsperados: [/status of 500/i] });

  test("falha ao ler o cofre não pode virar slot 'não configurado'", async ({ page }) => {
    const rota = "**/rest/v1/rpc/list_integrations";
    await page.route(rota, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) }));

    await page.goto("/admin/integrations");
    await aguardarCarregamento(page);

    await expect(page.getByText("Não consegui ler o cofre")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar as integrações.")).toBeVisible();
    // O erro do Postgres não vai para a tela, e nenhum slot pode fingir estado.
    await expect(page.getByText("boom")).toHaveCount(0);
    await expect(page.getByText("não configurado", { exact: true })).toHaveCount(0);
    await expect(page.getByText("no cofre", { exact: true })).toHaveCount(0);

    await page.unroute(rota);
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await aguardarCarregamento(page);
    await expect(page.getByRole("group", { name: INTEGRATION_SLOTS[0].title, exact: true })).toBeVisible();
  });
});

// O 403 é provocado de propósito; o navegador registra o recurso que falhou.
test.describe(() => {
  test.use({ errosEsperados: [/status of 403/i] });

  test("recusa por permissão não vira falha de leitura com retry inútil", async ({ page }) => {
    // A rota é gateada por `menu.admin_integrations`; `list_integrations()`
    // guarda por `settings.integrations`. Quem tem só o primeiro entra na tela
    // e leva 42501 — repetir a chamada devolve o mesmo 42501 para sempre.
    // Simulado pela resposta porque conceder um menu sem a feature ao usuário
    // E2E mexeria na matriz que os outros specs leem.
    await page.route("**/rest/v1/rpc/list_integrations", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: "Sem permissão para gerenciar integrações." }),
      }));

    await page.goto("/admin/integrations");
    await aguardarCarregamento(page);

    await expect(page.getByText("Sem permissão para gerenciar integrações")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);
    await expect(page.getByText("Não consegui ler o cofre")).toHaveCount(0);
    // Nenhum slot pode fingir estado enquanto o cofre não foi lido.
    await expect(page.getByText("não configurado", { exact: true })).toHaveCount(0);
  });
});

/**
 * "Testar conexão": não havia como saber se a chave gravada é válida antes de
 * um lead real depender dela — e, com o cofre vazio, a tela não dizia se o
 * `Deno.env` tinha alguma coisa. O botão chama a própria function que usa a
 * credencial, que resolve cofre → ambiente, e devolve o veredito.
 *
 * O teste aceita os dois desfechos legítimos (aceita / falta credencial) e
 * reprova o terceiro: botão que não diz nada. Sem credencial de terceiro no
 * cofre da homologação, o 5xx no console é a prova da recusa.
 */
test.describe(() => {
  test.use({ errosEsperados: [/status of 5\d\d/i] });

  test("testar conexão responde sobre a credencial em uso", async ({ page }) => {
    await page.goto("/admin/integrations");
    await aguardarCarregamento(page);

    const cartao = page.getByRole("group", { name: "OpenAI — chave de API", exact: true });
    await cartao.getByRole("button", { name: /testar conexão/i }).click();

    const veredito = cartao.getByRole("status");
    await expect(veredito).toBeVisible({ timeout: 30_000 });
    await expect(
      veredito,
      "botão de teste que não diz nada é pior que botão nenhum",
    ).toContainText(/credencial aceita|falta a chave|credencial ausente|recusou/i);
  });
});

/**
 * Catálogo da tela × slots que as functions leem.
 *
 * `SECRET_SLOTS` (supabase/functions/_shared/secrets.ts) e `INTEGRATION_SLOTS`
 * (src/lib/integrationCatalog.ts) são duas listas mantidas à mão que precisam
 * concordar, e nada falhava se divergissem: uma credencial nova numa function
 * ficaria sem campo na tela — impossível de cadastrar sem redeploy.
 *
 * A cobrança é numa direção só: todo par lido por function TEM de ter campo. O
 * contrário é legítimo — `supabase/functions_url` só o cron lê, direto do cofre.
 */
test("todo slot lido por edge function tem campo na tela", async () => {
  const fonte = readFileSync(resolve("supabase/functions/_shared/secrets.ts"), "utf8");
  const bloco = /export const SECRET_SLOTS = \{([\s\S]*?)\n\} as const;/.exec(fonte)?.[1] ?? "";
  expect(bloco, "SECRET_SLOTS mudou de forma — ajuste este teste junto").not.toBe("");

  const pares = [...bloco.matchAll(/provider:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)]
    .map(([, provider, label]) => `${provider}::${label}`);
  expect(pares.length, "nenhum slot encontrado em SECRET_SLOTS").toBeGreaterThan(5);

  const naTela = new Set(INTEGRATION_SLOTS.map((s) => slotKey(s.provider, s.label)));
  const semCampo = pares.filter((p) => !naTela.has(p));
  expect(semCampo, "credencial que a function lê e a tela não deixa cadastrar").toEqual([]);
});

/**
 * Revogar credencial (migration 0082).
 *
 * Até aqui o cofre só tinha `set_integration_secret`: tirar do ar uma chave
 * vazada exigia console do Postgres, porque a coluna `active` existia e nenhuma
 * RPC a alcançava.
 *
 * O efeito no banco (segredo apagado, linha inativa, leitura seguinte vazia) é
 * cobrado em `supabase/tests/82_sdr_cofre_fila.sql`. Aqui se cobra o que só a
 * tela pode errar: pedir confirmação com a consequência escrita, mandar o slot
 * certo e não oferecer o botão para slot vazio.
 */
test("revogar credencial pede confirmação com a consequência escrita", async ({ page }) => {
  const cofre = await cofreComoAdmin();
  const preenchido = INTEGRATION_SLOTS.find((s) =>
    cofre.some((r) => r.provider === s.provider && r.label === s.label && r.has_secret));
  test.skip(!preenchido, "cofre da homologação sem nenhuma credencial gravada");
  const slot = preenchido!;

  // Interceptado: revogar de verdade uma credencial da homologação derrubaria o
  // cron de notificações para os outros specs. O que se prova aqui é o pedido.
  let enviado: unknown = null;
  await page.route("**/rest/v1/rpc/revoke_integration_secret", async (route) => {
    enviado = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: "true" });
  });

  await page.goto("/admin/integrations");
  await aguardarCarregamento(page);

  const cartao = page.getByRole("group", { name: slot.title, exact: true });
  await cartao.getByRole("button", { name: /revogar/i }).click();

  const dialogo = page.getByRole("alertdialog");
  // Revogar apaga o valor: a tela precisa dizer isso ANTES, porque o cofre não
  // devolve o que gravou e não há como desfazer pela interface.
  await expect(dialogo).toContainText(slot.title);
  await expect(dialogo).toContainText(/apagado/i);
  await expect(dialogo).toContainText(slot.usedBy);

  await dialogo.getByRole("button", { name: /revogar credencial/i }).click();
  await expect(page.getByText(/credencial revogada/i)).toBeVisible({ timeout: 15_000 });
  expect(enviado, "a revogação foi para outro slot").toEqual({
    p_provider: slot.provider,
    p_label: slot.label,
  });
});

test("slot vazio não oferece revogar — não há o que revogar", async ({ page }) => {
  const cofre = await cofreComoAdmin();
  const vazio = INTEGRATION_SLOTS.find((s) =>
    !cofre.some((r) => r.provider === s.provider && r.label === s.label && r.has_secret));
  test.skip(!vazio, "cofre da homologação com todos os slots preenchidos");

  await page.goto("/admin/integrations");
  await aguardarCarregamento(page);

  const cartao = page.getByRole("group", { name: vazio!.title, exact: true });
  await expect(cartao.getByRole("button", { name: /revogar/i })).toHaveCount(0);
});

/**
 * Slot sem sonda precisa dizer POR QUE não tem teste. Sem a frase, a ausência
 * do botão parece esquecimento — e o admin não descobre que aquele valor só
 * será conferido quando o terceiro recusar, em produção.
 */
test("slot sem teste automático explica quem confere aquele valor", async ({ page }) => {
  await page.goto("/admin/integrations");
  await aguardarCarregamento(page);

  const cartao = page.getByRole("group", { name: /app secret/i });
  await expect(cartao.getByRole("button", { name: /testar conexão/i })).toHaveCount(0);
  await expect(cartao.getByText(/sem teste automático/i)).toBeVisible();
});

/**
 * A fila represada.
 *
 * A RLS de `notifications` é de dono e só `in_app`: nenhum administrador
 * enxergava as mensagens de WhatsApp esperando credencial — o cron gravava o
 * motivo em `last_error` a cada minuto e o admin só descobria pelo console do
 * banco. A resposta é interceptada para o número não depender do estado da
 * homologação; a RPC em si é cobrada em `supabase/tests/82_sdr_cofre_fila.sql`.
 */
test("a fila de notificações represada aparece ao lado da credencial que a trava", async ({ page }) => {
  await page.route("**/rest/v1/rpc/notification_queue_health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          channel: "whatsapp",
          pendentes: 312,
          com_erro: 53,
          mais_antiga: "2026-09-01T12:00:00Z",
          ultimo_erro: "credencial da WhatsApp Cloud API ausente no cofre",
          max_tentativas: 0,
        },
        {
          channel: "in_app",
          pendentes: 391,
          com_erro: 0,
          mais_antiga: "2026-07-28T17:54:14Z",
          ultimo_erro: null,
          max_tentativas: 0,
        },
      ]),
    }));

  await page.goto("/admin/integrations");
  await aguardarCarregamento(page);

  // Na aba das credenciais: só o canal que depende de chave de terceiro vira
  // aviso. `in_app` vive com pendência sem que isso seja defeito.
  await expect(page.getByText(/312 notificação\(ões\) de WhatsApp esperando envio/i)).toBeVisible();
  await expect(page.getByText(/credencial da WhatsApp Cloud API ausente no cofre/i).first()).toBeVisible();
  await expect(
    page.getByText(/391 notificação/i),
    "fila do app não é alarme de credencial",
  ).toHaveCount(0);

  // Na aba dos jobs: a tabela por canal, que distingue "o job não roda" de "o
  // job roda e a Meta não deixa passar".
  await page.getByRole("tab", { name: /saúde dos jobs/i }).click();
  const tabela = page.getByRole("table", { name: /notificações pendentes por canal/i });
  await expect(tabela).toContainText("WhatsApp");
  await expect(tabela).toContainText("312");
  await expect(tabela).toContainText("No app (sino)");
});
