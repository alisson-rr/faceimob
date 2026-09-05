/**
 * Automação de Leads (/admin/lead-automation) — o que a auditoria de 01/09
 * achou quebrado na tela do admin, virando teste:
 *
 *   · formulário adicionado à mão sumia da lista e não podia ser removido;
 *   · formulário de outro grupo falhava em silêncio (índice único global em
 *     `distribution_group_forms.form_id`, migration 0004);
 *   · a lista mostrava o id cru mesmo com `form_name` gravado;
 *   · "Sem resposta (h)" era gravado e nada lia — agora `mark_no_response_leads()`
 *     (0043) lê, e o teste prova pelo banco.
 *
 * Cada caso confere no banco o que a tela disse ter feito: toast verde sem
 * linha gravada é a classe de defeito que motivou a auditoria.
 */
import type { Page } from "@playwright/test";
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

type Grupo = { id: string; name: string };
type Vinculo = { group_id: string; form_id: string; form_name: string | null };
type Regras = {
  no_response_hours: number;
  auto_first_contact: boolean;
  overdue_block_threshold: number;
  notify_on_assign: boolean;
  notify_on_timeout: boolean;
};
type Turno = { id: string; code: string; label: string; position: number };

const tag = runTag();
const NOME_A = `E2E Automação A ${tag}`;
const NOME_B = `E2E Automação B ${tag}`;
const FORM_B = `e2e-form-b-${tag}`;
const FORM_B_NOME = `Form E2E B ${tag}`;
const FORM_MANUAL = `e2e-form-manual-${tag}`;
const FORM_MANUAL_NOME = `Form E2E manual ${tag}`;

let grupoA: Grupo;
let grupoB: Grupo;
let regrasOriginais: Regras;

const vinculos = (formId: string) =>
  db.select<Vinculo>(
    `distribution_group_forms?form_id=eq.${encodeURIComponent(formId)}&select=group_id,form_id,form_name`,
  );

const regrasNoBanco = async () =>
  (await db.select<Regras>(
    "automation_settings?id=eq.true&select=no_response_hours,auto_first_contact,overdue_block_threshold,notify_on_assign,notify_on_timeout",
  ))[0];

const turnosNoBanco = () =>
  db.select<Turno>("work_shifts?select=id,code,label,position&order=position");

