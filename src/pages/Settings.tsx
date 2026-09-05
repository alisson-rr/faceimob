import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Eye, EyeOff, KeyRound, LogOut, Settings as SettingsIcon, ShieldCheck, UserRound, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader, SectionCard } from '@/components/shared';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { listTeamLeaderNames } from '@/integrations/supabase/people';
import { EDITABLE_ROLES } from '@/integrations/supabase/permissions';
import { dbError, describeError } from '@/lib/supabaseError';
import { useAuth, type AppRole } from '@/contexts/AuthContext';

const MIN_PASSWORD = 8;

/**
 * Fronteira do upload de foto.
 *
 * `accept` no input é filtro do seletor de arquivo, não validação: quem arrasta
 * ou usa a API passa direto. E o toast de erro prometia "até 5 MB" sem ninguém
 * aplicar esse limite em lugar nenhum — o bucket `avatars` estava com
 * `file_size_limit` e `allowed_mime_types` nulos. A trava do servidor entra na
 * migration 0054 (vale também para `BrokerEditModal`); aqui é a mensagem clara
 * antes de gastar a subida.
 */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME = /^image\/(jpeg|png|webp)$/;
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * O GoTrue devolve o motivo em inglês e por `code` próprio — estes são os que o
 * próprio usuário provoca. O que não estiver aqui cai no `describeError`
 * compartilhado (que traduz código do Postgres) e, no limite, no `fallback` da
 * tela. Mensagem crua do provedor nunca chega ao usuário.
 */
const AUTH_ERRORS: Record<string, string> = {
  weak_password: `Senha fraca. Misture letras, números e ao menos ${MIN_PASSWORD} caracteres.`,
  same_password: 'A nova senha é igual à atual. Escolha outra.',
  reauthentication_not_valid: 'Código inválido ou expirado. Peça outro e tente de novo.',
  over_request_rate_limit: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
};

const authMessage = (error: unknown, fallback: string) => {
  const code = (error as { code?: string } | null)?.code;
  return (code && AUTH_ERRORS[code]) || describeError(error, fallback);
};

/**
 * Rótulo do papel em pt-BR.
 *
 * `EDITABLE_ROLES` (permissions.ts) é a lista da tela de Permissões e deixa
 * `admin` de fora de propósito — lá conceder linha para admin não muda nada.
 * Aqui a pergunta é outra ("quais são os MEUS papéis"), e omitir "admin"
 * esconderia justamente o papel mais forte de quem o tem.
 */
const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Administrador',
  ...Object.fromEntries(EDITABLE_ROLES.map((r) => [r.value, r.label])),
} as Record<AppRole, string>;

/** Equipe da pessoa e quem está acima dela. `null` = ainda não sabemos. */
type MeuAcesso = {
  equipe: string | null;
  gerente: string | null;
  diretor: string | null;
  /** A equipe carregou, os nomes de quem lidera não. Um é dado, o outro é falha. */
  semNomes: boolean;
};

/**
 * Conta do usuário: o próprio perfil e a segurança do acesso.
 *
 * Antes daqui só havia segurança, e o corretor precisava abrir **Equipes** —
 * tela de administração — para ver o próprio nome e telefone. O que ele pode
 * editar de si mesmo é exatamente o que a RLS permite: `profiles_update_self`
 * libera a linha e o gatilho `profiles_guard_admin_columns` (0012) barra
 * status, e-mail, datas e bypass de IP. Por isso o e-mail aparece só de leitura,
 * com o caminho certo escrito ("peça a um administrador") em vez de um campo que
 * o banco recusaria.
 *
 * A conta entra por código no e-mail e, pela decisão de 21/08, também por senha.
 * Com "Secure password change" ligado no projeto, o Supabase exige
 * reautenticação: pedimos o código por e-mail (`reauthenticate`) e refazemos a
 * chamada com ele como `nonce`.
 */
