# Local access for testing ClearML OIDC SSO + email through the minikube ingress.
#
# Uses nip.io wildcard DNS (clearml.127.0.0.1.nip.io etc. auto-resolve to
# 127.0.0.1), so NO hosts-file edits are needed. This script just starts
# `minikube tunnel` so the nginx ingress is reachable on 127.0.0.1:80.
#
# Binding :80 requires admin, so the script self-elevates. Leave the elevated
# window open while testing (the tunnel must keep running).
#
# No-admin alternative (no tunnel): port-forward the ingress controller to a
# high local port, e.g. `kubectl -n ingress-nginx port-forward
# svc/ingress-nginx-controller 8085:80` -> http://clearml.127.0.0.1.nip.io:8085
# (that requires baking :8085 into the OIDC issuergit add infra/ clearml-charts/values-testing.yaml start-local-test-access.ps1
git commit -m "test: switch OIDC/ingress hostnames to nip.io (no hosts file)"
git pushonPolicy Bypass -File .\start-local-test-access.ps1
param([string]$MinikubeProfile = 'clearml')

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Requesting administrator rights (needed to bind port 80 for the tunnel)...' -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
        '-MinikubeProfile', $MinikubeProfile
    )
    return
}

Write-Host 'Access URLs (nip.io -> 127.0.0.1, no hosts file needed):' -ForegroundColor Cyan
Write-Host '  ClearML (SSO login): http://clearml.127.0.0.1.nip.io'
Write-Host '  Keycloak admin:      http://keycloak.127.0.0.1.nip.io   (admin / admin)'
Write-Host '  Mailpit inbox:       http://mailpit.127.0.0.1.nip.io'
Write-Host '  Test SSO user:       tester / tester'
Write-Host ''
Write-Host "Starting 'minikube -p $MinikubeProfile tunnel' - keep this window open..." -ForegroundColor Cyan
minikube -p $MinikubeProfile tunnel
