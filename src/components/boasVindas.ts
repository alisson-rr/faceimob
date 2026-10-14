import { IMOBILIARIA, baixarVcard, vcardDe } from "@/components/leads/contatoVcard";
import { waNumber } from "@/components/leads/model";

/** Webmail e criação de e-mail (KingHost) da Faceimob — o e-mail de acesso nasce lá. */
export const WEBMAIL_URL = "https://webmail.faceimob.com.br";
export const KINGHOST_CRIAR_EMAIL_URL =
  "https://login.kinghost.com.br/?referrer=%2Fpainel.dominios.php%3Fid_dominio%3D339833";

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || "";

const linkWa = (telefone: string | null | undefined, texto: string) => {
  const numero = waNumber(telefone);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
};

/**
 * Senha inicial da caixa de e-mail criada no KingHost (14/10/2026). É a do
 * e-mail, não a do CRM: o CRM não tem senha, o login é por código de 6 dígitos
 * que chega nessa caixa. Só vai na mensagem quando o e-mail é do domínio da
 * empresa; um e-mail de fora tem senha própria.
 */
export const SENHA_INICIAL_EMAIL = "Face@2026";
const DOMINIO_EMAIL_EMPRESA = "@faceimob.com.br";

/**
 * Boas-vindas ao colaborador: endereço de acesso e, se a caixa é da empresa, a
 * senha inicial dela, para ele abrir o webmail e ler o código de 6 dígitos.
 */
export function linkBoasVindas(p: { nome: string; email: string; telefone: string | null | undefined; crmUrl: string }) {
  const caixaDaEmpresa = p.email.trim().toLowerCase().endsWith(DOMINIO_EMAIL_EMPRESA);
  return linkWa(p.telefone, [
    `Olá ${primeiroNome(p.nome)}, seja bem-vindo(a) à ${IMOBILIARIA}! 🎉`,
    "",
    "Seu acesso ao CRM está pronto:",
    `🔗 ${p.crmUrl}`,
    `📧 Seu e-mail de acesso: ${p.email}`,
    ...(caixaDaEmpresa ? [`🔑 Senha inicial do e-mail: ${SENHA_INICIAL_EMAIL} (troque no primeiro acesso ao webmail)`] : []),
    "",
    "O CRM não tem senha: digite o e-mail, clique em entrar e use o código de 6 dígitos que chega na sua caixa de e-mail.",
    `Para ler o código, entre no webmail: ${WEBMAIL_URL}`,
  ].join("\n"));
}

/** Aviso ao gerente de que o novo colaborador entrou na equipe dele. */
export function linkAvisoAoGerente(p: { gerente: string; nome: string; email: string; telefoneGerente: string | null | undefined }) {
  return linkWa(p.telefoneGerente, [
    `Olá ${primeiroNome(p.gerente)}! Cadastramos ${p.nome} na sua equipe no CRM da ${IMOBILIARIA}.`,
    `E-mail de acesso: ${p.email}`,
    "Ele(a) entra com o código de 6 dígitos enviado por e-mail. Qualquer dúvida, é só falar.",
  ].join("\n"));
}

/** Salva o colaborador na agenda como "Nome | Faceimob". Sem telefone, não faz nada. */
export function salvarColaboradorNaAgenda(nome: string, telefone: string | null | undefined): boolean {
  const nomeDoContato = `${nome.trim()} | ${IMOBILIARIA}`;
  return baixarVcard(vcardDe(nomeDoContato, telefone), nome);
}

/** Salva o contato e abre o WhatsApp com o acesso pronto: o envio continua manual. Sem telefone, não faz nada. */
export function enviarAcessoPorWhatsapp(p: { nome: string; email: string; telefone: string | null | undefined }): boolean {
  const url = linkBoasVindas({ ...p, crmUrl: window.location.origin });
  if (!url) return false;
  // Salva o contato antes: a conversa já nasce com o nome certo.
  salvarColaboradorNaAgenda(p.nome, p.telefone);
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
