param(
  [string]$Helm = "helm"
)

$ErrorActionPreference = "Stop"
$chart = Split-Path -Parent $PSScriptRoot

function Render-Chart {
  param(
    [string]$Release,
    [string]$ValuesFile
  )

  $output = & $Helm template $Release $chart -f $ValuesFile 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Helm render failed for $Release`: $($output -join "`n")"
  }
  return $output -join "`n"
}

function Require-Contains {
  param(
    [string]$Content,
    [string]$Expected,
    [string]$Description
  )

  if (-not $Content.Contains($Expected)) {
    throw "${Description}: expected rendered output to contain '$Expected'"
  }
}

function Require-NotContains {
  param(
    [string]$Content,
    [string]$Unexpected,
    [string]$Description
  )

  if ($Content.Contains($Unexpected)) {
    throw "${Description}: rendered output must not contain '$Unexpected'"
  }
}

function Require-TemplateFailure {
  param(
    [string]$Description,
    [string[]]$Arguments,
    [string]$ExpectedError
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $Helm template validation $chart @Arguments 2>&1
    $helmExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($helmExitCode -eq 0) {
    throw "${Description}: expected Helm rendering to fail"
  }
  Require-Contains ($output -join "`n") $ExpectedError $Description
}

$confidential = Render-Chart "confidential-oidc" (Join-Path $PSScriptRoot "confidential-oidc-values.yaml")
Require-Contains $confidential "name: CLEARML_OIDC_CLIENT_SECRET" "Native OIDC"
Require-Contains $confidential "name: CLEARML__APISERVER__AUTH__OIDC__ISSUER_URL" "Native OIDC"
Require-Contains $confidential "name: CLEARML__APISERVER__AUTH__OIDC__JWKS_URL" "Native OIDC"
Require-NotContains $confidential "oauth2-proxy" "Native OIDC"
Require-NotContains $confidential "CLEARML__apiserver__auth__fixed_users__enabled" "Native OIDC"

$unauthenticatedSmtp = Render-Chart "unauthenticated-smtp" (Join-Path $PSScriptRoot "unauthenticated-smtp-values.yaml")
Require-NotContains $unauthenticatedSmtp "name: CLEARML__apiserver__email__username" "Unauthenticated SMTP"
Require-NotContains $unauthenticatedSmtp "key: smtp-username" "Unauthenticated SMTP"
Require-NotContains $unauthenticatedSmtp "key: smtp-password" "Unauthenticated SMTP"

$esa = Render-Chart "esa" (Join-Path $chart "esa-values.yaml")
Require-Contains $esa "name: CLEARML__apiserver__auth__fixed_users__enabled" "ESA password authentication"
Require-Contains $esa "secretName: clearml-fixed-users" "ESA fixed-user configuration"
Require-Contains $esa "name: CLEARML__secure__clearpipe__provenance_keys__current_key_id" "ESA ClearPipe provenance key id"
Require-Contains $esa "name: CLEARML__secure__clearpipe__provenance_keys__keys__current" "ESA ClearPipe provenance signing key"
Require-Contains $esa "name: clearml-provenance" "ESA ClearPipe provenance Secret"
Require-Contains $esa "name: CLEARPIPE_SCHEDULER_POLL_SECONDS" "ESA ClearPipe scheduler polling"

Require-TemplateFailure "Authenticated SMTP without a Secret" @(
  "--set", "email.enabled=true",
  "--set", "email.authentication.enabled=true",
  "--set", "email.smtpServer=smtp.example.invalid"
) "email.existingSecret is required"

Require-TemplateFailure "Invalid OIDC client authentication method" @(
  "-f", (Join-Path $PSScriptRoot "confidential-oidc-values.yaml"),
  "--set", "auth.oidc.clientAuthenticationMethod=invalid"
) "auth.oidc.clientAuthenticationMethod must be 'client_secret_post' or 'client_secret_basic'"

Require-TemplateFailure "Confidential OIDC Secret validation" @(
  "-f", (Join-Path $PSScriptRoot "confidential-oidc-values.yaml"),
  "--set", "auth.oidc.existingSecret="
) "auth.oidc.existingSecret is required when auth.mode is 'oidc'; it must contain client-secret"

Require-TemplateFailure "Confidential OIDC issuer validation" @(
  "-f", (Join-Path $PSScriptRoot "confidential-oidc-values.yaml"),
  "--set", "auth.oidc.issuerUrl="
) "auth.oidc.issuerUrl is required when auth.mode is 'oidc'"

Require-TemplateFailure "Confidential OIDC redirect validation" @(
  "-f", (Join-Path $PSScriptRoot "confidential-oidc-values.yaml"),
  "--set", "auth.oidc.redirectUrl="
) "auth.oidc.redirectUrl is required when auth.mode is 'oidc'"

Require-TemplateFailure "OIDC logout redirect validation" @(
  "-f", (Join-Path $PSScriptRoot "confidential-oidc-values.yaml"),
  "--set", "auth.oidc.postLogoutRedirectUrl="
) "auth.oidc.postLogoutRedirectUrl is required when auth.mode is 'oidc'"

Require-TemplateFailure "SMTP host validation" @(
  "--set", "email.enabled=true",
  "--set", "email.authentication.enabled=false"
) "email.smtpServer is required"

Require-TemplateFailure "Non-numeric SMTP port validation" @(
  "--set", "email.enabled=true",
  "--set", "email.authentication.enabled=false",
  "--set", "email.smtpServer=smtp.example.invalid",
  "--set-string", "email.smtpPort=not-a-number"
) "email.smtpPort must be a numeric port"

Require-TemplateFailure "Out-of-range SMTP port validation" @(
  "--set", "email.enabled=true",
  "--set", "email.authentication.enabled=false",
  "--set", "email.smtpServer=smtp.example.invalid",
  "--set", "email.smtpPort=65536"
) "email.smtpPort must be a numeric port"

Require-TemplateFailure "Conflicting SMTP TLS modes" @(
  "--set", "email.enabled=true",
  "--set", "email.authentication.enabled=false",
  "--set", "email.smtpServer=smtp.example.invalid",
  "--set", "email.useSsl=true"
) "email.useTls and email.useSsl cannot both be true"

Write-Host "Chart auth and SMTP render tests passed."
$global:LASTEXITCODE = 0
