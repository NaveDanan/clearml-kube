param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string]$DockerPath = "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    [string]$EnvFile = ".env.test",
    [string]$ComposeFile = "docker-compose.airgap.yml",
    [string]$ComposeService = "clearml-airgap",
    [string]$RunaiWorkerDockerfile = ".\clearml-server\docker\build\runai-worker.Dockerfile"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $DockerPath)) {
    throw "Docker executable not found: $DockerPath"
}

Push-Location $PSScriptRoot
try {
    & $DockerPath compose --env-file $EnvFile -f $ComposeFile build $ComposeService
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    & $DockerPath build `
        -f $RunaiWorkerDockerfile `
        --build-arg "BASE_IMAGE=clearml/clearml:$Tag" `
        --build-arg "RUNAI_WORKER_VERSION=$Tag" `
        -t "clearml/runai-worker:$Tag" `
        .

    exit $LASTEXITCODE
}
finally {
    Pop-Location
}