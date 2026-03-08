param(
    [string]$Host = "127.0.0.1",
    [int]$Port = 8765,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

$EditorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $EditorRoot
$PythonExe = Join-Path $ProjectRoot ".conda\env-lc\python.exe"
$FrontendRoot = Join-Path $EditorRoot "frontend"

if (-not (Test-Path $PythonExe)) {
    throw "Expected Python environment at $PythonExe"
}

Push-Location $FrontendRoot
try {
    if ($Rebuild -or -not (Test-Path "dist")) {
        if (-not (Test-Path "node_modules")) {
            npm install
        }
        npm run build
    }
}
finally {
    Pop-Location
}

& $PythonExe (Join-Path $EditorRoot "server.py") --host $Host --port $Port --project-root $ProjectRoot
