import { test, expect, db, aguardarCarregamento } from "../support/fixtures";

/**
 * Posição na fila logo depois do check-in.
 *
 * `distribution_queue` só lista quem está em turno com distribuição já aberta
 * (0014: `now() >= distribution_start`). Entre o início do check-in e o da
 * distribuição a fila é vazia para todo mundo — e a tela dizia a quem acabara
 * de bater ponto que era "preciso estar em check-in". Os dois lados: com
 * presença aberta a tela promete a abertura no horário do turno; sem presença,
 * o requisito continua escrito. A posição em si (com a distribuição aberta)
 * está em `roleta.spec.ts`.
 *
 * Mesmo corretor de `roleta.spec.ts`: os dois arquivos limpam `checkins` ao
 * final, e a suíte roda serial (`workers: 1`).
 */

type Turno = { id: string; label: string; checkin_start: string; distribution_start: string; checkout_time: string };
type Elegibilidade = { allowed: boolean; reason: string | null; overdue_count: number; threshold: number };

const hhmm = (t: string) => t.slice(0, 5);
/** Hora no fuso que o banco usa para decidir turno (America/Sao_Paulo). */
const agoraSP = () => new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour12: false });

test.describe("fila depois do check-in", () => {
  let brokerId = "";
  let grupoGeral: { id: string; name: string };
  let membroCriadoAqui = false;

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
    const grupos = await db.select<{ id: string; name: string }>(
      "distribution_groups?kind=eq.general&active=eq.true&select=id,name&limit=1",
    );
    expect(grupos, "o catálogo precisa de um grupo de distribuição geral").toHaveLength(1);
    grupoGeral = grupos[0];

    // Sem grupo a tela nem consulta a fila ("Você não está em nenhum grupo").
    const atual = await db.select<{ active: boolean }>(
      `distribution_group_members?group_id=eq.${grupoGeral.id}&profile_id=eq.${brokerId}&select=active`,
    );
    if (atual.length) {
      if (!atual[0].active) {
        await db.update(`distribution_group_members?group_id=eq.${grupoGeral.id}&profile_id=eq.${brokerId}`, { active: true });
      }
    } else {
      await db.insert("distribution_group_members", { group_id: grupoGeral.id, profile_id: brokerId, active: true });
      membroCriadoAqui = true;
    }
  });

  test.afterAll(async () => {
    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    if (membroCriadoAqui) {
      await db.remove(`distribution_group_members?group_id=eq.${grupoGeral.id}&profile_id=eq.${brokerId}`);
    }
  });

  test("sem presença aberta a tela diz o que falta", async ({ page }) => {
    await db.remove(`checkins?profile_id=eq.${brokerId}`);

    await page.goto("/checkin");
    await aguardarCarregamento(page);

    await expect(page.getByText(`${grupoGeral.name}:`)).toBeVisible();
    await expect(page.getByText("fora da fila agora — é preciso estar em check-in no turno")).toBeVisible();
    await expect(page.getByText(/a fila abre/i)).toHaveCount(0);
  });

  test("com presença aberta antes da distribuição, a tela promete a abertura no horário do turno", async ({ page }) => {
    const agora = agoraSP();
    const turnos = await db.select<Turno>(
      "work_shifts?active=eq.true&select=id,label,checkin_start,distribution_start,checkout_time&order=position",
    );
    const turno = turnos.find((t) => t.checkin_start <= agora && agora < t.distribution_start) ?? null;
    test.skip(!turno, "nenhum turno entre o início do check-in e o da distribuição agora — a janela é de ~30 min por turno");

    // A promessa só vale sem bloqueio: quem estoura o limite de leads atrasados
    // sai da fila (0014) e a tela cai em "em check-in, mas fora da fila agora".
    const elegibilidade = (await db.rpc<Elegibilidade[]>("checkin_eligibility", { who: brokerId }))[0];
    expect(elegibilidade.allowed, "o corretor já começou o teste bloqueado — cenário inválido").toBe(true);

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    // `work_date` fica com o default do banco, como em `roleta.spec.ts`.
    await db.insert("checkins", { profile_id: brokerId, shift_id: turno!.id });

    // Por regra a fila está vazia para todo mundo nesta janela.
    const fila = await db.rpc<unknown[]>("distribution_queue", { p_group_id: grupoGeral.id });
    expect(fila, "antes de distribution_start a RPC não lista ninguém").toHaveLength(0);

    await page.goto("/checkin");
    await aguardarCarregamento(page);

    await expect(page.getByRole("button", { name: /check-out/i })).toBeEnabled();
    await expect(page.getByText(`check-in confirmado — a fila abre às ${hhmm(turno!.distribution_start)}`)).toBeVisible();
    await expect(page.getByText(/é preciso estar em check-in/i)).toHaveCount(0);
  });
});