const abrirConfiguracao = async (page: Page, grupo: string) => {
  await page.goto("/admin/lead-automation");
  await aguardarCarregamento(page);
  await page.getByRole("button", { name: `Configurar ${grupo}` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return page.getByRole("dialog");
};

test.beforeAll(async () => {
  // O slug nasce por trigger (`distribution_groups_ensure_slug`).
  [grupoA] = await db.insert<Grupo>("distribution_groups", { name: NOME_A });
  [grupoB] = await db.insert<Grupo>("distribution_groups", { name: NOME_B });
  await db.insert("distribution_group_forms", { group_id: grupoB.id, form_id: FORM_B, form_name: FORM_B_NOME });
  regrasOriginais = await regrasNoBanco();
});

test.afterAll(async () => {
  // Os vínculos de formulário caem por cascade junto com o grupo.
  await db.remove(`distribution_groups?id=in.(${grupoA.id},${grupoB.id})`);
  await db.update("automation_settings?id=eq.true", regrasOriginais);
  await db.remove(`notifications?kind=eq.lead_no_response&title=like.${encodeURIComponent(`*${tag}*`)}`);
  await db.remove(`leads?notes=eq.${encodeURIComponent(tag)}`);
});

test("formulário adicionado à mão aparece marcado e pode ser desmarcado", async ({ page }) => {
  const dialogo = await abrirConfiguracao(page, NOME_A);

  // Era `prompt()` do navegador: sem rótulo, sem validação, e alguns webviews
  // simplesmente ignoram. Agora é um diálogo com campos nomeados.
  await dialogo.getByRole("button", { name: /adicionar form manual/i }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "Vincular formulário da Meta" });
  await modal.getByLabel(/id do formulário/i).fill(FORM_MANUAL);
  await modal.getByLabel(/nome do formulário/i).fill(FORM_MANUAL_NOME);
  await modal.getByRole("button", { name: /vincular/i }).click();

  const linha = dialogo.locator("label", { hasText: FORM_MANUAL_NOME });
  await expect(linha, "form sem lead nenhum precisa aparecer na lista").toBeVisible();

  const caixa = linha.getByRole("checkbox");
  await expect(caixa).toBeChecked();
  expect(await vinculos(FORM_MANUAL)).toEqual([
    { group_id: grupoA.id, form_id: FORM_MANUAL, form_name: FORM_MANUAL_NOME },
  ]);

  await caixa.click();
  await expect(dialogo.locator("label", { hasText: FORM_MANUAL_NOME })).toHaveCount(0);
  expect(await vinculos(FORM_MANUAL), "desmarcar tem que apagar o vínculo").toHaveLength(0);
});

// A recusa vem como 409 do PostgREST (unique_violation) e o navegador loga isso
// no console: é a prova de que o banco barrou, não um defeito da tela.
test.describe(() => {
  test.use({ errosEsperados: [/status of 409/i] });

  test("formulário de outro grupo mostra o nome, o dono, e avisa ao tentar mover", async ({ page }) => {
    const dialogo = await abrirConfiguracao(page, NOME_A);

    const linha = dialogo.locator("label", { hasText: FORM_B_NOME });
    await expect(linha, "o nome gravado em distribution_group_forms é o que se lê").toBeVisible();
    await expect(linha).toContainText(`grupo: ${NOME_B}`);

    await linha.getByRole("checkbox").click();
    await expect(page.getByText(/já pertence a outro grupo/i)).toBeVisible();
    expect(await vinculos(FORM_B), "vínculo original continua no grupo B").toEqual([
      { group_id: grupoB.id, form_id: FORM_B, form_name: FORM_B_NOME },
    ]);
  });
});

test("salvar as regras grava no banco e sobrevive ao recarregar", async ({ page }) => {
  await page.goto("/admin/lead-automation");
  await aguardarCarregamento(page);

  const horas = page.getByLabel("Sem resposta (h)");
  const auto = page.getByRole("switch", { name: "Auto 1º contato" });
  const autoLigado = await auto.isChecked();

  // Sempre para cima: um prazo curto no banco compartilhado moveria leads
  // reais na próxima varredura do cron.
  const novoPrazo = regrasOriginais.no_response_hours + 12;
  await horas.fill(String(novoPrazo));
  await auto.click();
  await page.getByRole("button", { name: /^salvar$/i }).click();
  await expect(page.getByText("Automação salva")).toBeVisible();

  // `toMatchObject`: a leitura traz também as colunas de bloqueio e de aviso,
  // que o caso seguinte cobre.
  expect(await regrasNoBanco(), "toast de sucesso sem linha gravada é tela mentindo").toMatchObject({
    no_response_hours: novoPrazo,
    auto_first_contact: !autoLigado,
  });

  await page.reload();
  await aguardarCarregamento(page);
  await expect(page.getByLabel("Sem resposta (h)")).toHaveValue(String(novoPrazo));
  await expect(page.getByRole("switch", { name: "Auto 1º contato" })).toBeChecked({ checked: !autoLigado });
});

/**
 * Três colunas de `automation_settings` que o banco realmente lê não tinham
 * campo: `overdue_block_threshold` (quantos leads vencidos tiram o corretor da
 * fila, lida por `distribution_queue`) e os dois `notify_on_*` das rotinas de
 * notificação. O admin não conseguia ajustar nem desligar.
 */
test("as regras de bloqueio e de aviso chegam ao banco", async ({ page }) => {
  await page.goto("/admin/lead-automation");
  await aguardarCarregamento(page);

  const limite = page.getByLabel("Vencidos p/ bloquear");
  const aviso = page.getByRole("switch", { name: "Avisar lead vencido" });
  const avisoLigado = await aviso.isChecked();
  const novoLimite = regrasOriginais.overdue_block_threshold + 1;

  await limite.fill(String(novoLimite));
  await aviso.click();
  await page.getByRole("button", { name: /^salvar$/i }).click();
  await expect(page.getByText("Automação salva")).toBeVisible();

  await expect(async () => {
    const depois = await regrasNoBanco();
    expect(depois.overdue_block_threshold).toBe(novoLimite);
    expect(depois.notify_on_timeout).toBe(!avisoLigado);
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await aguardarCarregamento(page);
  await expect(page.getByLabel("Vencidos p/ bloquear")).toHaveValue(String(novoLimite));
});

/**
 * "Sem resposta (h)" em 0 era gravado com toast verde: a coluna não tem CHECK
 * no banco (ao contrário de `attend_timeout_seconds` e
 * `overdue_block_threshold`), o `min={1}` do input não vale nada porque o
 * Salvar é `onClick` e não submit, e `mark_no_response_leads()` faz
 * `if v_hours <= 0 then return 0` — a regra ficava DESLIGADA em silêncio
 * enquanto o texto de ajuda continuava prometendo o aviso no sino.
 */
test("prazo zerado é recusado pelo nome do campo, e nada é gravado", async ({ page }) => {
  await page.goto("/admin/lead-automation");
  await aguardarCarregamento(page);

  const horas = page.getByLabel("Sem resposta (h)");
  await horas.fill("0");
  await page.getByRole("button", { name: /^salvar$/i }).click();

  // Com sete campos numéricos na mesma linha, a recusa precisa dizer QUAL.
  await expect(page.getByText(/"Sem resposta \(h\)" precisa ser no mínimo 1/)).toBeVisible();
  await expect(page.getByText("Automação salva")).toHaveCount(0);
  expect(
    (await regrasNoBanco()).no_response_hours,
    "campo recusado não pode ter chegado ao banco",
  ).toBeGreaterThan(0);
});

/**
 * `work_shifts.position` decide a ordem em que os turnos aparecem e nada a
 * gravava: todo turno criado pela tela nascia em 0 e a ordem entre eles ficava
 * por conta do Postgres. Reordenar agora grava a posição de todos.
 */
test("reordenar turno grava a posição no banco", async ({ page }) => {
  const antes = await turnosNoBanco();
  test.skip(antes.length < 2, "cenário precisa de pelo menos dois turnos cadastrados");

  await page.goto("/admin/lead-automation");
  await aguardarCarregamento(page);

  const primeiro = antes[0];
  const segundo = antes[1];
  await page.getByRole("button", { name: `Descer turno ${primeiro.label}` }).click();

  await expect(async () => {
    const depois = await turnosNoBanco();
    expect(depois[0].id, "o segundo turno tinha de assumir a primeira posição").toBe(segundo.id);
    expect(depois[1].id).toBe(primeiro.id);
    // Posição gravada de verdade, não empate em 0.
    expect(depois.map((t) => t.position)).toEqual(depois.map((_, i) => i));
  }).toPass({ timeout: 15_000 });

  // Devolve a ordem original: a tela é compartilhada com os outros testes.
  await page.getByRole("button", { name: `Subir turno ${primeiro.label}` }).click();
  await expect(async () => {
    expect((await turnosNoBanco())[0].id).toBe(primeiro.id);
  }).toPass({ timeout: 15_000 });
});

test("lead parado em Primeiro Contato além do prazo vira Sem Resposta e avisa o corretor", async () => {
  const brokerId = await db.profileIdOf("broker");
  const { no_response_hours } = await regrasNoBanco();

  // Já vencido pelo prazo VIGENTE: não mexe na configuração compartilhada e
  // qualquer lead real que a varredura também mova, o cron moveria em 5 min.
  const [lead] = await db.insert<{ id: string }>("leads", {
    full_name: `Lead sem resposta ${tag}`,
    phone: "11999990043",
    status: "attending",
    assigned_to: brokerId,
    funnel_stage: "first_contact",
    first_contact_at: new Date(Date.now() - (no_response_hours + 1) * 3_600_000).toISOString(),
    notes: tag,
  });

  await db.rpc("mark_no_response_leads");

  const [depois] = await db.select<{ funnel_stage: string }>(`leads?id=eq.${lead.id}&select=funnel_stage`);
  expect(depois.funnel_stage).toBe("no_response");

  const avisos = await db.select<{ channel: string }>(
    `notifications?profile_id=eq.${brokerId}&kind=eq.lead_no_response&link=eq.${encodeURIComponent(`/leads?lead=${lead.id}`)}&select=channel`,
  );
  expect(avisos, "o corretor precisa ser avisado no sino").toEqual([{ channel: "in_app" }]);
});
