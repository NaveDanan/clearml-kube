param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "port-forward.config.json"),
    [string]$Profile,
    [int]$Port
)

$ErrorActionPreference = "Stop"

function Resolve-CommandPath {
    param(
        [string]$Name,
        [string]$Fallback
    )

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    if ($Fallback -and (Test-Path -LiteralPath $Fallback)) {
        return $Fallback
    }

    throw "Could not find $Name"
}

function Test-PortListening {
    param([int]$LocalPort)

    return [bool](Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -eq $LocalPort } |
        Select-Object -First 1)
}

function Wait-KubectlResource {
    param(
        [string[]]$Args,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        & $script:kubectl @Args *> $null
        if ($LASTEXITCODE -eq 0) {
            return $true
        }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Start-MinikubeProfile {
    param([string]$ProfileName)

    $status = & $script:minikube status -p $ProfileName 2>$null | Out-String
    if ($LASTEXITCODE -ne 0 -or $status -notmatch "host:\s*Running" -or $status -notmatch "apiserver:\s*Running") {
        Write-Host "Starting minikube profile '$ProfileName'"
        & $script:minikube start -p $ProfileName
    }

    & $script:kubectl config use-context $ProfileName | Out-Null
}

function Wait-ArgoApplications {
    param([array]$Applications)

    foreach ($app in $Applications) {
        $namespace = $app.namespace
        $name = $app.name
        if (-not (Wait-KubectlResource -Args @("get", "application", "-n", $namespace, $name) -TimeoutSeconds 180)) {
            Write-Warning "Argo CD application $namespace/$name is not available yet"
            continue
        }

        if (-not $app.waitForHealthy) {
            continue
        }

        Write-Host "Waiting for Argo CD application $namespace/$name to become Synced/Healthy"
        $deadline = (Get-Date).AddMinutes(10)
        do {
            $sync = & $script:kubectl get application -n $namespace $name -o jsonpath="{.status.sync.status}" 2>$null
            $health = & $script:kubectl get application -n $namespace $name -o jsonpath="{.status.health.status}" 2>$null
            if ($sync -eq "Synced" -and $health -eq "Healthy") {
                break
            }
            Start-Sleep -Seconds 5
        } while ((Get-Date) -lt $deadline)

        if ($sync -ne "Synced" -or $health -ne "Healthy") {
            Write-Warning "Argo CD application $namespace/$name is $sync/$health"
        }
    }
}

function Start-PortForward {
    param($Forward)

    if (Test-PortListening -LocalPort $Forward.localPort) {
        Write-Host "$($Forward.name): localhost:$($Forward.localPort) is already listening"
        return
    }

    if (-not (Wait-KubectlResource -Args @("get", "svc", "-n", $Forward.namespace, $Forward.service) -TimeoutSeconds 180)) {
        Write-Warning "$($Forward.name): service $($Forward.namespace)/$($Forward.service) is not available"
        return
    }

    Write-Host "$($Forward.name): forwarding $($Forward.url)"
    Start-Process -FilePath $script:kubectl `
        -ArgumentList @(
            "port-forward",
            "-n",
            $Forward.namespace,
            "svc/$($Forward.service)",
            "$($Forward.localPort):$($Forward.remotePort)"
        ) `
        -WindowStyle Hidden `
        -WorkingDirectory (Split-Path -Parent $ConfigPath) | Out-Null
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Config file not found: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($Profile) {
    $config.profile = $Profile
}
if ($Port) {
    $config.forwards = @($config.forwards | Where-Object { $_.name -eq "argocd" })
    $config.forwards[0].localPort = $Port
    $config.forwards[0].url = "https://localhost:$Port"
}

$script:minikube = Resolve-CommandPath -Name "minikube" -Fallback (Join-Path $env:USERPROFILE "bin\minikube.exe")
$script:kubectl = Resolve-CommandPath -Name "kubectl" -Fallback ""

Start-MinikubeProfile -ProfileName $config.profile

if (-not (Wait-KubectlResource -Args @("get", "svc", "-n", "argocd", "argocd-server") -TimeoutSeconds 180)) {
    throw "Argo CD service argocd/argocd-server is not available"
}

Wait-ArgoApplications -Applications @($config.applications)

while ($true) {
    foreach ($forward in $config.forwards) {
        Start-PortForward -Forward $forward
    }
    Start-Sleep -Seconds 30
}
