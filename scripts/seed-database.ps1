[CmdletBinding()]
param(
  [string]$DbHost = "aws-0-us-east-1.pooler.supabase.com",
  [int]$DbPort = 5432,
  [string]$DbName = "postgres",
  [string]$DbUser = "postgres.mcmqgxvtwegtptfseqvw"
)

$ErrorActionPreference = "Stop"
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$passwordSecure = Read-Host "Senha do banco Supabase (nao sera exibida)" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
$databasePassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)

$seedFiles = @(
  "/workspace/supabase/seed.sql",
  "/workspace/supabase/seeds/010_identity_and_teams.sql",
  "/workspace/supabase/seeds/020_catalog_distribution_sdr.sql",
  "/workspace/supabase/seeds/030_commercial_operation.sql",
  "/workspace/supabase/seeds/040_reports_game_workspace.sql",
  # Fase 5: cenarios de teste. O rollback (059) fica de fora de proposito -
  # e manual, para nao apagar os cenarios logo depois de cria-los.
  "/workspace/supabase/seeds/050_test_scenarios.sql"
)

try {
  Get-Command docker -ErrorAction Stop | Out-Null
  $env:PGPASSWORD = $databasePassword

  $dockerArgs = @(
    "run", "--rm", "-i",
    "--mount", "type=bind,source=$workspacePath,target=/workspace,readonly",
    "--env", "PGPASSWORD",
    "postgres:15-alpine",
    "psql",
    "--host", $DbHost,
    "--port", $DbPort.ToString(),
    "--username", $DbUser,
    "--dbname", $DbName,
    "--set", "ON_ERROR_STOP=1"
  )

  foreach ($seedFile in $seedFiles) {
    $dockerArgs += @("--file", $seedFile)
  }

  & docker @dockerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "O seed falhou. O psql encerrou com codigo $LASTEXITCODE."
  }

  Write-Host ""
  Write-Host "Seed completo aplicado com sucesso." -ForegroundColor Green
  Write-Host "As quatro fases podem ser executadas novamente sem duplicar os dados."
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($passwordPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  }
  $databasePassword = $null
}
