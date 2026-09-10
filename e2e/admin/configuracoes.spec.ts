import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import { mintSession, storageStateFor } from "../support/session";
import { resolveTarget } from "../support/target";
import type { Browser, Page } from "@playwright/test";

/**
 * A tela de Configurações nunca tinha teste de botão nenhum.
 *
 * A única cobertura era `rotas-positivas.spec.ts`, que confere o cabeçalho. Os
 * dois controles da tela são justamente os que não dá para "quase" testar:
 * trocar a senha e encerrar todas as sessões. Os dois derrubam a sessão de quem
 * clica — por isso o que os exercita roda numa CONTA DESCARTÁVEL, em contexto
 * de navegador próprio: usar a sessão do admin da suíte invalidaria o token dos
 * outros specs no meio da execução.
 *
 * A senha é sorteada a cada execução: credencial, nem de teste, não se versiona.
 */
const alvo = resolveTarget();
const EMAIL = "e2e.configuracoes@faceimob.test";

/**
 * PNG de 1×1 de verdade. O bucket `avatars` tem `allowed_mime_types`, então um
 * buffer arbitrário com nome `.png` seria recusado no servidor e o teste
 * passaria a medir a recusa, não a subida.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const adminApi = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${alvo.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: alvo.serviceRoleKey,
      Authorization: `Bearer ${alvo.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const corpo = await res.text();
  return corpo ? JSON.parse(corpo) : null;
};

/** Autenticação crua, fora do navegador: é a prova de que a senha mudou mesmo. */
const tentarSenha = (email: string, password: string) =>
  fetch(`${alvo.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: alvo.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

const tentarRefresh = (refreshToken: string) =>
  fetch(`${alvo.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: alvo.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

test.describe("configurações · admin", () => {
  test("mostra a conta, o perfil e os dois controles de segurança", async ({ page }) => {
    await page.goto("/settings");
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: /^Configurações$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();
    await expect(page.getByLabel("Nome completo")).toBeVisible();
    await expect(page.getByLabel("Telefone")).toBeVisible();
    await expect(page.getByLabel("Nova senha", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /encerrar todas as sessões/i })).toBeVisible();
  });

  /**
   * Os próprios papéis e a própria posição na estrutura.
   *
   * Para saber quem é o seu gerente era preciso abrir **Equipes** — tela de
   * administração que o corretor nem sempre enxerga. Os papéis já estavam na
   * sessão e não apareciam em lugar nenhum da conta.
   */
  test("a conta mostra os próprios papéis e a própria equipe", async ({ page }) => {
    await page.goto("/settings");
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: "Seu acesso" })).toBeVisible();
    await expect(page.getByText("Administrador", { exact: true })).toBeVisible();

    // Equipe: ou o nome, ou a frase de quem não está em nenhuma. O que não
    // pode aparecer é o estado de carregando parado nem a falha de leitura.
    await expect(
      page.getByText(/Você não está em nenhuma equipe|^Equipe$/).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Não foi possível carregar sua equipe/i)).toHaveCount(0);
  });

  // O link de recuperação do Supabase aterrissa em /reset-password. Com sessão
  // aberta, quem chega ali veio trocar a senha — e o lugar da senha é a conta,
  // não o formulário de login.
  test("/reset-password com sessão leva à conta, onde a senha se troca", async ({ page }) => {
    await page.goto("/reset-password");
    await page.waitForURL(/\/settings\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Senha de acesso" })).toBeVisible();
  });

  /**
   * A foto subia sem validação nenhuma: `accept` é filtro do seletor de
   * arquivo, não validação, e o bucket estava sem `file_size_limit` e sem
   * `allowed_mime_types` — a mensagem de erro prometia "até 5 MB" que ninguém
   * aplicava. Os dois casos são recusados no cliente, antes da subida, então
   * nada chega ao Storage e a foto do admin fica como estava.
   */
  test("recusa arquivo que não é imagem e imagem acima de 5 MB", async ({ page }) => {
    await page.goto("/settings");
    await aguardarCarregamento(page);

    const campo = page.getByLabel("Arquivo da foto de perfil");

    await campo.setInputFiles({
      name: "curriculo.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("isto não é uma foto"),
    });
    await expect(page.getByText(/Formato não aceito/i)).toBeVisible({ timeout: 10_000 });

    await campo.setInputFiles({
      name: "gigante.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    await expect(page.getByText(/Imagem muito grande/i)).toBeVisible({ timeout: 15_000 });

    // Recusa é recusa: nada foi trocado.
    await expect(page.getByText(/Foto atualizada/i)).toHaveCount(0);
  });

  test("encerrar todas as sessões pergunta antes e o cancelar não derruba ninguém", async ({ page }) => {
    // Era um clique só: derrubava o próprio usuário e todos os dispositivos sem
    // pergunta nenhuma. O caminho do "sim" é exercitado na conta descartável.
    await page.goto("/settings");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /encerrar todas as sessões/i }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(/Encerrar todas as sessões\?/)).toBeVisible();

    await page.getByRole("button", { name: /^cancelar$/i }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: /^Configurações$/ })).toBeVisible();
  });

  /**
   * CCA, SDR e Gerente nunca tinham sido conferidos na prévia — só "Corretor".
   * São os três papéis cujo menu ninguém tinha visto por teste.
   */
  test("prévia cobre CCA, SDR e Gerente, e o bloqueio diz que é da prévia", async ({ page }) => {
    const seletor = page.getByRole("combobox", { name: "Pré-visualizar como papel" });

    await page.goto("/settings");
    await aguardarCarregamento(page);

    // O limite da ferramenta chega ao leitor de tela por `aria-describedby` do
    // gatilho — o parágrafo dentro do listbox do Radix não é anunciado.
    //
    // A conferência tem de vir ANTES do clique: com a lista aberta, o Radix
    // chama `hideOthers()` e marca `aria-hidden` em tudo que está fora do
    // popover, INCLUSIVE no gatilho. Nesse instante ele sai da árvore de
    // acessibilidade e `getByRole('combobox')` não acha mais nada — era isto,
    // e não a falta de nome acessível, que derrubava este teste.
    await expect(seletor).toHaveAttribute("aria-describedby", /.+/);

    await seletor.click();
    // Com a lista aberta, quem carrega o aviso é o nome do próprio listbox:
    // é o que o leitor de tela anuncia na abertura, quando o gatilho já saiu
    // da árvore. O parágrafo visível é a mesma frase para quem enxerga.
    await expect(page.getByRole("listbox", { name: /A prévia troca menus e botões/i })).toBeVisible();
    await expect(page.getByText(/A prévia troca menus e botões/i).first()).toBeVisible();
    await page.getByRole("option", { name: "Ver como CCA" }).click();

    // O cca não tem `menu.dashboard`. A prévia sobrevive à navegação (fica na
    // aba), então o bloqueio aparece — e precisa dizer de quem ele é.
    await page.goto("/dashboard");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
    await expect(page.getByText(/pré-visualizando outro papel/i)).toBeVisible();

    // E a esteira dele abre.
    await page.goto("/cca");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);

    // SDR: sem pipeline, com o módulo dele.
    await seletor.click();
    await page.getByRole("option", { name: "Ver como SDR" }).click();
    await page.goto("/pipeline");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);

    // Gerente: abre o Checkpoint, não abre a administração de permissões.
    await seletor.click();
    await page.getByRole("option", { name: "Ver como Gerente" }).click();
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
    await page.goto("/admin/permissions");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();

    // Sair da prévia devolve tudo: prévia que não volta é tela quebrada.
    await seletor.click();
    await page.getByRole("option", { name: "Administrador (você)" }).click();
    await page.goto("/admin/permissions");
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
  });
});

