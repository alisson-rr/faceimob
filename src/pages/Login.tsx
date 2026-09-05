import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { BrandMotif } from "@/components/shared/BrandMotif";
import { ArrowLeft, KeyRound, Lock, Mail } from "lucide-react";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { supabase } from "@/integrations/supabase/client";
import { classifyLoginError } from "@/lib/loginErrors";
import { safeRedirect } from "@/lib/routePermissions";
import { toast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/**
 * Duas formas de entrar (decisao do cliente em 21/08/2026, que reverte a de
 * 02/08): senha como padrao e codigo por e-mail como alternativa. A proibicao
 * de senha nasceu da senha em texto puro do Bubble — no Supabase Auth o hash
 * fica no servidor e nunca passa pelo nosso codigo.
 *
 * `shouldCreateUser: false` continua sendo a trava que importa no caminho do
 * codigo: sem ela o Supabase cria conta para qualquer e-mail digitado e a tela
 * de login vira auto-cadastro. Conta so por `provision-broker-user`.
 *
 * Erro de senha tem mensagem unica de proposito: dizer "e-mail nao encontrado"
 * transforma a tela em um verificador de quem trabalha aqui.
 */
const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

/**
 * Mesma frase no sucesso e na recusa: fora o rate limit, a tela nao pode dizer
 * se o e-mail existe.
 *
 * NAO promete entrega. Ela e tambem a descricao do toast de FALHA do envio, e
 * "chega em instantes" afirmava justamente no momento em que o GoTrue tinha
 * acabado de recusar. Pior: sem SMTP configurado (ver `AVISO_TEMPLATE`), o
 * remetente embutido do Supabase recusa endereco fora da equipe do projeto —
 * para o corretor, nada chega mesmo no caminho de sucesso.
 */
const AVISO_ENVIO =
  "Se este e-mail estiver cadastrado, a mensagem de acesso será enviada. Se nada chegar, fale com um administrador da Faceimob — o envio depende de configuração do servidor.";

/**
 * O estado real do envio, escrito na tela. Sao DOIS bloqueios, nao um:
 *
 *   1. O SMTP nunca foi configurado no projeto remoto
 *      (`docs/sprints/decisoes.md`). O remetente embutido do Supabase so
 *      entrega para endereco da equipe do projeto e tem cota baixa por hora —
 *      para quem nao esta na equipe, o e-mail simplesmente nao chega.
 *   2. O template de Magic Link tambem nao foi publicado, entao o GoTrue manda
 *      o modelo padrao: um LINK, nao seis digitos.
 *
 * A tela citava so o (2) e prometia entrega. Enquanto ela pedia codigo e
 * prometia codigo, quem abria o e-mail achava que o envio tinha falhado; e quem
 * nao recebia nada ficava esperando uma mensagem que nunca sairia.
 */
const AVISO_TEMPLATE =
  "O envio de e-mail deste projeto ainda não está configurado (Authentication → Emails → SMTP Settings) e o modelo de código não foi publicado (Authentication → Emails → Magic Link). Enquanto isso, a mensagem pode não chegar; se chegar, vem como link de acesso em vez de código — clicar no link também entra.";

/**
 * Falha de rede não é recusa de credencial.
 *
 * A frase precisa dizer as duas coisas: que o servidor não respondeu e que o
 * que a pessoa digitou pode estar certo. Sem a segunda metade, quem lê "não
 * conseguimos entrar" troca a senha CERTA achando que errou.
 */
const AVISO_REDE =
  "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo — o que você digitou pode estar certo.";
const AVISO_BLOQUEIO = "Este acesso está bloqueado. Fale com um administrador da Faceimob.";
const AVISO_RATE = "Muitas tentativas seguidas. Espere um minuto e tente de novo.";

type Mode = "password" | "otp";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const [mode, setMode] = useState<Mode>("password");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (mode === "otp" && step === "code") codeInputRef.current?.focus();
  }, [mode, step]);

  /**
   * Unico ponto que marca a sessao como recem-aberta — vale nos dois caminhos.
   *
   * O padrao e "/", nao "/dashboard": quem e so cca, sdr ou marketing nao tem
   * `menu.dashboard` e cairia em "Acesso nao liberado" logo apos entrar. Quem
   * escolhe a tela e `HomeRedirect` (App.tsx), que roda depois de a matriz de
   * permissoes carregar — aqui o `can` ainda seria o de antes da sessao.
   *
   * Quando o guard barrou um link especifico, ele guardou o caminho em
   * `location.state.from` e e para la que se volta: abrir um link de /pipeline
   * sem sessao levava ao login e depois jogava na home, perdendo o que a pessoa
   * queria abrir.
   */
  const enter = () => {
    sessionStorage.setItem("faceimob-just-logged", "true");
    navigate(safeRedirect(location.state), { replace: true });
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const target = email.trim().toLowerCase();
    if (!target || !password) {
      return setFormError("Informe o e-mail e a senha.");
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: target, password });
    setLoading(false);

    if (error) {
      // Excesso de tentativas, conta bloqueada e QUEDA DE REDE ficavam sob a
      // mesma frase de "senha inválida": quem estava barrado — ou sem conexão —
      // repetia a senha CERTA sem entender. A mensagem genérica continua
      // valendo para o resto: é ela que impede a tela de virar um verificador
      // de quem trabalha aqui.
      const motivo = classifyLoginError(error);
      // A senha só é apagada quando ela PODE ser o problema: limpar o campo
      // depois de uma queda de rede obriga a redigitar à toa.
      if (motivo === "credencial") setPassword("");
      if (motivo === "rede") return setFormError(AVISO_REDE);
      if (motivo === "rate") return setFormError(AVISO_RATE);
      if (motivo === "bloqueado") return setFormError(AVISO_BLOQUEIO);
      if (motivo === "nao_confirmado") {
        return setFormError("Este acesso ainda não foi confirmado. Fale com um administrador da Faceimob.");
      }
      return setFormError("E-mail ou senha inválidos.");
    }

    enter();
  };

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setFormError(null);
    const target = email.trim().toLowerCase();
    if (!target) {
      return toast({ title: "Informe seu e-mail", description: "Digite o e-mail cadastrado para receber o código.", variant: "destructive" });
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: target,
      options: { shouldCreateUser: false },
    });
    setLoading(false);

    if (error) {
      // Rate limit e queda de rede têm mensagem própria; o resto vira uma
      // resposta única para não revelar quais e-mails existem no sistema.
      // A rede sai do balde genérico porque ali o pedido nem saiu da máquina —
      // e o `AVISO_ENVIO` fala de um pedido que chegou ao servidor.
      const motivo = classifyLoginError(error);
      if (motivo === "rede") {
        return toast({ title: "Sem resposta do servidor", description: AVISO_REDE, variant: "destructive" });
      }
      const rateLimited = motivo === "rate";
      return toast({
        title: rateLimited ? "Aguarde para pedir outro acesso" : "Não foi possível enviar",
        description: rateLimited
          ? "Já pedimos um acesso há pouco. Espere um minuto e tente de novo."
          : AVISO_ENVIO,
        variant: "destructive",
      });
    }

    setEmail(target);
    setStep("code");
    setCooldown(RESEND_SECONDS);
    // "Pedido enviado", e não "Código enviado": o que se confirma aqui é a
    // chamada ao GoTrue, não a entrega. Sem SMTP configurado o remetente
    // embutido recusa endereço fora da equipe do projeto, e o template de
    // Magic Link não publicado faz a mensagem (quando chega) vir como LINK, não
    // como seis dígitos — os dois limites estão escritos em `AVISO_TEMPLATE`,
    // no passo do código. A descrição é a mesma da recusa de propósito —
    // afirmar "enviamos para você" só quando a conta existe transformaria a
    // tela em um verificador de quem trabalha aqui.
    toast({ title: "Pedido enviado", description: AVISO_ENVIO });
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const token = code.trim();
    if (token.length !== CODE_LENGTH) {
      return toast({ title: "Código incompleto", description: `O código tem ${CODE_LENGTH} dígitos.`, variant: "destructive" });
    }

    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setLoading(false);

    if (error) {
      const motivo = classifyLoginError(error);
      // O código continua valendo: apagar o campo por causa de uma queda de
      // rede manda a pessoa pedir outro sem necessidade nenhuma.
      if (motivo === "rede") {
        return toast({ title: "Sem resposta do servidor", description: AVISO_REDE, variant: "destructive" });
      }
      if (motivo === "rate") {
        return toast({ title: "Muitas tentativas seguidas", description: AVISO_RATE, variant: "destructive" });
      }
      if (motivo === "bloqueado") {
        return toast({ title: "Acesso bloqueado", description: AVISO_BLOQUEIO, variant: "destructive" });
      }
      const expired = /expired/i.test(error.message);
      setCode("");
      codeInputRef.current?.focus();
      return toast({
        title: expired ? "Código expirado" : "Código inválido",
        description: expired ? "Peça um novo código para continuar." : "Confira os dígitos e tente novamente.",
        variant: "destructive",
      });
    }

    enter();
  };

  const backToEmail = () => {
    setStep("email");
    setCode("");
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setStep("email");
    setCode("");
    setPassword("");
    setFormError(null);
    setShowHelp(false);
  };

  const errorBlock = formError && (
    <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
      {formError}
    </p>
  );

  return (
    <div className="grid min-h-[100svh] w-full lg:grid-cols-[1.1fr_1fr]">
      {/* Painel de marca — o motivo do simbolo em escala grande */}
      <aside className="relative hidden overflow-hidden bg-brand-blue lg:flex lg:flex-col lg:justify-between lg:p-12">
        <BrandMotif className="opacity-70" />
        <img src={logoWhite} alt="Faceimob" className="relative h-11 w-auto self-start object-contain" />
        <div className="relative max-w-md">
          <h2 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-white xl:text-5xl">
            O primeiro imóvel de alguém começa aqui.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            Roleta de leads, pipeline de negócios, esteira de crédito e o placar da equipe —
            em uma tela só.
          </p>
        </div>
        <p className="relative text-xs text-white/60">CRM Faceimob</p>
      </aside>

      {/* Cartao de acesso */}
      <main className="relative flex items-center justify-center overflow-hidden bg-background p-5 sm:p-8">
        <BrandMotif className="opacity-30 lg:hidden" />

        <div className="animate-slide-up relative w-full max-w-md">
          {/* Mesmo contorno do sidebar (`AppSidebar.tsx`): nao existe asset de
              logo com letra escura — `logo-faceimob.png` e o mesmo desenho de
              letra branca —, entao no tema claro a arte vai sobre uma placa
              azul da marca. Sem isso a marca some no fundo quase branco, e este
              e o unico logo que aparece abaixo de 1024 px (o painel da esquerda
              e `lg:flex`). */}
          <img
            src={logoWhite}
            alt=""
            aria-hidden
            className={cn(
              "mx-auto mb-8 h-10 object-contain lg:hidden",
              isLight && "rounded-xl bg-brand-blue px-3 py-1.5",
            )}
          />

          <Card className="border-border">
            <CardHeader className="space-y-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">Entrar no CRM</h1>
              <CardDescription>
                {mode === "password"
                  ? "Use o e-mail e a senha cadastrados."
                  : step === "email"
                    ? "Informe o e-mail cadastrado para receber o acesso."
                    : `Confira a mensagem que enviamos para ${email}`}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {mode === "password" && (
                <form onSubmit={signInWithPassword} className="space-y-3" noValidate>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input
                      type="email"
                      autoComplete="email"
                      aria-label="E-mail"
                      aria-invalid={formError ? true : undefined}
                      placeholder="seu@email.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input
                      type="password"
                      autoComplete="current-password"
                      aria-label="Senha"
                      aria-invalid={formError ? true : undefined}
                      placeholder="Sua senha"
                      className="pl-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  {errorBlock}
                  <Button type="submit" size="lg" className="w-full" disabled={loading}>
                    {loading ? "Entrando…" : "Entrar"}
                  </Button>
                  {/* Não existe autoatendimento de redefinição: ligar o envio
                      do e-mail de recuperação depende do SMTP do projeto
                      (`/reset-password` já sabe o que fazer com o link quando
                      ele passar a chegar). Enquanto isso, a tela DIZ qual é o
                      caminho — e o oferece — em vez de deixar a pessoa
                      procurando um link que não existe. */}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowHelp((v) => !v)}
                      aria-expanded={showHelp}
                      className="rounded-full px-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  {showHelp && (
                    <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Você pode entrar por <strong className="font-medium text-foreground">código no e-mail</strong>{" "}
                        e definir uma senha nova em Configurações. Se o código não chegar, peça a um
                        administrador da Faceimob para redefinir a sua senha — hoje a redefinição
                        automática não é enviada por esta tela.
                      </p>
                      {/* O caminho que funciona fica a um clique, e não só
                          descrito: quem chegou aqui já não sabe a senha. */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => switchTo("otp")}
                      >
                        <KeyRound className="h-4 w-4" aria-hidden /> Entrar por código no e-mail
                      </Button>
                    </div>
                  )}
                </form>
              )}

              {mode === "otp" && step === "email" && (
                <form onSubmit={sendCode} className="space-y-3" noValidate>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input
                      type="email"
                      autoComplete="email"
                      aria-label="E-mail"
                      placeholder="seu@email.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full" disabled={loading}>
                    {loading ? "Enviando…" : "Enviar código"}
                  </Button>
                </form>
              )}

              {mode === "otp" && step === "code" && (
                <form onSubmit={verifyCode} className="space-y-3" noValidate>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input
                      ref={codeInputRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={CODE_LENGTH}
                      placeholder="000000"
                      aria-label="Código de acesso"
                      className="pl-10 text-center text-lg tracking-[0.4em]"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                  {/* O limite real do envio, escrito onde a pessoa espera o
                      código — sem isto a tela pede seis dígitos que o servidor
                      ainda não manda. */}
                  <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {AVISO_TEMPLATE}
                  </p>
                  <Button type="submit" size="lg" className="w-full" disabled={loading || code.length !== CODE_LENGTH}>
                    {loading ? "Verificando…" : "Entrar"}
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={backToEmail}
                      className="inline-flex items-center gap-1 rounded-full px-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Trocar e-mail
                    </button>
                    <button
                      type="button"
                      onClick={() => sendCode()}
                      disabled={cooldown > 0 || loading}
                      className="rounded-full px-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
                    </button>
                  </div>
                </form>
              )}

              <div className="flex items-center gap-3">
                <span className="divider-h flex-1" aria-hidden />
                <span className="text-eyebrow">ou</span>
                <span className="divider-h flex-1" aria-hidden />
              </div>

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => switchTo(mode === "password" ? "otp" : "password")}
                disabled={loading}
              >
                {mode === "password" ? (
                  <>
                    <KeyRound className="h-4 w-4" aria-hidden /> Receber código por e-mail
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" aria-hidden /> Entrar com senha
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Não consegue entrar? Fale com um administrador da Faceimob.
          </p>
        </div>
      </main>
    </div>
  );
}
