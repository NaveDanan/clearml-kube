# Local access for testing ClearML OIDC SSO + email through the minikube ingress.
#
# Uses one ingress-controller port-forward so ClearML remains available at
# 127.0.0.1:8080 and Keycloak at keycloak.127.0.0.1.nip.io:8080. nip.io resolves
# to 127.0.0.1, so no hosts-file edit or administrator elevation is required.
# Leave this window open while testing.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\start-local-test-access.ps1
param([string]$MinikubeProfile = 'clearml')

Write-Host 'Access URLs (nip.io -> 127.0.0.1, no hosts file needed):' -ForegroundColor Cyan
Write-Host '  ClearML (SSO login): http://127.0.0.1:8080'
Write-Host '  Keycloak admin:      http://keycloak.127.0.0.1.nip.io:8080'
Write-Host '  Mailpit inbox:       http://mailpit.127.0.0.1.nip.io:8080'
Write-Host '  Test SSO user:       tester / tester'
Write-Host ''
Write-Host 'Starting the ingress controller port-forward - keep this window open...' -ForegroundColor Cyan
kubectl port-forward --address 0.0.0.0 -n ingress-nginx svc/ingress-nginx-controller 8080:80
