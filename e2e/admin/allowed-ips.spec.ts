/**
 * IPs autorizados para check-in (ata de 14/07: "o check-in permanece restrito
 * por IP para prevenir fraudes").
 *
 * O que importa aqui não é a lista aparecer, é a faixa cadastrada passar a
 * valer: cada caso confere a gravação em `allowed_ips` e o efeito em
 * `ip_is_allowed`, que é a função que `perform_checkin` consulta. Cadastro que
 * mostra toast verde e não muda a decisão do check-in é pior que erro visível.
 *
 * Endereços de teste vêm de 203.0.113.0/24 (TEST-NET-3, RFC 5737): faixa
 * reservada para documentação, nunca roteável — cadastrá-la não libera nada.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

type FaixaIp = { id: string; ip_range: string; label: string; active: boolean };

const campoIp = (page: import("@playwright/test").Page) => page.getByPlaceholder(/^Ex: 200\./);
const campoDescricao = (page: import("@playwright/test").Page) => page.getByPlaceholder(/^Descrição/);

test.describe("IPs autorizados para check-in", () => {
  const tag = runTag();
  let brokerId = "";
  const rotulos: string[] = [];

  /** Rótulo único por caso — é por ele que o teste acha e limpa o que criou. */
  const rotuloPara = (caso: string) => {
    const rotulo = `E2E ${caso} ${tag}`;
    rotulos.push(rotulo);
    return rotulo;
  };
  const buscarPorRotulo = (rotulo: string) =>
    db.select<FaixaIp>(
      `allowed_ips?label=eq.${encodeURIComponent(rotulo)}&select=id,ip_range,label,active`,
    );

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
  });

  test.afterAll(async () => {
    for (const rotulo of rotulos) {
      await db.remove(`allowed_ips?label=eq.${encodeURIComponent(rotulo)}`);
    }
  });

  test("cadastrar uma faixa passa a liberar o check-in daquele IP", async ({ page }) => {
    const rotulo = rotuloPara("cadastro");
    const ip = "203.0.113.11";

    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: brokerId }),
      "cenário: o IP não podia estar liberado antes do cadastro",
    ).toBe(false);

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await campoIp(page).fill(ip);
    await campoDescricao(page).fill(rotulo);
    await page.getByRole("button", { name: /adicionar/i }).click();

    await expect(page.getByText(/IP autorizado/i)).toBeVisible();
    // Digitado sem máscara, guardado como host único.
    await expect(page.getByText(`${ip}/32`)).toBeVisible();

    const linhas = await buscarPorRotulo(rotulo);
    expect(linhas, "toast de sucesso sem linha gravada é tela mentindo").toHaveLength(1);
    expect(linhas[0].ip_range).toBe(`${ip}/32`);
    expect(linhas[0].active).toBe(true);
    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: brokerId }),
      "a faixa cadastrada precisa valer para o check-in",
    ).toBe(true);
  });

  test("cadastrar em CIDR cobre a faixa inteira, não só um host", async ({ page }) => {
    const rotulo = rotuloPara("faixa");
    const faixa = "203.0.113.128/25";

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await campoIp(page).fill(faixa);
    await campoDescricao(page).fill(rotulo);
    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(page.getByText(/IP autorizado/i)).toBeVisible();

    const linhas = await buscarPorRotulo(rotulo);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].ip_range, "máscara informada não pode virar /32").toBe(faixa);

    // Contenção resolvida pelo Postgres (<<), não por comparação de string.
    expect(await db.rpc<boolean>("ip_is_allowed", { candidate: "203.0.113.200", who: brokerId })).toBe(true);
    expect(await db.rpc<boolean>("ip_is_allowed", { candidate: "203.0.113.5", who: brokerId })).toBe(false);
  });

  test("desativar a faixa pela tela tira o IP do check-in", async ({ page }) => {
    const rotulo = rotuloPara("toggle");
    const ip = "203.0.113.21";
    await db.insert("allowed_ips", { label: rotulo, ip_range: `${ip}/32` });

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    const linha = page.getByText(`${ip}/32`).locator("xpath=..");
    await linha.getByText("ativo", { exact: true }).click();
    await expect(linha.getByText("inativo", { exact: true })).toBeVisible();

    const [gravada] = await buscarPorRotulo(rotulo);
    expect(gravada.active, "o estado do badge tem que estar no banco").toBe(false);
    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: brokerId }),
      "faixa inativa não pode continuar liberando check-in",
    ).toBe(false);
  });

  test("remover a faixa apaga a linha depois de confirmar", async ({ page }) => {
    const rotulo = rotuloPara("remocao");
    const ip = "203.0.113.31";
    await db.insert("allowed_ips", { label: rotulo, ip_range: `${ip}/32` });

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    const linha = page.getByText(`${ip}/32`).locator("xpath=..");
    // A remoção é confirmada por `window.confirm`; sem tratar o diálogo o
    // Playwright o dispensa e a linha continuaria lá.
    page.once("dialog", (d) => void d.accept());
    // O botão de lixeira não tem nome acessível (sem aria-label nem title) —
    // por isso a posição. Está no relatório como achado.
    await linha.getByRole("button").last().click();

    await expect(page.getByText(`${ip}/32`)).toHaveCount(0);
    expect(await buscarPorRotulo(rotulo)).toHaveLength(0);
  });

  test("descobrir o próprio IP preenche o formulário e diz se ele já está coberto", async ({ page }) => {
    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    // Depende de api.ipify.org (serviço externo chamado pelo próprio app) —
    // limitação registrada no relatório.
    await page.getByRole("button", { name: /descobrir meu ip/i }).click();
    await expect(campoIp(page)).toHaveValue(/^\d{1,3}(\.\d{1,3}){3}$/);

    const meuIp = await campoIp(page).inputValue();
    const adminId = await db.profileIdOf("admin");
    const coberto = await db.rpc<boolean>("ip_is_allowed", { candidate: meuIp, who: adminId });
    // O aviso é o que decide se o admin precisa cadastrar: comparar string na
    // tela diria "não cadastrado" para um IP já dentro de uma faixa /24.
    await expect(
      page.getByText(coberto ? /já coberto por uma faixa cadastrada/i : /não coberto/i),
    ).toBeVisible();
  });

  // A recusa vem como 400 do PostgREST, e o navegador loga isso no console: é a
  // prova de que o banco barrou, não um defeito da tela.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 400/i] });

  test("endereço inválido não entra na lista, e o erro sai em pt-BR", async ({ page }) => {
    const rotulo = rotuloPara("invalido");

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await campoIp(page).fill("nao-e-um-ip");
    await campoDescricao(page).fill(rotulo);
    await page.getByRole("button", { name: /adicionar/i }).click();

    // A recusa vem do tipo `cidr` do Postgres (SQLSTATE 22P02). Até a Tarefa D a
    // tela repassava a mensagem crua ("invalid input syntax for type cidr"), que
    // entrega o schema a quem estiver olhando e não diz o que fazer; hoje o
    // `describeError` traduz por código. O teste cobra as duas metades: a frase
    // em pt-BR aparece E a mensagem do Postgres não vaza.
    await expect(page.getByText(/um dos campos está em formato inválido/i)).toBeVisible();
    await expect(page.getByText(/invalid input syntax|for type cidr/i)).toHaveCount(0);
    expect(await buscarPorRotulo(rotulo), "entrada inválida não pode gravar").toHaveLength(0);
  });

  });
});