test.describe.serial("configurações · conta descartável", () => {
  const senhaInicial = `E2E-${Math.random().toString(36).slice(2, 10)}-Aa1!`;
  const senhaNova = `E2E-${Math.random().toString(36).slice(2, 10)}-Zz9!`;
  let userId = "";

  const acharConta = async (): Promise<string | null> => {
    const lista = await adminApi(`/auth/v1/admin/users?filter=${encodeURIComponent(EMAIL)}`);
    return (lista?.users ?? []).find((u: { email?: string }) => u.email === EMAIL)?.id ?? null;
  };

  /** Contexto próprio: a sessão do admin da suíte não pode ser derrubada aqui. */
  const abrirComo = async (browser: Browser, baseURL: string) => {
    const sessao = await mintSession(EMAIL);
    const contexto = await browser.newContext({ baseURL, storageState: storageStateFor(sessao, baseURL) });
    const pagina = await contexto.newPage();
    return { sessao, contexto, pagina };
  };

  const preencherSenha = async (pagina: Page, senha: string) => {
    await pagina.getByLabel("Nova senha", { exact: true }).fill(senha);
    await pagina.getByLabel("Repita a nova senha").fill(senha);
    await pagina.getByRole("button", { name: /salvar senha/i }).click();
  };

  test.beforeAll(async () => {
    const anterior = await acharConta();
    if (anterior) await adminApi(`/auth/v1/admin/users/${anterior}`, { method: "DELETE" });

    const criada = await adminApi("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: EMAIL,
        password: senhaInicial,
        email_confirm: true,
        user_metadata: { full_name: "E2E Configuracoes", e2e: true },
      }),
    });
    userId = criada.id as string;
    // Sem papel nenhum: `/settings` não exige permissão de rota (ver
    // `firstAllowedRoute` em src/lib/routePermissions.ts — um fallback guardado
    // não é fallback), então esta é também a prova de que a conta mais nua
    // possível ainda abre a própria conta.
    await db.remove(`user_roles?profile_id=eq.${userId}`);
  });

  test.afterAll(async () => {
    if (userId) await adminApi(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
  });

  test("a pessoa edita o próprio nome e telefone", async ({ browser, baseURL }) => {
    const { contexto, pagina } = await abrirComo(browser, baseURL!);
    const nome = `E2E Configuracoes ${Date.now()}`;
    try {
      await pagina.goto("/settings");
      await expect(pagina.getByLabel("Nome completo")).toHaveValue(/E2E Configuracoes/);

      await pagina.getByLabel("Nome completo").fill(nome);
      await pagina.getByLabel("Telefone").fill("(51) 99999-1234");
      await pagina.getByRole("button", { name: /salvar perfil/i }).click();
      await expect(pagina.getByText(/Perfil salvo/i)).toBeVisible({ timeout: 15_000 });

      // O toast só vale se o banco confirmou: `update` sem `select` responde
      // 204 mesmo quando a RLS não deixou tocar em nada.
      await expect
        .poll(async () => {
          const [row] = await db.select<{ full_name: string; phone: string | null }>(
            `profiles?id=eq.${userId}&select=full_name,phone`,
          );
          return row;
        })
        .toMatchObject({ full_name: nome, phone: "(51) 99999-1234" });
    } finally {
      await contexto.close();
    }
  });

  /**
   * A subida que DÁ CERTO nunca tinha sido exercitada: a cobertura era só das
   * duas recusas (arquivo que não é imagem e imagem acima de 5 MB), e um
   * caminho feliz que só existe no código não prova nada — bastava a policy
   * `avatars_write` mudar de forma da pasta para a foto parar de subir sem
   * nenhum teste vermelho.
   *
   * Um PNG de 1×1 real (não um buffer qualquer com nome .png): o bucket tem
   * `allowed_mime_types`, então conteúdo inválido seria recusado no servidor e
   * o teste passaria a medir outra coisa.
   */
  test("a foto sobe e o endereço fica gravado no perfil", async ({ browser, baseURL }) => {
    const { contexto, pagina } = await abrirComo(browser, baseURL!);
    try {
      await pagina.goto("/settings");
      await aguardarCarregamento(pagina);

      await pagina.getByLabel("Arquivo da foto de perfil").setInputFiles({
        name: "retrato.png",
        mimeType: "image/png",
        buffer: PNG_1X1,
      });

      await expect(pagina.getByText(/Foto atualizada/i)).toBeVisible({ timeout: 20_000 });

      // O toast só vale se o banco confirmou. A conta nasce sem foto, então
      // "deixou de ser nulo" é a prova de que a gravação aconteceu agora.
      await expect
        .poll(async () => {
          const [row] = await db.select<{ avatar_url: string | null }>(
            `profiles?id=eq.${userId}&select=avatar_url`,
          );
          return row?.avatar_url;
        }, { timeout: 20_000 })
        .toContain(`${userId}/`);
    } finally {
      await contexto.close();
    }
  });

  test("trocar a senha grava no GoTrue e encerra as sessões abertas", async ({ browser, baseURL }) => {
    const { sessao, contexto, pagina } = await abrirComo(browser, baseURL!);
    try {
      await pagina.goto("/settings");
      await preencherSenha(pagina, senhaNova);

      await expect(pagina.getByText(/Senha salva|Confirme que é você/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(
        pagina.getByText(/Confirme que é você/i),
        'O projeto está com a reautenticação por e-mail ligada: a troca de senha passa a depender do ' +
          'código enviado por e-mail, e o SMTP ainda não está configurado (Authentication → Emails).',
      ).toHaveCount(0);
      // O aviso de revogação falha: a tela só pode dizer "encerramos as sessões"
      // depois de o `signOut({ scope: 'global' })` responder sem erro.
      await expect(pagina.getByText(/as outras sessões continuam abertas/i)).toHaveCount(0);

      // A troca derruba todas as sessões, inclusive esta — é o que a tela avisa.
      await pagina.waitForURL(/\/login/, { timeout: 20_000 });

      const comNova = await tentarSenha(EMAIL, senhaNova);
      expect(comNova.status, "a senha nova precisa entrar").toBe(200);

      const comAntiga = await tentarSenha(EMAIL, senhaInicial);
      expect(comAntiga.ok, "a senha antiga precisa parar de valer").toBe(false);

      const refresh = await tentarRefresh(sessao.refresh_token);
      expect(refresh.ok, "o refresh token de antes da troca precisa morrer").toBe(false);
    } finally {
      await contexto.close();
    }
  });

  test("encerrar todas as sessões derruba a sessão de verdade", async ({ browser, baseURL }) => {
    const { sessao, contexto, pagina } = await abrirComo(browser, baseURL!);
    try {
      await pagina.goto("/settings");
      await pagina.getByRole("button", { name: /encerrar todas as sessões/i }).click();
      await expect(pagina.getByRole("alertdialog")).toBeVisible();
      await pagina.getByRole("button", { name: /encerrar tudo/i }).click();

      await pagina.waitForURL(/\/login/, { timeout: 20_000 });

      // A única prova possível: o token que valia deixou de valer.
      const refresh = await tentarRefresh(sessao.refresh_token);
      expect(refresh.ok, "o refresh token precisa ser revogado").toBe(false);
    } finally {
      await contexto.close();
    }
  });
});
