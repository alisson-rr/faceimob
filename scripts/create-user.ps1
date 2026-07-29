[CmdletBinding()]
param(
  [string]$ProjectUrl,
  [string]$Email,
  [string]$FullName,
  [ValidateSet("admin", "director", "manager", "broker", "cca", "sdr", "marketing", "partner")]
  [string]$Role = "broker"
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
if (-not $Email) { $Email = Read-Host "E-mail do novo usuário" }
if (-not $FullName) { $FullName = Read-Host "Nome completo" }

$passwordSecure = Read-Host "Senha inicial (não será exibida)" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
$password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
$keyPtr = [IntPtr]::Zero

$serviceRoleKey = $env:FACEIMOB_SERVICE_ROLE_KEY
if (-not $serviceRoleKey) {
  $keySecure = Read-Host "Service role key do Supabase (não será exibida)" -AsSecureString
  $keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecure)
  $serviceRoleKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
}

try {
  $headers = @{
    apikey = $serviceRoleKey
    Authorization = "Bearer $serviceRoleKey"
    "Content-Type" = "application/json"
  }
  $userBody = @{
    email = $Email.Trim()
    password = $password
    email_confirm = $true
    user_metadata = @{ full_name = $FullName.Trim() }
  } | ConvertTo-Json -Depth 4

  $baseUrl = $ProjectUrl.TrimEnd("/")
  $user = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/auth/v1/admin/users" `
    -Headers $headers `
    -Body $userBody

  $roleHeaders = $headers.Clone()
  $roleHeaders["Prefer"] = "resolution=ignore-duplicates,return=minimal"
  $roleBody = @{ profile_id = $user.id; role = $Role } | ConvertTo-Json
  Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/rest/v1/user_roles?on_conflict=profile_id,role" `
    -Headers $roleHeaders `
    -Body $roleBody | Out-Null

  Write-Host ""
  Write-Host "Usuário criado com sucesso." -ForegroundColor Green
  Write-Host "ID:     $($user.id)"
  Write-Host "E-mail: $($user.email)"
  Write-Host "Papel:  $Role"
}
finally {
  if ($passwordPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
  if ($keyPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr) }
  $password = $null
  $serviceRoleKey = $null
}