export default function Settings() {
  const { toast } = useToast();
  const { user, profile, roles, perfilFalhou, refreshProfile } = useAuth();

  // ── perfil ────────────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fotoQuebrada, setFotoQuebrada] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── senha ─────────────────────────────────────────────────────────────────
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [nonce, setNonce] = useState('');
  const [needsNonce, setNeedsNonce] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // ── sessões ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // ── meu acesso ────────────────────────────────────────────────────────────
  const [acesso, setAcesso] = useState<MeuAcesso | null>(null);
  const [acessoErro, setAcessoErro] = useState<string | null>(null);

  /**
   * Equipe, gerente e diretor da própria pessoa.
   *
   * Ninguém conseguia ver isso da própria conta: para saber quem é o seu
   * gerente era preciso abrir **Equipes**, que é tela de administração e que o
   * corretor nem sempre enxerga.
   *
   * O nome de quem lidera NÃO sai de `profiles`: `auth_visible_profiles()` não
   * sobe a hierarquia, e abrir a linha do gerente entregaria CPF e endereço
   * junto. Vem da view `team_leader_names` (migration 0079), que expõe só id,
   * nome e avatar de quem lidera equipe ativa.
   */
  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('team_members')
          .select('teams(name,manager_id,director_id)')
          .eq('profile_id', user.id)
          .is('left_at', null);
        if (error) throw dbError('minha equipe', error);

        type EquipeRow = { name: string; manager_id: string | null; director_id: string | null };
        const equipes = (data ?? [])
          .map((row) => {
            // O PostgREST devolve o embed "muitos-para-um" como objeto, mas a
            // forma muda com a relação que ele resolve: aceitar as duas custa
            // uma linha e evita um bloco em branco sem erro nenhum.
            const bruto = row.teams as EquipeRow | EquipeRow[] | null;
            return Array.isArray(bruto) ? bruto[0] ?? null : bruto;
          })
          .filter((t): t is EquipeRow => !!t);
        if (!equipes.length) {
          if (!cancelado) setAcesso({ equipe: null, gerente: null, diretor: null, semNomes: false });
          return;
        }

        // ponytail: a pessoa pode estar em mais de uma equipe ativa; aqui vale
        // a primeira. Vira lista quando o cadastro passar a permitir isso de
        // propósito — hoje é acidente de dado, não caso de uso.
        const equipe = equipes[0];
        const precisaDeNomes = !!(equipe.manager_id || equipe.director_id);
        let lideres: { id: string; full_name: string }[] = [];
        let semNomes = false;
        if (precisaDeNomes) {
          // Falha só nos NOMES não pode apagar o nome da equipe, que já veio.
          // E não pode virar "Sem gerente definido": isso é uma afirmação, e
          // seria falsa.
          try {
            lideres = await listTeamLeaderNames();
          } catch (err) {
            console.error('Falha ao ler os nomes de quem lidera a equipe:', err);
            semNomes = true;
          }
        }
        const nome = (id: string | null) => lideres.find((l) => l.id === id)?.full_name ?? null;
        if (!cancelado) {
          setAcesso({
            equipe: equipe.name,
            gerente: nome(equipe.manager_id),
            diretor: nome(equipe.director_id),
            semNomes,
          });
        }
      } catch (err) {
        // Silêncio aqui viraria "Sem equipe" para quem tem equipe — a mesma
        // mentira que este bloco existe para corrigir.
        if (!cancelado) setAcessoErro(describeError(err, 'Não foi possível carregar sua equipe.'));
      }
    })();

    return () => { cancelado = true; };
  }, [user?.id]);

  // O perfil chega depois da sessão; sem isto os campos abriam vazios e um
  // "Salvar" apressado apagaria o nome de quem já tinha.
  useEffect(() => {
    setName(profile?.name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.name, profile?.phone]);

  // Foto nova é outra URL: sem isto, uma troca depois de um link expirado
  // continuaria mostrando as iniciais.
  useEffect(() => { setFotoQuebrada(false); }, [profile?.avatar_url]);

  /**
   * Relê o perfil sem contaminar o resultado da gravação.
   *
   * `refreshProfile` só serve para o cabeçalho refletir o que acabou de ser
   * salvo. Devolve `false` em vez de propagar: quem chamou já gravou, e o que
   * a tela precisa dizer nesse caso é "salvou, mas recarregue" — nunca "não
   * salvou".
   */
  const reler = async (): Promise<boolean> => {
    try {
      await refreshProfile();
      return true;
    } catch (error) {
      console.error('Falha ao reler o perfil depois de salvar:', error);
      return false;
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    const nome = name.trim();
    if (nome.length < 3) {
      return toast({ title: 'Nome muito curto', description: 'Use ao menos 3 caracteres.', variant: 'destructive' });
    }
    if (!user?.id) return;

    setSavingProfile(true);
    try {
      // `select` obrigatório: sem ele o PostgREST devolve 204 mesmo quando a RLS
      // não deixou nenhuma linha ser tocada, e a tela comemoraria sem gravação.
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: nome, phone: phone.trim() || null })
        .eq('id', user.id)
        .select('id');
      if (error) throw dbError('salvar perfil', error);
      if (!data?.length) throw dbError('salvar perfil', { code: '42501', message: 'nenhuma linha atualizada' });

      // A releitura NÃO faz parte da gravação: ela só atualiza o cabeçalho e o
      // avatar. Enquanto o `await` ficava sob o mesmo `catch`, uma falha AQUI
      // fazia a tela dizer "Não foi possível salvar o perfil" para um perfil já
      // gravado — e a pessoa salvava de novo achando que não tinha salvo.
      const releu = await reler();
      toast({
        title: 'Perfil salvo',
        description: releu
          ? 'Seu nome e telefone foram atualizados.'
          : 'Recarregue a página para ver os dados novos no cabeçalho.',
      });
    } catch (error) {
      toast({
        title: 'Não foi possível salvar o perfil',
        description: describeError(error, 'Tente de novo em instantes.'),
        variant: 'destructive',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  /** A policy `avatars_write` só aceita a pasta com o próprio `auth.uid()`. */
  const uploadAvatar = async (file: File) => {
    if (!user?.id) return;
    if (!AVATAR_MIME.test(file.type)) {
      return toast({
        title: 'Formato não aceito',
        description: 'Envie uma imagem JPG, PNG ou WebP.',
        variant: 'destructive',
      });
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return toast({
        title: 'Imagem muito grande',
        description: 'Envie uma imagem de até 5 MB.',
        variant: 'destructive',
      });
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from('avatars')
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      const url = signed?.signedUrl;
      if (!url) throw new Error('não foi possível gerar o endereço da foto');

      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', user.id)
        .select('id');
      if (error) throw dbError('salvar foto', error);
      if (!data?.length) throw dbError('salvar foto', { code: '42501', message: 'nenhuma linha atualizada' });

      // Mesmo motivo do `saveProfile`: a foto já está gravada; falhar na
      // releitura não desfaz nada e não pode virar "não foi possível trocar".
      const releu = await reler();
      toast({
        title: 'Foto atualizada',
        description: releu ? undefined : 'Recarregue a página para ver a foto nova no cabeçalho.',
      });
    } catch (error) {
      toast({
        title: 'Não foi possível trocar a foto',
        description: describeError(error, 'Tente de novo em instantes.'),
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const cancelNonce = () => {
    setNeedsNonce(false);
    setNonce('');
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      return toast({
        title: 'Senha muito curta',
        description: `Use ao menos ${MIN_PASSWORD} caracteres.`,
        variant: 'destructive',
      });
    }
    if (password !== confirmation) {
      return toast({
        title: 'As senhas não conferem',
        description: 'Digite a mesma senha nos dois campos.',
        variant: 'destructive',
      });
    }
    if (needsNonce && !nonce.trim()) {
      return toast({
        title: 'Falta o código',
        description: 'Digite o código que enviamos para o seu e-mail.',
        variant: 'destructive',
      });
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser(
        needsNonce ? { password, nonce: nonce.trim() } : { password },
      );
      if (!error) {
        setPassword('');
        setConfirmation('');
        setNonce('');
        setNeedsNonce(false);
        // Quem troca a senha por desconfiança continuava com o invasor logado:
        // a sessão dele não caía sozinha. O `signOut` global derruba todos os
        // dispositivos — inclusive este, daí o aviso acima do botão.
        //
        // O toast vem DEPOIS e olha o retorno: quando a revogação global falha
        // por rede ou 5xx, o `_signOut` do auth-js devolve o erro ANTES de
        // limpar a sessão (só 401/403/404 são tolerados), então NADA cai — nem
        // aqui, nem nos outros dispositivos, que seguem com refresh token
        // válido. Sem esta leitura, a tela diria "senha salva" e a pessoa
        // acharia que tinha derrubado o invasor junto.
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
        toast(
          signOutError
            ? {
                title: 'Senha salva, mas as outras sessões continuam abertas',
                description: 'Use "Encerrar todas as sessões", abaixo nesta tela, para tentar de novo.',
                variant: 'destructive',
              }
            : {
                title: 'Senha salva',
                description: 'Encerramos as sessões abertas. Entre de novo com a senha nova.',
              },
        );
        return;
      }

      // Reautenticação exigida: o Supabase manda um código por e-mail e a mesma
      // chamada é refeita com ele. Só vale uma vez — no segundo envio o `nonce`
      // já vai junto e o erro é do código, não do fluxo.
      const reason = `${error.code ?? ''} ${error.message}`.toLowerCase();
      if (reason.includes('reauthentication') && !needsNonce) {
        const { error: reauthError } = await supabase.auth.reauthenticate();
        if (reauthError) {
          return toast({
            title: 'Não foi possível enviar o código',
            description: authMessage(reauthError, 'Tente de novo em instantes.'),
            variant: 'destructive',
          });
        }
        setNeedsNonce(true);
        return toast({
          title: 'Confirme que é você',
          description: `Enviamos um código para ${profile?.email ?? 'seu e-mail'}. Digite-o abaixo e salve de novo.`,
        });
      }

      toast({
        title: 'Não foi possível salvar a senha',
        description: authMessage(error, 'Tente de novo em instantes.'),
        variant: 'destructive',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const revokeAllSessions = async () => {
    setConfirmRevoke(false);
    setLoading(true);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setLoading(false);
    if (error) {
      return toast({
        title: 'Não foi possível encerrar as sessões',
        description: authMessage(error, 'Tente de novo em instantes.'),
        variant: 'destructive',
      });
    }
    // O onAuthStateChange do AuthContext derruba a sessão local e o guard leva ao /login.
    toast({ title: 'Sessões encerradas', description: 'Entre novamente para continuar.' });
  };

  const iniciais = (profile?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="mx-auto max-w-2xl p-6">
      <PageHeader
        title="Configurações"
        eyebrow="Sua conta"
        icon={SettingsIcon}
        description="Seus dados, como você entra e o controle das sessões abertas."
      />

      <div className="space-y-4">
        <SectionCard
          title="Meu perfil"
          description="O que a equipe vê no seu nome, no seu contato e na sua foto."
          icon={UserRound}
        >
          <form className="space-y-4" onSubmit={saveProfile}>
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-base font-semibold text-primary">
                {/* `avatar_url` guarda uma URL ASSINADA de um bucket privado
                    (ver `uploadAvatar`): quando ela expira, a imagem quebra.
                    Cair nas iniciais é melhor do que o ícone de imagem
                    quebrada — a correção de raiz está registrada como
                    pendência (assinar na leitura, não na gravação). */}
                {profile?.avatar_url && !fotoQuebrada
                  ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={() => setFotoQuebrada(true)}
                    />
                  )
                  : <span aria-hidden>{iniciais || '?'}</span>}
              </div>
              <div className="space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? 'Enviando...' : 'Trocar foto'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  JPG, PNG ou WebP, até 5 MB. A foto aparece na equipe e no ranking.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept={AVATAR_ACCEPT}
                  className="hidden"
                  aria-label="Arquivo da foto de perfil"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Zera aqui, e não no fim do upload: quem escolhe um arquivo
                    // recusado e tenta o MESMO de novo não dispara `change`
                    // enquanto o valor continuar no input.
                    e.target.value = '';
                    if (file) void uploadAvatar(file);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="profile-name">Nome completo</Label>
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="profile-phone">Telefone</Label>
              <Input
                id="profile-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                inputMode="tel"
                placeholder="(00) 00000-0000"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? 'Salvando...' : 'Salvar perfil'}
              </Button>
            </div>
          </form>
        </SectionCard>

        {/* Antes, para saber quem é o seu gerente, era preciso abrir Equipes —
            tela de administração que nem todo papel enxerga. */}
        <SectionCard
          title="Seu acesso"
          description="Os papéis que a sua conta tem e onde você está na estrutura."
          icon={Users}
        >
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Papéis</p>
              {/* Três estados, não dois. `roles` fica vazio tanto para quem
                  realmente não tem papel quanto quando a leitura do perfil
                  falhou (AuthContext zera a matriz de propósito: falha
                  fechada). E é justamente essa falha que traz a pessoa até
                  aqui — sem item de menu permitido, o pós-login cai em
                  /settings. Dizer "nenhum papel atribuído" seria afirmar um
                  fato do cadastro no lugar de um erro nosso. É a mesma
                  distinção que o bloco "Equipe" logo abaixo já faz. */}
              {roles.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((papel) => (
                    <Badge key={papel} variant="outline">{ROLE_LABEL[papel] ?? papel}</Badge>
                  ))}
                </div>
              ) : perfilFalhou ? (
                <p className="text-sm text-destructive">
                  Não foi possível carregar seus papéis. Recarregue a página e, se continuar assim,
                  fale com um administrador da Faceimob.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum papel atribuído ainda. Fale com um administrador da Faceimob.
                </p>
              )}
              {roles.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Papel é acumulável: você usa todos ao mesmo tempo.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Equipe</p>
              {acessoErro ? (
                <p className="text-sm text-destructive">{acessoErro}</p>
              ) : !acesso ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : !acesso.equipe ? (
                <p className="text-sm text-muted-foreground">
                  Você não está em nenhuma equipe. Fale com um administrador se isso não estiver certo.
                </p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Equipe</dt>
                  <dd className="font-medium">{acesso.equipe}</dd>
                  <dt className="text-muted-foreground">Gerente</dt>
                  <dd className="font-medium">
                    {acesso.semNomes ? 'Não foi possível carregar' : acesso.gerente ?? 'Sem gerente definido'}
                  </dd>
                  <dt className="text-muted-foreground">Diretor</dt>
                  <dd className="font-medium">
                    {acesso.semNomes ? 'Não foi possível carregar' : acesso.diretor ?? 'Sem diretor definido'}
                  </dd>
                </dl>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Como você entra" icon={ShieldCheck}>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Por código enviado para{' '}
              <span className="font-medium text-foreground">{profile?.email ?? 'seu e-mail cadastrado'}</span>
              {' '}ou, depois de definir uma senha abaixo, por e-mail e senha.
            </p>
            <p>
              O e-mail é a credencial da conta e não pode ser trocado por aqui — peça a alteração a um
              administrador da Faceimob.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Senha de acesso"
          description={`Defina ou troque a senha desta conta. Mínimo de ${MIN_PASSWORD} caracteres.`}
          icon={KeyRound}
        >
          <form className="space-y-3" onSubmit={savePassword}>
            <div className="space-y-1">
              <Label htmlFor="new-password">Nova senha</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD}
                  className="pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Repita a nova senha</Label>
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>
            {needsNonce && (
              <div className="space-y-1">
                <Label htmlFor="reauth-code">Código enviado por e-mail</Label>
                <Input
                  id="reauth-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={nonce}
                  onChange={(e) => setNonce(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Este projeto pede confirmação por e-mail para trocar a senha. Se o código não chegar,
                  fale com um administrador — o envio de e-mail depende de configuração do servidor.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Ao salvar, todas as sessões desta conta são encerradas, inclusive esta: você entra de novo
              com a senha nova.
            </p>
            <div className="flex justify-end gap-2">
              {needsNonce && (
                <Button type="button" variant="ghost" onClick={cancelNonce}>
                  Cancelar
                </Button>
              )}
              <Button type="submit" disabled={savingPassword || !password || !confirmation} className="gap-2">
                <KeyRound className="h-4 w-4" aria-hidden />
                {savingPassword ? 'Salvando...' : 'Salvar senha'}
              </Button>
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="Encerrar todas as sessões"
          description="Desconecta esta conta de todos os dispositivos, inclusive deste."
          icon={LogOut}
          className="border-destructive/40"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Use se achar que alguém acessou seu e-mail ou entrou na sua conta.
            </p>
            <Button
              variant="destructive"
              onClick={() => setConfirmRevoke(true)}
              disabled={loading}
              className="gap-2 sm:shrink-0"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {loading ? 'Encerrando...' : 'Encerrar todas as sessões'}
            </Button>
          </div>
        </SectionCard>
      </div>

      {/* Um clique derrubava o próprio usuário e todos os dispositivos sem
          pergunta nenhuma — e quem cai aqui por engano perde o que estava
          fazendo em toda tela aberta. */}
      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar todas as sessões?</AlertDialogTitle>
            <AlertDialogDescription>
              Você sai desta tela e de todos os outros dispositivos ligados a{' '}
              {profile?.email ?? 'esta conta'}. Para voltar, entre de novo com senha ou com o código
              por e-mail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void revokeAllSessions(); }}>
              Encerrar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
