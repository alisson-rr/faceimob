import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { BrandMotif } from "@/components/shared/BrandMotif";
import { ArrowLeft, KeyRound, Lock, Mail } from "lucide-react";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

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

type Mode = "password" | "otp";

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("password");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (mode === "otp" && step === "code") codeInputRef.current?.focus();
  }, [mode, step]);

  /** Unico ponto que marca a sessao como recem-aberta — vale nos dois caminhos. */
  const enter = () => {
    sessionStorage.setItem("faceimob-just-logged", "true");
    navigate("/dashboard");
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
      setPassword("");
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
      // Rate limit tem mensagem própria; o resto vira uma resposta única para
      // não revelar quais e-mails existem no sistema.
      const rateLimited = /rate|limit|seconds/i.test(error.message);
      return toast({
        title: rateLimited ? "Aguarde para pedir outro código" : "Não foi possível enviar",
        description: rateLimited
          ? "Já enviamos um código há pouco. Espere um minuto e tente de novo."
          : "Se este e-mail estiver cadastrado, o código chegará em instantes.",
        variant: "destructive",
      });
    }

    setEmail(target);
    setStep("code");
    setCooldown(RESEND_SECONDS);
    toast({ title: "Código enviado", description: `Enviamos um código de ${CODE_LENGTH} dígitos para ${target}.` });
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
          <img src={logoWhite} alt="" aria-hidden className="mx-auto mb-8 h-10 object-contain lg:hidden" />

          <Card className="border-border">
            <CardHeader className="space-y-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">Entrar no CRM</h1>
              <CardDescription>
                {mode === "password"
                  ? "Use o e-mail e a senha cadastrados."
                  : step === "email"
                    ? "Enviamos um código de acesso para o seu e-mail."
                    : `Digite o código enviado para ${email}`}
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
