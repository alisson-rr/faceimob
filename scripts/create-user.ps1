[CmdletBinding()]
param(
  [string]$ProjectUrl,
  [string]$Email,
  [string]$FullName,
  [ValidateSet("admin", "director", "manager", "broker", "cca", "sdr", "marketing", "partner")]
  [string]$Role = "broker",

  # Define senha para o usuario. Sem valor de propria vontade: o valor e pedido
  # por Read-Host -AsSecureString, para nao ficar no historico do PowerShell nem
  # no bloco de comando do agendador.
  [switch]$Password,

  # Troca a senha de um usuario que JA existe (nao cria nada). Precisa de -Email.
  [switch]$SetPassword
)

$ErrorActionPreference = "Stop"

if (-not $ProjectUrl) {
  $envLine = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\.env") |
    Where-Object { $_ -match "^VITE_SUPABASE_URL=" } |
    Select-Object -First 1
  if ($envLine) {
    $ProjectUrl = ($envLine -replace "^VITE_SUPABASE_URL=", "").Trim().Trim('"')
  }
}

if (-not $ProjectUrl) { throw "Informe -ProjectUrl ou configure VITE_SUPABASE_URL no .env." }
if (-not $Email) { $Email = Read-Host "E-mail do usuario" }
if (-not $SetPassword -and -not $FullName) { $FullName = Read-Host "Nome completo" }

# Decisao de 21/08: o login aceita senha E codigo por e-mail. A senha existe
# porque o codigo depende de SMTP configurado; sem SMTP o remetente embutido do
# Supabase recusa endereco de fora da equipe do projeto. email_confirm = true
# deixa a conta apta aos dois caminhos sem clicar em link de confirmacao.
$keyPtr = [IntPtr]::Zero
$pwdPtr = [IntPtr]::Zero
$plainPassword = $null

$serviceRoleKey = $env:FACEIMOB_SERVICE_ROLE_KEY
if (-not $serviceRoleKey) {
  $keySecure = Read-Host "Service role key do Supabase (nao sera exibida)" -AsSecureString
  $keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecure)
  $serviceRoleKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
}

try {
  if ($Password -or $SetPassword) {
    $pwdSecure = Read-Host "Senha do usuario (nao sera exibida)" -AsSecureString
    $pwdPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwdSecure)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pwdPtr)
    if ($plainPassword.Length -lt 8) {
      throw "Senha curta demais. Use ao menos 8 caracteres."
    }
  }

  $headers = @{
    apikey = $serviceRoleKey
    Authorization = "Bearer $serviceRoleKey"
    "Content-Type" = "application/json"
  }
  $baseUrl = $ProjectUrl.TrimEnd("/")

  if ($SetPassword) {
    # Troca de senha: o id vem de `profiles`, que tem a mesma chave de
    # `auth.users`. E a consulta mais simples que ja funciona com a service role
    # key — a Admin API do GoTrue lista usuarios paginando, sem busca por e-mail.
    $encoded = [Uri]::EscapeDataString($Email.Trim())
    $found = Invoke-RestMethod `
      -Method Get `
      -Uri "$baseUrl/rest/v1/profiles?email=eq.$encoded&select=id,full_name" `
      -Headers $headers

    if (-not $found -or $found.Count -eq 0) {
      throw "Nenhum usuario com o e-mail $Email. Crie primeiro, sem -SetPassword."
    }

    $body = @{ password = $plainPassword } | ConvertTo-Json
    Invoke-RestMethod `
      -Method Put `
      -Uri "$baseUrl/auth/v1/admin/users/$($found[0].id)" `
      -Headers $headers `
      -Body $body | Out-Null

    Write-Host ""
    Write-Host "Senha atualizada." -ForegroundColor Green
    Write-Host "Usuario: $($found[0].full_name) <$Email>"
    Write-Host "Entre em /login com e-mail e senha." -ForegroundColor Cyan
    return
  }

  $userPayload = @{
    email = $Email.Trim()
    email_confirm = $true
    user_metadata = @{ full_name = $FullName.Trim() }
  }
  if ($plainPassword) { $userPayload.password = $plainPassword }
  $userBody = $userPayload | ConvertTo-Json -Depth 4

  $user = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/auth/v1/admin/users" `
    -Headers $headers `
    -Body $userBody

  # O trigger `handle_new_auth_user` ja concedeu `broker`; esta chamada acrescenta
  # o papel pedido. Papel e N:N, entao o usuario fica com os dois — e e assim que
  # o admin da demo consegue se pre-visualizar como corretor.
  $roleHeaders = $headers.Clone()
  $roleHeaders["Prefer"] = "resolution=ignore-duplicates,return=minimal"
  $roleBody = @{ profile_id = $user.id; role = $Role } | ConvertTo-Json
  Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/rest/v1/user_roles?on_conflict=profile_id,role" `
    -Headers $roleHeaders `
    -Body $roleBody | Out-Null

  Write-Host ""
  Write-Host "Usuario criado com sucesso." -ForegroundColor Green
  Write-Host "ID:     $($user.id)"
  Write-Host "E-mail: $($user.email)"
  Write-Host "Papel:  $Role (mais 'broker', concedido pelo trigger do Auth)"
  Write-Host ""
  if ($plainPassword) {
    Write-Host "Acesso: entre em /login com e-mail e senha." -ForegroundColor Cyan
    Write-Host "        O codigo de 6 digitos por e-mail continua valendo como alternativa."
  } else {
    Write-Host "Acesso: entre em /login com esse e-mail e receba o codigo de 6 digitos." -ForegroundColor Cyan
    Write-Host "        Para definir uma senha depois: -Email $Email -SetPassword"
  }
}
finally {
  if ($keyPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr) }
  if ($pwdPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pwdPtr) }
  $serviceRoleKey = $null
  $plainPassword = $null
}
