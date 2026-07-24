# Local access for testing ClearML OIDC SSO + email through the minikube ingress.
#
# The SSO flow is hostname-based (issuer/redirect use *.clearml.local), so it can
# only be exercised through the ingress - not via port-forward. This script:
#   1) adds the three hostnames to the Windows hosts file (-> 127.0.0.1), and
#   2) starts `minikube tunnel` so the nginx ingress is reachable on 127.0.0.1:80.
#
# Editing the hosts file and binding :80 require admin, so the script self-elevates.
# Leave the elevated window open while testing (tunnel must keep running).
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\start-local-test-access.ps1
param([string]$MinikubeProfile = 'clearml')

$hostnames = @(
    'clearml.clearml.local',
    'keycloak.clearml.local',
    'mailpit.clearml.local'
)
$hostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Requesting administrator rights (needed to edit hosts + start tunnel)...' -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
        '-MinikubeProfile', $MinikubeProfile
    )
    return
}

$content = @(Get-Content -Path $hostsFile -ErrorAction SilentlyContinue)
foreach ($h in $hostnames) {
    if ($content | Where-Object { $_ -match "\s$([regex]::Escape($h))(\s|$)" }) {
        Write-Host "hosts: already present -> $h" -ForegroundColor DarkGray
    }
    else {
        Add-Content -Path $hostsFile -Value "127.0.0.1`t$h"
        Write-Host "hosts: added -> 127.0.0.1 $h" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Access URLs (all on http / port 80 via the ingress):' -ForegroundColor Cyan
Write-Host '  ClearML (SSO login): http://clearml.clearml.local'
Write-Host '  Keycloak admin:      http://keycloak.clearml.local   (admin / admin)'
Write-Host '  Mailpit inbox:       http://mailpit.clearml.local'
Write-Host '  Test SSO user:       tester / tester'
Write-Host ''
Write-Host "Starting 'minikube -p $MinikubeProfile tunnel' - keep this window open..." -ForegroundColor Cyan
minikube -p $MinikubeProfile tunnel
