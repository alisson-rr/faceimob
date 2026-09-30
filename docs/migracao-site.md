# Migração do site (faceimob.com.br) para a VPS

Decisão do cliente em 29/09/2026: o site sai do Lovable Cloud e passa a usar o
mesmo Supabase do CRM, na VPS; o frontend vai para a Vercel. Regra: **nenhum
dado apagado em lugar nenhum até o site novo estar no ar e conferido**. O
Lovable fica intacto como plano B por pelo menos 30 dias.

Repositório do site: `doughgomes/faceimob-site` (TanStack Start + Nitro, hoje
com alvo Cloudflare; 50 migrations; nenhuma edge function publicada).

## Mapa das tabelas

O site tem 27 tabelas. Três se sobrepõem ao CRM e se fundem com ele; as outras
24 vão para o schema `site`, sem colidir com nada do CRM.

| Site | Destino | Como |
| --- | --- | --- |
| `profiles`, `user_roles`, `app_role` | identidade do CRM | usuário casado por e-mail; o papel do site vira regra sobre o papel do CRM (abaixo) |
| `leads` | `site.leads` (histórico) | histórico preservado como está; leads NOVOS do site entram na roleta do CRM |
| `broker_credentials` | cofre do CRM | senhas abertas não são copiadas abertas; o que for credencial útil (e-mail) vai criptografado para o cofre |
| as 24 demais | `site.<tabela>` | cópia fiel, mesmas colunas e ids |

Tabelas do site que apontam para usuário: `broker_credentials`,
`support_doc_editors`, `university_watched`, `evolucao_universidade`. Na cópia,
o id do usuário do site é trocado pelo id do perfil do CRM com o mesmo e-mail
(`site.mapa_usuarios`).

### Papéis

O site pergunta tudo a `private.has_role(uid, papel)` (papéis `admin`, `user`,
`corretor`). No banco unificado a mesma pergunta vira `site.has_role`, com a
resposta vinda do CRM:

- `admin` → administrador ou sócio do CRM (`is_admin()`);
- `corretor` → qualquer perfil ATIVO do CRM (inativar no CRM fecha a área de membros);
- `user` → sem uso no código atual; responde falso.

### Arquivos

Pastas do Storage: `property-images`, `property-docs`, `campaign-images`,
`blog-images`, `support-docs`. Nenhuma colide com as do CRM (`avatars`,
`deal-documents`, `lead-attachments`). Mesmos caminhos, conferidos por tamanho.

### Usuários

As senhas do Lovable não saem (o Auth guarda só o hash, e o hash não é
exportável por aqui). Como cada corretor vai receber senha própria na
unificação, isso não pesa. Usuário do site sem par no CRM (pelo e-mail) entra
numa lista para o cliente resolver antes da virada — nada é criado sozinho.

## Como a cópia acontece

1. **Exportação no site** (rota de servidor, só leitura, protegida por token
   guardado nos Secrets do Lovable): devolve as linhas de cada tabela em páginas,
   a lista de arquivos com link temporário e a lista de usuários. Nenhuma chave
   sai do Lovable.
2. **Importação no CRM** (edge function, só admin): puxa as páginas, grava em
   `site.*` por id (repetir não duplica), copia os arquivos e troca os ids de
   usuário.
3. **Conferência**: contagem por tabela e total de arquivos/bytes dos dois
   lados. Qualquer diferença trava o avanço.
4. **Vídeo não é copiado** (decisão do cliente em 30/09/2026): todos os vídeos
   estão no YouTube, e o site passa a usar o link. Os 4 vídeos que o site tinha
   no Storage (2 em campanhas, `facebook_campaigns.media`; 2 aulas,
   `university_videos.video_url`) ficam só no Lovable até a Fase B trocar a
   referência pelo link do YouTube.

## Etapas

1. Preparação (sem tocar em produção): este mapa, migrations do schema `site`,
   rota de exportação (em branch), função de importação, ensaio local.
2. Cópia real para a VPS e site novo numa prévia da Vercel.
3. Virada do domínio (pausa curta de cadastros, cópia do que entrou, conferência).
4. Unificação dos acessos: cadastro único, envio pelo WhatsApp, inativação que
   fecha tudo.

## Pendências fora do código

- Chaves de IA: o site usa a chave do Lovable (`LOVABLE_API_KEY`) para as
  funções de IA; na saída, passam a usar a chave própria da OpenAI ou do Gemini.
- Expor o schema `site` na API da VPS (`PGRST_DB_SCHEMAS`).
