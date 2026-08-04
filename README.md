# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

## Supabase

As migrations e o seed em quatro fases usam o schema novo. Para aplicar o seed
completo no projeto remoto pelo PowerShell (a senha é solicitada sem ser exibida):

```powershell
npm run db:seed:remote
```

Esse comando usa Docker para executar o `psql`, sem colocar a senha na URI nem
no histórico do terminal. Ele carrega catálogo, pessoas fictícias bloqueadas
para login, equipes, leads, negócios, CCA, SDR, daily, gamificação, marketing e
workspace. Os registros são idempotentes: o comando pode ser repetido.

Para criar o seu primeiro usuário real:

```powershell
npm run user:create -- -Email admin@faceimob.com.br -FullName "Administrador" -Role admin
```

O script lê `VITE_SUPABASE_URL` do `.env` e pede, sem exibir, apenas a
`service_role key`. Essa chave deve ser copiada de **Supabase → Project
Settings → API Keys** e nunca deve ser salva no `.env` do Vite, commitada ou
exposta no navegador.

**Não existe senha.** O acesso é por código de 6 dígitos enviado ao e-mail
(`signInWithOtp`); o usuário é criado com `email_confirm`, então já recebe o
código na primeira tentativa.

Depois, inicie o aplicativo e entre pela rota `/login`:

```powershell
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
