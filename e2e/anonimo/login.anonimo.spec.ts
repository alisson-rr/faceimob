import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import { resolveTarget } from "../support/target";

/**
 * A porta de entrada, sem sessão.
 *
 * A ata de 23/07 pediu login por código no e-mail para tirar senha do banco.
 * A decisão de 25/08 (`docs/sprints/decisoes.md`, Tarefa A) somou o login por
 * **senha** de volta: o código depende de SMTP configurado, e a demonstração ao
 * cliente não podia depender de caixa postal. Os dois caminhos convivem — a
 * senha mora no GoTrue (hash bcrypt), nunca em `public.profiles`, que é o que a
 * ata de fato proibia.
 *
 * O que este arquivo cobra: os dois caminhos existem na tela, a troca entre
 * eles funciona, e nenhuma das duas recusas conta ao visitante se o e-mail
 * está cadastrado.
 */
test.describe("login", () => {
  test("oferece senha por padrão e código como alternativa", async ({ page }) => {
    await page.goto("/login");
    await aguardarCarregamento(page);

    // Caminho padrão: e-mail + senha.
    await expect(page.getByPlaceholder("seu@email.com")).toBeVisible();
    await expect(page.getByPlaceholder("Sua senha")).toBeVisible();
    await expect(page.getByRole("button", { name: /^entrar$/i })).toBeVisible();

    // Alternativa: código de seis dígitos por e-mail.
    await page.getByRole("button", { name: /receber código por e-mail/i }).click();
    await expect(page.getByRole("button", { name: /enviar código/i })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    // A tela diz o que vai acontecer, não o que já aconteceu: antes o texto
    // afirmava "Enviamos um código de acesso para o seu e-mail" antes de
    // qualquer envio.
    await expect(page.getByText(/Informe o e-mail cadastrado para receber o acesso/i)).toBeVisible();

    // E dá para voltar — quem não tem SMTP não fica preso no caminho do código.
    await page.getByRole("button", { name: /entrar com senha/i }).click();
    await expect(page.getByPlaceholder("Sua senha")).toBeVisible();
  });

  test("rota protegida sem sessão manda para o login", async ({ page }) => {
    await page.goto("/pipeline");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByPlaceholder("seu@email.com")).toBeVisible();
  });

  // "/" deixou de ser um salto fixo para /dashboard e virou o ponto que escolhe
  // a primeira tela do papel; sem sessão tem de continuar caindo no login.
  test('a raiz "/" sem sessão manda para o login', async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByPlaceholder("seu@email.com")).toBeVisible();
  });

  // `/reset-password` é onde o link de recuperação do Supabase aterrissa. Sem
  // sessão (link vencido, ou URL digitada) o destino é o /login; com sessão
  // aberta pelo link, é a própria conta — que é onde se troca a senha.
  test("/reset-password sem sessão cai no login", async ({ page }) => {
    await page.goto("/reset-password");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByPlaceholder("seu@email.com")).toBeVisible();
  });

  test("guarda de rota não cai com variação de caixa nem barra final", async ({ page }) => {
    for (const rota of ["/Pipeline", "/pipeline/", "/ADMIN/permissions"]) {
      await page.goto(rota);
      await page.waitForURL(/\/login/, { timeout: 15_000 });
    }
  });

  // O GoTrue responde 400 para credencial inválida. O erro no console é do
  // protocolo; o que se cobra é a tela não deixar o motivo real escapar.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 4\d\d/i] });

    test("senha errada não distingue e-mail inexistente de senha inválida", async ({ page }) => {
      await page.goto("/login");
      await aguardarCarregamento(page);

      await page.getByPlaceholder("seu@email.com").fill("nao.existe@faceimob.test");
      await page.getByPlaceholder("Sua senha").fill("valor-invalido-de-teste");
      await page.getByRole("button", { name: /^entrar$/i }).click();

      // Mensagem única de propósito: a tela não pode virar um verificador de
      // quem trabalha na empresa.
      await expect(page.getByText(/e-mail ou senha inválidos/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/não cadastrad|inexistente|invalid login credentials/i)).toHaveCount(0);
      await expect(page).toHaveURL(/\/login/);
    });

    test("código para e-mail desconhecido não revela se a conta existe", async ({ page }) => {
      await page.goto("/login");
      await aguardarCarregamento(page);
      await page.getByRole("button", { name: /receber código por e-mail/i }).click();

      await page.getByPlaceholder("seu@email.com").fill("nao.existe@faceimob.test");
      await page.getByRole("button", { name: /enviar código/i }).click();

      // A alternância antiga (`/…|código/i`) casava o próprio botão "Enviar
      // código" e passava sem toast nenhum. Hoje sucesso e recusa escrevem a
      // MESMA frase — é o que torna as duas indistinguíveis para quem está de
      // fora, que é o ponto.
      await expect(
        page.getByText(/Se este e-mail estiver cadastrado, a mensagem de acesso/i).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/signup|not allowed|não cadastrad|inexistente/i)).toHaveCount(0);

      // E a frase não pode PROMETER entrega: ela é a mesma do toast de recusa,
      // e no remoto o SMTP nem está configurado — "chega em instantes"
      // afirmava justamente no momento em que o envio tinha sido recusado.
      await expect(page.getByText(/chega em instantes/i)).toHaveCount(0);

      // E o aviso não pode prometer seis dígitos: o modelo de e-mail (Magic
      // Link) ainda não foi publicado e o que chega é um LINK de acesso.
      await expect(page.getByText(/um código de 6 dígitos para/i)).toHaveCount(0);
    });
  });

  test("diz o que fazer quando a senha foi esquecida", async ({ page }) => {
    // Não existe autoatendimento de redefinição (nem rota `/reset-password`
    // útil). O que a tela não pode é ficar muda: quem esqueceu a senha ficava
    // procurando um link que não existe.
    await page.goto("/login");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /esqueci minha senha/i }).click();
    await expect(page.getByText(/administrador da Faceimob para redefinir/i)).toBeVisible();

    // Dizer o caminho não basta se ele continuar a três cliques de distância:
    // o botão leva direto ao único jeito de entrar sem saber a senha.
    await page.getByRole("button", { name: /entrar por código no e-mail/i }).click();
    await expect(page.getByRole("button", { name: /enviar código/i })).toBeVisible();
  });
});

