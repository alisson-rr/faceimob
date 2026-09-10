/**
 * Demonstração real do rodízio da fila de leads.
 *
 *   npm run demo     → gera `demo/fila-de-leads.webm`
 *
 * O vídeo usa três corretores autenticados, uma fila temporária isolada e três
 * leads reais. A cada rodada ele mostra quem está em primeiro, troca para a
 * sessão desse corretor, distribui o lead pela RPC oficial e atende pelo botão
 * da aplicação. Se tela e banco discordarem, a gravação falha.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, db, aguardarCarregamento, comoAdmin, runTag } from "../support/fixtures";
import { statePathFor } from "../support/paths";
import { userFor, type RoleKey } from "../support/users";

type Fila = {
  profile_id: string;
  full_name: string;
  queue_position: number;
};

type CorretorDemo = {
  key: RoleKey;
  id: string;
  fullName: string;
};

type ConfiguracaoOriginal = {
  overdue_block_threshold: number;
  leads_paused: boolean;
};

const marca = runTag();
const corretoresDaDemo: RoleKey[] = ["broker", "brokerRival", "brokerThird"];
/**
 * O dia operacional é do banco (`current_work_date()`, em America/Sao_Paulo),
 * não do relógio de quem grava. Com a data em UTC, uma gravação feita depois
 * das 21:00 de Brasília nascia no dia seguinte e a presença ficava invisível
 * para `distribution_queue` — a fila da demonstração aparecia vazia.
 */
let hojeNoBanco = "";

let corretores: CorretorDemo[] = [];
let grupo: { id: string; name: string } | null = null;
let turnoId: string | null = null;
let bypassOriginal = false;
let configuracaoOriginal: ConfiguracaoOriginal | null = null;
let checkinsPausados: string[] = [];

/** Pausa curta para cada informação ficar legível no vídeo. */
const respirar = (page: Page, ms = 1500) => page.waitForTimeout(ms);

function sessaoSalva(key: RoleKey) {
  return JSON.parse(readFileSync(statePathFor(key), "utf8")) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
}

/** Troca o usuário no mesmo navegador, mantendo a gravação em um único vídeo. */
async function entrarComo(page: Page, key: RoleKey) {
  const state = sessaoSalva(key);
  const entries = state.origins[0]?.localStorage ?? [];

  await page.evaluate((storage) => {
    localStorage.clear();
    for (const entry of storage) localStorage.setItem(entry.name, entry.value);
  }, entries);
  await page.goto("/checkin");
  await aguardarCarregamento(page);
  await expect(page.locator("header").getByText(userFor(key).fullName, { exact: true }).first()).toBeVisible();
}

async function lerFila(): Promise<Fila[]> {
  if (!grupo) throw new Error("grupo da demonstração não foi criado");
  return db.rpc<Fila[]>("distribution_queue", { p_group_id: grupo.id });
}

async function mostrarFila(page: Page, corretor: CorretorDemo, posicao: number) {
  if (!grupo) throw new Error("grupo da demonstração não foi criado");
  const lista = page.getByRole("list", { name: `Fila ${grupo.name}` });
  await expect(lista).toBeVisible({ timeout: 20_000 });
  await expect(lista.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText(`você é o ${posicao}º de 3`, { exact: true })).toBeVisible();
  await expect(lista.getByText(`${corretor.fullName} (você)`, { exact: true })).toBeVisible();
  await lista.scrollIntoViewIfNeeded();
}

test.beforeAll(async () => {
  hojeNoBanco = await db.rpc<string>("current_work_date");
  corretores = await Promise.all(corretoresDaDemo.map(async (key) => ({
    key,
    id: await db.profileIdOf(key),
    fullName: userFor(key).fullName,
  })));

  const [perfil] = await db.select<{ bypass_ip_check: boolean }>(
    `profiles?id=eq.${corretores[0].id}&select=bypass_ip_check`,
  );
  bypassOriginal = perfil?.bypass_ip_check ?? false;

  const [config] = await db.select<ConfiguracaoOriginal>(
    "automation_settings?id=eq.true&select=overdue_block_threshold,leads_paused",
  );
  if (!config) throw new Error("automation_settings não encontrada");
  configuracaoOriginal = config;
  await db.update("automation_settings?id=eq.true", {
    overdue_block_threshold: 9999,
    leads_paused: false,
  });

  const [grupoCriado] = await db.insert<{ id: string; name: string }>("distribution_groups", {
    name: "Fila da Demonstração",
    slug: `fila-demo-${marca}`,
    kind: "specific",
    attend_timeout_seconds: 300,
    active: true,
  });
  grupo = grupoCriado;
  await db.insert("distribution_group_members", corretores.map((corretor) => ({
    group_id: grupoCriado.id,
    profile_id: corretor.id,
    active: true,
  })));

  // Menor posição ganha do catálogo normal em `current_shift()` durante o vídeo.
  const [turno] = await db.insert<{ id: string }>("work_shifts", {
    code: `demo-${marca}`,
    label: "Demonstração",
    checkin_start: "00:00",
    distribution_start: "00:00",
    checkout_time: "23:59",
    position: -100,
    active: true,
  });
  turnoId = turno.id;

  // Evita que um check-in anterior duplique o corretor na fila temporária.
  const ids = corretores.map((corretor) => corretor.id).join(",");
  const abertos = await db.select<{ id: string }>(
    `checkins?profile_id=in.(${ids})&checked_out_at=is.null&select=id`,
  );
  checkinsPausados = abertos.map((checkin) => checkin.id);
  if (checkinsPausados.length) {
    await db.update(`checkins?id=in.(${checkinsPausados.join(",")})`, { checked_out_at: new Date().toISOString() });
  }

  // Os corretores 2 e 3 já entram presentes; o primeiro fará o check-in pela tela.
  await db.insert("checkins", corretores.slice(1).map((corretor) => ({
    profile_id: corretor.id,
    shift_id: turno.id,
    work_date: hojeNoBanco,
    ip_address: "127.0.0.1",
  })));
  await comoAdmin.update(`profiles?id=eq.${corretores[0].id}`, { bypass_ip_check: true });
});

