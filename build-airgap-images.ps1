param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^\d{4}-\d{2}-\d{2}$')]
    [string]$Tag,

    [string]$DockerPath = "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    [string]$EnvFile = ".env.test",
    [string]$ComposeFile = "docker-compose.airgap.yml",
    [string]$ComposeService = "clearml-airgap",
    [string]$RunaiWorkerDockerfile = ".\clearml-server\docker\build\runai-worker.Dockerfile",
    [string]$RunaiV1Path = ".\runai-v1",
    [string]$RunaiV2Path = ".\runai-v2",
    [string]$OcTarPath = ".\oc.tar.gz",
    [string]$ChartsPath = ".\clearml-charts"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Script
    )

    Write-Host ""
    Write-Host "==> $Message"
    & $Script
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

function Get-FileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
        return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    }

    $hashOutput = certutil -hashfile $Path SHA256
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    return (($hashOutput | Where-Object { $_ -match '^[0-9A-Fa-f]{64}$' } | Select-Object -First 1).ToLowerInvariant())
}

function Update-AirgapChartTags {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ChartsPath,

        [Parameter(Mandatory = $true)]
        [string]$Tag
    )

    $esaValuesPath = Join-Path $ChartsPath "esa-values.yaml"
    $airgapDocPath = Join-Path $ChartsPath "AIRGAP.md"

    if (Test-Path -LiteralPath $esaValuesPath) {
        $content = Get-Content -LiteralPath $esaValuesPath -Raw
        $content = $content -replace 'autoscalar-v\d{4}-\d{2}-\d{2}', $Tag
        $content = $content -replace 'tag: "\d{4}-\d{2}-\d{2}"', "tag: `"$Tag`""
        Set-Content -LiteralPath $esaValuesPath -Value $content -NoNewline
    }

    if (Test-Path -LiteralPath $airgapDocPath) {
        $content = Get-Content -LiteralPath $airgapDocPath -Raw
        $content = $content -replace 'autoscalar-v\d{4}-\d{2}-\d{2}', $Tag
        $content = $content -replace 'runai-worker:\d{4}-\d{2}-\d{2}', "runai-worker:$Tag"
        $content = $content -replace 'clearml-images-slim-\d{4}-\d{2}-\d{2}\.tar', "clearml-images-slim-$Tag.tar"
        Set-Content -LiteralPath $airgapDocPath -Value $content -NoNewline
    }
}

if (-not (Test-Path -LiteralPath $DockerPath)) {
    $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCommand) {
        throw "Docker executable not found at '$DockerPath' and docker is not available on PATH."
    }
    $DockerPath = $dockerCommand.Source
}

Push-Location $PSScriptRoot
try {
    $serverImage = "clearml/clearml:$Tag"
    $workerImage = "clearml/runai-worker:$Tag"
    $artifactDir = Join-Path $PSScriptRoot "dist\clearml-airgap-$Tag"
    $slimTar = Join-Path $artifactDir "clearml-images-slim-$Tag.tar"
    $chartZip = Join-Path $artifactDir "clearml-charts-$Tag.zip"
    $shaFile = Join-Path $artifactDir "SHA256SUMS.txt"

    New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

    Update-AirgapChartTags -ChartsPath $ChartsPath -Tag $Tag
    $runaiV1Sha256 = Get-FileSha256 -Path $RunaiV1Path
    $runaiV2Sha256 = Get-FileSha256 -Path $RunaiV2Path
    $ocTarSha256 = Get-FileSha256 -Path $OcTarPath

    $previousAirgapImageTag = $env:AIRGAP_IMAGE_TAG
    $env:AIRGAP_IMAGE_TAG = $serverImage
    try {
        Invoke-Step "Build ClearML server image $serverImage" {
            & $DockerPath compose --env-file $EnvFile -f $ComposeFile build $ComposeService
        }
    }
    finally {
        $env:AIRGAP_IMAGE_TAG = $previousAirgapImageTag
    }

    Invoke-Step "Build Run:ai worker image $workerImage from $serverImage" {
        & $DockerPath build `
            -f $RunaiWorkerDockerfile `
            --build-arg "BASE_IMAGE=$serverImage" `
            --build-arg "RUNAI_WORKER_VERSION=$Tag" `
            --build-arg "RUNAI_V1_SHA256=$runaiV1Sha256" `
            --build-arg "RUNAI_V2_SHA256=$runaiV2Sha256" `
            --build-arg "OC_TAR_SHA256=$ocTarSha256" `
            -t $workerImage `
            -t "clearml/runai-worker:local" `
            .
    }

    Invoke-Step "Save slim image tar $slimTar" {
        if (Test-Path -LiteralPath $slimTar) {
            Remove-Item -LiteralPath $slimTar -Force
        }
        & $DockerPath save -o $slimTar $serverImage $workerImage
    }

    Invoke-Step "Create chart zip $chartZip" {
        if (Test-Path -LiteralPath $chartZip) {
            Remove-Item -LiteralPath $chartZip -Force
        }
        Compress-Archive -Path $ChartsPath -DestinationPath $chartZip -Force
    }

    $shaLines = @(
        "$(Get-FileSha256 -Path $slimTar)  $(Split-Path -Leaf $slimTar)"
        "$(Get-FileSha256 -Path $chartZip)  $(Split-Path -Leaf $chartZip)"
    )
    Set-Content -LiteralPath $shaFile -Value $shaLines -Encoding ASCII

    Write-Host ""
    Write-Host "Done."
    Write-Host "Images:"
    Write-Host "  $serverImage"
    Write-Host "  $workerImage"
    Write-Host "Artifacts:"
    Get-ChildItem -LiteralPath $artifactDir | Select-Object Name,Length,LastWriteTime | Format-Table -AutoSize
    Write-Host "Checksums:"
    Get-Content -LiteralPath $shaFile
}
finally {
    Pop-Location
}