/**
 * O login por senha acontecendo de verdade.
 *
 * Nenhum spec preenchia e-mail + senha: a suíte inteira nasce de sessão criada
 * pela Admin API, então o formulário nunca era exercitado. Aqui a conta é
 * descartável, a senha é sorteada na hora (nada de credencial versionada, nem
 * de teste) e a conta some no fim.
 *
 * O perfil fica SEM papel de propósito. `handle_new_auth_user` dá 'broker' a
 * todo perfil novo, e um corretor sem equipe cairia no Dashboard com dados de
 * ninguém; sem papel nenhum o destino é o fallback `/settings` — que é
 * exatamente a garantia que interessa provar: ninguém termina o login em
 * "Acesso não liberado".
 *
 * Isso só é verdade porque `/settings` FICOU DE FORA de `ROUTE_PERMISSION`
 * (src/lib/routePermissions.ts). Enquanto a rota exigia `menu.settings`, este
 * teste era a prova de que o buraco existia: o fallback mandava para a única
 * tela que o guard também negava. Se alguém devolver a linha ao mapa, é aqui
 * que o alarme toca.
 */
test.describe.serial("login por senha (conta descartável)", () => {
  const alvo = resolveTarget();
  const email = "e2e.login-senha@faceimob.test";
  const senha = `E2E-${Math.random().toString(36).slice(2, 10)}-Aa1!`;
  let userId = "";

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

  const acharConta = async (): Promise<string | null> => {
    const lista = await adminApi(`/auth/v1/admin/users?filter=${encodeURIComponent(email)}`);
    return (lista?.users ?? []).find((u: { email?: string }) => u.email === email)?.id ?? null;
  };

  test.beforeAll(async () => {
    const anterior = await acharConta();
    if (anterior) await adminApi(`/auth/v1/admin/users/${anterior}`, { method: "DELETE" });

    const criada = await adminApi("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { full_name: "E2E Login Senha", e2e: true },
      }),
    });
    userId = criada.id as string;
    await db.remove(`user_roles?profile_id=eq.${userId}`);
  });

  test.afterAll(async () => {
    if (userId) await adminApi(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
  });

  const entrar = async (page: import("@playwright/test").Page) => {
    await page.getByPlaceholder("seu@email.com").fill(email);
    await page.getByPlaceholder("Sua senha").fill(senha);
    await page.getByRole("button", { name: /^entrar$/i }).click();
  };

  test("entra com a senha certa e /login deixa de aparecer para quem já entrou", async ({ page }) => {
    await page.goto("/login");
    await aguardarCarregamento(page);
    await entrar(page);

    await page.waitForURL(/\/settings\/?$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /^Configurações$/ })).toBeVisible();

    // A rota /login fica fora do RequireAuth: a tela aparecia normalmente para
    // usuário logado — inclusive para quem chega pelo link do e-mail, que já
    // abre sessão (`detectSessionInUrl`) e ficava olhando o formulário.
    await page.goto("/login");
    await page.waitForURL(/\/settings\/?$/, { timeout: 20_000 });
    await expect(page.getByPlaceholder("Sua senha")).toHaveCount(0);
  });

  test("volta para o link que a pessoa pediu, não para a home", async ({ page }) => {
    await page.goto("/atividades");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await aguardarCarregamento(page);
    await entrar(page);

    // O que se prova é o DESTINO, não a permissão: sem papel nenhum a tela de
    // /atividades é o bloqueio — mas é o /atividades, e não a home.
    await page.waitForURL(/\/atividades\/?$/, { timeout: 20_000 });
    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
  });

  /**
   * O código de acesso DIGITADO NA TELA.
   *
   * A suíte inteira nasce de sessão criada fora do navegador
   * (`e2e/support/session.ts`), então ninguém nunca tinha preenchido o campo de
   * seis dígitos: o `verifyOtp` da tela não tinha teste nenhum.
   *
   * O código vem da Admin API, não da caixa de entrada — `generate_link`
   * regrava o token do usuário e devolve o valor atual sem enviar e-mail. A
   * origem do código não muda o que está sob teste, que é o formulário.
   */
  test("o código digitado na tela abre a sessão", async ({ page }) => {
    test.skip(
      alvo.name !== "local",
      "o pedido do código depende do Mailpit do stack local: no projeto remoto o SMTP ainda não " +
        "está configurado (Authentication → Emails → SMTP Settings) e o envio falha antes da tela " +
        "chegar ao passo do código.",
    );

    await page.goto("/login");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /receber código por e-mail/i }).click();
    await page.getByPlaceholder("seu@email.com").fill(email);
    await page.getByRole("button", { name: /enviar código/i }).click();

    const campo = page.getByLabel("Código de acesso");
    await expect(campo).toBeVisible({ timeout: 20_000 });

    // O passo do código é o único lugar onde os DOIS limites reais do envio
    // cabem escritos, e a tela citava só um deles (o template). O SMTP é o mais
    // duro: sem ele o remetente embutido recusa endereço fora da equipe do
    // projeto, e para o corretor não chega nada.
    await expect(page.getByText(/SMTP Settings/i)).toBeVisible();
    await expect(page.getByText(/Magic Link/i)).toBeVisible();

    const link = await adminApi("/auth/v1/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({ type: "magiclink", email }),
    });
    await campo.fill(String(link.email_otp));
    await page.getByRole("button", { name: /^entrar$/i }).click();

    // Sem papel nenhum, o destino é o fallback do pós-login.
    await page.waitForURL(/\/settings\/?$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /^Configurações$/ })).toBeVisible();
  });

  /**
   * O destino do pós-login para cca, sdr e marketing, no navegador.
   *
   * A garantia dos sete papéis era só unitária (`src/lib/routePermissions.test.ts`)
   * e com a matriz COPIADA para dentro do teste: se a matriz do banco mudasse,
   * o teste continuaria verde. Aqui quem responde é o banco.
   *
   * O que se cobra é o INVARIANTE, não a rota. `firstAllowedRoute` existe para
   * que a primeira tela do sistema nunca seja "Acesso não liberado"; a rota do
   * cca ainda muda quando `/cca` passar para antes de `/pipeline` em
   * `NAV_ITEMS` (decisão de 02/09), e fixar "/pipeline" aqui só criaria um
   * teste para reescrever no mesmo dia.
   *
   * Contexto de navegador novo a cada papel: a matriz de permissões é lida uma
   * vez por sessão, então trocar o papel sem trocar a sessão não mudaria nada.
   */
  test("cca, sdr e marketing entram numa tela liberada, nunca no bloqueio", async ({ browser, baseURL }) => {
    for (const papel of ["cca", "sdr", "marketing"] as const) {
      await db.remove(`user_roles?profile_id=eq.${userId}`);
      await db.insert("user_roles", { profile_id: userId, role: papel });

      const contexto = await browser.newContext({ baseURL: baseURL! });
      const pagina = await contexto.newPage();
      try {
        await pagina.goto("/login");
        await aguardarCarregamento(pagina);
        await entrar(pagina);

        await pagina.waitForURL((u) => u.pathname !== "/" && !u.pathname.startsWith("/login"), { timeout: 20_000 });
        await aguardarCarregamento(pagina);
        await expect(
          pagina.getByText(/acesso não liberado/i),
          `${papel} terminou o login no bloqueio de permissão`,
        ).toHaveCount(0);
      } finally {
        await contexto.close();
      }
    }
    await db.remove(`user_roles?profile_id=eq.${userId}`);
  });

  test.describe(() => {
    test.use({ errosEsperados: [/status of 4\d\d/i] });

    /**
     * Conta bloqueada.
     *
     * O ramo existia no código e nada o exercitava: quem estava barrado lia
     * "E-mail ou senha inválidos" e repetia a senha CERTA. A conta é banida e
     * desbanida aqui dentro — as contas `seed.*` são banidas de propósito, mas
     * a senha delas não é conhecida, e sem a senha certa o GoTrue responde
     * "credencial inválida" e o ramo nunca seria alcançado.
     */
    test("conta bloqueada diz que está bloqueada, não que a senha está errada", async ({ page }) => {
      await adminApi(`/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ ban_duration: "24h" }),
      });
      try {
        await page.goto("/login");
        await aguardarCarregamento(page);
        await entrar(page);

        await expect(page.getByText(/Este acesso está bloqueado/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/e-mail ou senha inválidos/i)).toHaveCount(0);
        await expect(page).toHaveURL(/\/login/);
      } finally {
        await adminApi(`/auth/v1/admin/users/${userId}`, {
          method: "PUT",
          body: JSON.stringify({ ban_duration: "none" }),
        });
      }
    });
  });
});