test.afterAll(async () => {
  if (corretores[0]?.id) {
    await comoAdmin.update(`profiles?id=eq.${corretores[0].id}`, { bypass_ip_check: bypassOriginal });
  }
  if (configuracaoOriginal) {
    await db.update("automation_settings?id=eq.true", configuracaoOriginal);
  }
  await db.remove(`leads?notes=eq.${marca}`);
  if (turnoId) await db.remove(`checkins?shift_id=eq.${turnoId}`);
  if (checkinsPausados.length) {
    await db.update(`checkins?id=in.(${checkinsPausados.join(",")})`, { checked_out_at: null });
  }
  if (grupo) await db.remove(`distribution_groups?id=eq.${grupo.id}`);
  if (turnoId) await db.remove(`work_shifts?id=eq.${turnoId}`);
});

test("três leads percorrem os três corretores da fila", async ({ page }) => {
  if (!grupo || !turnoId) throw new Error("cenário da demonstração incompleto");

  // 1. O primeiro corretor faz check-in pela interface real.
  await page.goto("/checkin");
  await aguardarCarregamento(page);
  await respirar(page);
  await page.getByRole("button", { name: /fazer check-in/i }).click();
  await expect(page.getByRole("heading", { name: /check-in confirmado/i })).toBeVisible();
  await respirar(page);
  await page.getByRole("button", { name: /bora atender/i }).click();

  const [presenca] = await db.select<{ checked_out_at: string | null; ip_address: string | null }>(
    `checkins?profile_id=eq.${corretores[0].id}&shift_id=eq.${turnoId}&select=checked_out_at,ip_address`,
  );
  expect(presenca, "o check-in feito na tela precisa existir no banco").toBeTruthy();
  expect(presenca.checked_out_at).toBeNull();
  expect(presenca.ip_address, "o servidor precisa ter identificado o IP").toBeTruthy();

  await expect.poll(async () => (await lerFila()).length, { timeout: 20_000 }).toBe(3);
  const filaInicial = await lerFila();
  const corretorInicial = corretores.find((corretor) => corretor.id === filaInicial[0].profile_id)!;
  if (corretorInicial.key !== "broker") await entrarComo(page, corretorInicial.key);
  await mostrarFila(page, corretorInicial, 1);
  await respirar(page, 2600);

  const [origem] = await db.select<{ id: string }>("lead_sources?select=id&order=label&limit=1");
  let ultimoLead = "";

  // 2. A cada lead, o primeiro recebe e vai para o fim: 1 → 2 → 3.
  for (let rodada = 1; rodada <= 3; rodada += 1) {
    const fila = await lerFila();
    expect(fila).toHaveLength(3);
    const proximo = corretores.find((corretor) => corretor.id === fila[0].profile_id);
    if (!proximo) throw new Error(`corretor ${fila[0].profile_id} não pertence à demonstração`);

    await entrarComo(page, proximo.key);
    await mostrarFila(page, proximo, 1);
    await respirar(page, 1800);

    ultimoLead = `Lead ${rodada} — ${proximo.fullName}`;
    const [lead] = await db.insert<{ id: string }>("leads", {
      full_name: ultimoLead,
      phone: `11990000${String(rodada).padStart(3, "0")}`,
      source_id: origem?.id ?? null,
      campaign_name: "Demonstração da fila",
      notes: marca,
      distribution_group_id: grupo.id,
    });
    const escolhido = await db.rpc<string | null>("assign_lead", { p_lead_id: lead.id });
    expect(escolhido, `o Lead ${rodada} deve ir para o primeiro da fila`).toBe(proximo.id);

    const aviso = page.getByRole("dialog").filter({ hasText: /lead atribuído a você/i });
    await expect(aviso).toBeVisible({ timeout: 30_000 });
    await expect(aviso).toContainText(ultimoLead);
    await respirar(page, 2400);
    await aviso.getByRole("button", { name: /atender agora/i }).click();
    await expect(aviso).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => {
      const [linha] = await db.select<{ status: string; attend_deadline: string | null }>(
        `leads?id=eq.${lead.id}&select=status,attend_deadline`,
      );
      return `${linha.status}|${linha.attend_deadline ?? "sem prazo"}`;
    }, { timeout: 15_000 }).toBe("attending|sem prazo");

    await page.goto("/checkin");
    await aguardarCarregamento(page);
    await mostrarFila(page, proximo, 3);
    await respirar(page, 1900);
  }

  // 3. Fecha mostrando o terceiro lead já na carteira do usuário que o recebeu.
  await page.goto("/leads");
  await aguardarCarregamento(page);
  await page.getByPlaceholder(/buscar por nome/i).fill(ultimoLead);
  // O nome do cliente é um BOTÃO que abre o histórico do lead, não um cabeçalho
  // (achado X06: a linha inteira clicável não era alcançável por teclado). Como
  // `heading`, este passo procurava um papel que a tabela não usa mais.
  const linhaDoLead = page.getByRole("row").filter({ hasText: ultimoLead });
  await expect(linhaDoLead.getByRole("button", { name: ultimoLead, exact: true })).toBeVisible();
  await expect(linhaDoLead.getByText("Em atendimento").first()).toBeVisible();
  await respirar(page, 3000);
});
