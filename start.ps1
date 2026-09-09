#!/usr/bin/env pwsh
<#
============================================================
 WeatherGPT - Windows / PowerShell Startup Script

 Services started:
   Java backend       :8080  (Spring Boot — weather/climate/alerts)
   Python ML backend  :8000  (FastAPI + LangChain agent + route weather)
   frontend           :5173  (React/Vite — desktop dashboard)
   frontend2          :5174  (React/Vite — AI chat interface)
   voice service      :8001  (Python TTS/STT, optional)

 Usage:
   .\start.ps1             Start all services (default)
   .\start.ps1 backend     Java backend only
   .\start.ps1 ml          Python ML backend only
   .\start.ps1 frontend    Both frontends
   .\start.ps1 frontend1   Desktop dashboard (:5173)
   .\start.ps1 frontend2   AI chat interface (:5174)
   .\start.ps1 voice       Voice service only
   .\start.ps1 setup       Install all dependencies + pull Ollama model
   .\start.ps1 test        Run Java backend tests
   .\start.ps1 build       Build all
   .\start.ps1 stop        Stop all WeatherGPT services
   .\start.ps1 status      Show running services

 Environment overrides:
   $env:OLLAMA_MODEL   Ollama model to pull/use (default: llama3.2)
   $env:VOICE_ENABLED  Enable voice service (default: false)
============================================================
#>

param(
    [Parameter(Position = 0)]
    [string]$Command = "start"
)

$ErrorActionPreference = "Stop"

$ProjectDir   = $PSScriptRoot
$BackendDir   = Join-Path $ProjectDir "backend"
$FrontendDir  = Join-Path $ProjectDir "frontend"
$Frontend2Dir = Join-Path $ProjectDir "frontend2"
$MlDir        = Join-Path $ProjectDir "ML"
$VoiceDir     = Join-Path $ProjectDir "voice_service"
$VenvDir      = Join-Path $ProjectDir ".venv"

$BackendPort   = 8080
$MlPort        = 8000
$FrontendPort  = 5173
$Frontend2Port = 5174
$VoicePort     = 8001
$OllamaPort    = 11434

$OllamaModel  = if ($env:OLLAMA_MODEL)  { $env:OLLAMA_MODEL }  else { "llama3.2" }
$VoiceEnabled = if ($env:VOICE_ENABLED) { $env:VOICE_ENABLED } else { "false" }

$script:BackendProcess   = $null
$script:MlProcess        = $null
$script:FrontendProcess  = $null
$script:Frontend2Process = $null
$script:VoiceProcess     = $null
$script:OllamaProcess    = $null

# ------------------------------------------------------------
# Logging helpers
# ------------------------------------------------------------

function Write-Info    { param([string]$m); Write-Host "[INFO] "    -ForegroundColor Blue   -NoNewline; Write-Host $m }
function Write-Success { param([string]$m); Write-Host "[OK] "      -ForegroundColor Green  -NoNewline; Write-Host $m }
function Write-Warn    { param([string]$m); Write-Host "[WARN] "    -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Write-Err     { param([string]$m); Write-Host "[ERROR] "   -ForegroundColor Red    -NoNewline; Write-Host $m }

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

function Test-RequiredCommand {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Err "Required command not found: $Name"
        exit 1
    }
}

function Test-PortInUse {
    param([int]$Port)
    try {
        $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        return ($c.Count -gt 0)
    } catch {
        return [bool](netstat -ano | Select-String -Pattern ":$Port\s+.*LISTENING")
    }
}

function Stop-Port {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        if ($conns) {
            Write-Warn "Stopping process(es) on port $Port..."
            foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Seconds 1
            Write-Success "Port $Port freed."
        }
    } catch {
        Write-Warn "Could not query port $Port."
    }
}

# Resolve python executable: prefer venv, fall back to python3/python
function Get-PythonCmd {
    $venvPy = Join-Path $VenvDir "Scripts\python.exe"
    if (Test-Path $venvPy) { return $venvPy }
    if (Get-Command "python3" -ErrorAction SilentlyContinue) { return "python3" }
    return "python"
}

function Get-UvicornCmd {
    $venvUv = Join-Path $VenvDir "Scripts\uvicorn.exe"
    if (Test-Path $venvUv) { return $venvUv }
    return "uvicorn"
}

# ------------------------------------------------------------
# Cleanup
# ------------------------------------------------------------

function Invoke-Cleanup {
    Write-Host ""
    Write-Info "Stopping WeatherGPT..."
    foreach ($p in @($script:BackendProcess, $script:MlProcess, $script:FrontendProcess,
                     $script:Frontend2Process, $script:VoiceProcess, $script:OllamaProcess)) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
    Write-Success "WeatherGPT stopped."
}

# ------------------------------------------------------------
# Ollama
# ------------------------------------------------------------

function Invoke-OllamaPull {
    if (-not (Get-Command "ollama" -ErrorAction SilentlyContinue)) {
        Write-Warn "Ollama not installed — skipping model pull."
        return
    }

    Write-Info "Ensuring Ollama model '$OllamaModel' is available..."

    $list = & ollama list 2>&1
    if ($list -match $OllamaModel) {
        Write-Success "Model '$OllamaModel' already present."
        return
    }

    if (-not (Test-PortInUse $OllamaPort)) {
        Write-Info "Starting Ollama server..."
        $script:OllamaProcess = Start-Process -FilePath "ollama" -ArgumentList "serve" `
            -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput "$env:TEMP\weathergpt-ollama.log" `
            -RedirectStandardError  "$env:TEMP\weathergpt-ollama.err.log"
        $i = 0
        while ($i -lt 20 -and -not (Test-PortInUse $OllamaPort)) { Start-Sleep 1; $i++ }
    }

    & ollama pull $OllamaModel
    if ($LASTEXITCODE -eq 0) { Write-Success "Model '$OllamaModel' ready." }
    else { Write-Warn "Could not pull '$OllamaModel' — ML backend may fail." }
}

# ------------------------------------------------------------
# Java backend
# ------------------------------------------------------------

function Start-Backend {
    Test-RequiredCommand "java"
    Test-RequiredCommand "mvn"

    if (Test-PortInUse $BackendPort) {
        Write-Warn "Port $BackendPort already in use — assuming Java backend is running."
        Write-Info "Java backend: http://localhost:$BackendPort"; return
    }

    Write-Info "Starting Java backend (Spring Boot) on :$BackendPort..."
    $script:BackendProcess = Start-Process -FilePath "mvn" -ArgumentList "spring-boot:run" `
        -WorkingDirectory $BackendDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$env:TEMP\weathergpt-backend.log" `
        -RedirectStandardError  "$env:TEMP\weathergpt-backend.err.log"

    $i = 0
    while ($i -lt 90) {
        if (Test-PortInUse $BackendPort) { Write-Success "Java backend → http://localhost:$BackendPort"; return }
        if ($script:BackendProcess.HasExited) { Write-Err "Java backend exited unexpectedly."; exit 1 }
        Start-Sleep 1; $i++
    }
    Write-Err "Java backend did not start in 90 seconds."; exit 1
}

# ------------------------------------------------------------
# Python ML backend
# ------------------------------------------------------------

function Start-Ml {
    $mainPy = Join-Path $MlDir "main.py"
    if (-not (Test-Path $mainPy)) { Write-Warn "ML/main.py not found — skipping."; return }

    if (Test-PortInUse $MlPort) {
        Write-Warn "Port $MlPort already in use — assuming ML backend is running."
        Write-Info "ML backend: http://localhost:$MlPort"; return
    }

    $uvicorn = Get-UvicornCmd
    if (-not (Get-Command $uvicorn -ErrorAction SilentlyContinue) -and $uvicorn -eq "uvicorn") {
        Write-Warn "uvicorn not found — skipping ML backend. Run: pip install -r ML\requirements.txt"
        return
    }

    Write-Info "Starting Python ML backend (FastAPI) on :$MlPort..."
    $env:OLLAMA_MODEL = $OllamaModel
    $script:MlProcess = Start-Process -FilePath $uvicorn `
        -ArgumentList "main:app", "--host", "0.0.0.0", "--port", "$MlPort", "--reload" `
        -WorkingDirectory $MlDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$env:TEMP\weathergpt-ml.log" `
        -RedirectStandardError  "$env:TEMP\weathergpt-ml.err.log"

    $i = 0
    while ($i -lt 30) {
        if (Test-PortInUse $MlPort) { Write-Success "ML backend → http://localhost:$MlPort"; return }
        if ($script:MlProcess.HasExited) { Write-Warn "ML backend exited — check Ollama is running."; return }
        Start-Sleep 1; $i++
    }
    Write-Warn "ML backend did not start in 30 seconds."
}

# ------------------------------------------------------------
# Voice service
# ------------------------------------------------------------

function Start-VoiceService {
    $mainPy = Join-Path $VoiceDir "main.py"
    if (-not (Test-Path $mainPy)) { Write-Warn "Voice service not found — skipping."; return }

    if (Test-PortInUse $VoicePort) {
        Write-Warn "Port $VoicePort already in use."; return
    }

    Write-Info "Starting voice service on :$VoicePort..."
    $py = Get-PythonCmd
    $script:VoiceProcess = Start-Process -FilePath $py -ArgumentList "main.py" `
        -WorkingDirectory $VoiceDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$env:TEMP\weathergpt-voice.log" `
        -RedirectStandardError  "$env:TEMP\weathergpt-voice.err.log"

    $i = 0
    while ($i -lt 30) {
        if (Test-PortInUse $VoicePort) { Write-Success "Voice service → http://localhost:$VoicePort"; return }
        if ($script:VoiceProcess.HasExited) { Write-Warn "Voice service exited."; return }
        Start-Sleep 1; $i++
    }
    Write-Warn "Voice service did not start in 30 seconds."
}

# ------------------------------------------------------------
# frontend (desktop dashboard :5173)
# ------------------------------------------------------------

function Start-Frontend {
    Test-RequiredCommand "npm"
    if (Test-PortInUse $FrontendPort) {
        Write-Warn "Port $FrontendPort already in use."
        Write-Info "frontend: http://localhost:$FrontendPort"; return
    }
    Write-Info "Starting frontend (desktop dashboard) on :$FrontendPort..."
    $script:FrontendProcess = Start-Process -FilePath "npm" -ArgumentList "run", "dev" `
        -WorkingDirectory $FrontendDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$env:TEMP\weathergpt-frontend.log" `
        -RedirectStandardError  "$env:TEMP\weathergpt-frontend.err.log"

    $i = 0
    while ($i -lt 30) {
        if (Test-PortInUse $FrontendPort) { Write-Success "frontend → http://localhost:$FrontendPort"; return }
        if ($script:FrontendProcess.HasExited) { Write-Err "frontend exited unexpectedly."; exit 1 }
        Start-Sleep 1; $i++
    }
    Write-Warn "frontend did not start in 30 seconds."
}

# ------------------------------------------------------------
# frontend2 (AI chat :5174)
# ------------------------------------------------------------

function Start-Frontend2 {
    Test-RequiredCommand "npm"
    if (Test-PortInUse $Frontend2Port) {
        Write-Warn "Port $Frontend2Port already in use."
        Write-Info "frontend2: http://localhost:$Frontend2Port"; return
    }
    Write-Info "Starting frontend2 (AI chat) on :$Frontend2Port..."
    $script:Frontend2Process = Start-Process -FilePath "npm" -ArgumentList "run", "dev" `
        -WorkingDirectory $Frontend2Dir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$env:TEMP\weathergpt-frontend2.log" `
        -RedirectStandardError  "$env:TEMP\weathergpt-frontend2.err.log"

    $i = 0
    while ($i -lt 30) {
        if (Test-PortInUse $Frontend2Port) { Write-Success "frontend2 → http://localhost:$Frontend2Port"; return }
        if ($script:Frontend2Process.HasExited) { Write-Err "frontend2 exited unexpectedly."; exit 1 }
        Start-Sleep 1; $i++
    }
    Write-Warn "frontend2 did not start in 30 seconds."
}

# ------------------------------------------------------------
# Setup
# ------------------------------------------------------------

function Invoke-Setup {
    Test-RequiredCommand "mvn"
    Test-RequiredCommand "npm"

    Write-Host ""
    Write-Host "============================================================"
    Write-Host "                 WEATHERGPT SETUP"
    Write-Host "============================================================"
    Write-Host ""

    Write-Info "Installing Java backend dependencies (Maven)..."
    Push-Location $BackendDir; try { mvn -q dependency:resolve } finally { Pop-Location }
    Write-Success "Java deps resolved."

    Write-Info "Installing frontend deps (npm)..."
    Push-Location $FrontendDir; try { npm install } finally { Pop-Location }
    Write-Success "frontend deps installed."

    Write-Info "Installing frontend2 deps (npm)..."
    Push-Location $Frontend2Dir; try { npm install } finally { Pop-Location }
    Write-Success "frontend2 deps installed."

    $reqTxt = Join-Path $MlDir "requirements.txt"
    if (Test-Path $reqTxt) {
        $venvPip = Join-Path $VenvDir "Scripts\pip.exe"
        $pipCmd  = if (Test-Path $venvPip) { $venvPip } elseif (Get-Command "pip3" -ErrorAction SilentlyContinue) { "pip3" } else { "pip" }
        Write-Info "Installing Python ML deps ($pipCmd)..."
        & $pipCmd install -r $reqTxt -q
        Write-Success "Python ML deps installed."
    }

    Invoke-OllamaPull

    Write-Host ""
    Write-Success "Setup complete. Run .\start.ps1 to launch."
    Write-Host ""
}

# ------------------------------------------------------------
# Test / Build
# ------------------------------------------------------------

function Invoke-Tests {
    Test-RequiredCommand "mvn"
    Write-Info "Running Java backend tests..."
    Push-Location $BackendDir; try { mvn clean test } finally { Pop-Location }
    Write-Success "Tests completed."
}

function Build-All {
    Test-RequiredCommand "mvn"
    Test-RequiredCommand "npm"
    Write-Info "Building Java backend..."
    Push-Location $BackendDir; try { mvn clean package -DskipTests } finally { Pop-Location }
    Write-Success "Java backend built."
    Write-Info "Building frontend..."
    Push-Location $FrontendDir; try { npm run build } finally { Pop-Location }
    Write-Success "frontend built."
    Write-Info "Building frontend2..."
    Push-Location $Frontend2Dir; try { npm run build } finally { Pop-Location }
    Write-Success "frontend2 built."
}

function Stop-Services {
    Write-Info "Stopping all services..."
    Stop-Port $BackendPort
    Stop-Port $MlPort
    Stop-Port $FrontendPort
    Stop-Port $Frontend2Port
    Stop-Port $VoicePort
    Write-Success "All services stopped."
}

function Show-Status {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "                 WEATHERGPT STATUS"
    Write-Host "============================================================"
    Write-Host ""
    $checks = @(
        @{ Port = $BackendPort;   Name = "Java backend" },
        @{ Port = $MlPort;        Name = "Python ML backend" },
        @{ Port = $FrontendPort;  Name = "frontend (desktop)" },
        @{ Port = $Frontend2Port; Name = "frontend2 (AI chat)" },
        @{ Port = $VoicePort;     Name = "Voice service" },
        @{ Port = $OllamaPort;    Name = "Ollama" }
    )
    foreach ($c in $checks) {
        $status = if (Test-PortInUse $c.Port) { "running → http://localhost:$($c.Port)" } else { "not running" }
        Write-Host ("  {0,-32} {1}" -f $c.Name, $status)
    }
    Write-Host ""
}

# ------------------------------------------------------------
# Summary banner
# ------------------------------------------------------------

function Print-Summary {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "  WeatherGPT is running"
    Write-Host "============================================================"
    Write-Host ""
    Write-Host ("  {0,-34} {1}" -f "Java backend (Spring Boot):",  "http://localhost:$BackendPort")
    Write-Host ("  {0,-34} {1}" -f "Python ML backend (FastAPI):", "http://localhost:$MlPort")
    Write-Host ("  {0,-34} {1}" -f "Frontend (desktop dashboard):", "http://localhost:$FrontendPort")
    Write-Host ("  {0,-34} {1}" -f "Frontend2 (AI chat):",          "http://localhost:$Frontend2Port")
    if (Test-PortInUse $VoicePort) {
        Write-Host ("  {0,-34} {1}" -f "Voice service:", "http://localhost:$VoicePort")
    }
    Write-Host ""
    Write-Host "  Ollama model: $OllamaModel"
    Write-Host ""
    Write-Host "  Press Ctrl+C to stop."
    Write-Host ""
}

# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

switch ($Command) {

    "start" {
        Write-Host ""
        Write-Host "============================================================"
        Write-Host "                 WEATHERGPT STARTUP"
        Write-Host "============================================================"
        Write-Host ""

        try {
            Invoke-OllamaPull
            Start-Backend
            Start-Ml
            Start-VoiceService
            Start-Frontend
            Start-Frontend2
            Print-Summary

            while ($true) {
                Start-Sleep -Seconds 30
                if ($script:BackendProcess   -and $script:BackendProcess.HasExited)   { Write-Err "Java backend stopped.";   break }
                if ($script:FrontendProcess  -and $script:FrontendProcess.HasExited)  { Write-Err "frontend stopped.";       break }
                if ($script:Frontend2Process -and $script:Frontend2Process.HasExited) { Write-Err "frontend2 stopped.";      break }
                if ($script:MlProcess        -and $script:MlProcess.HasExited)        { Write-Warn "ML backend stopped." }
            }
        } finally { Invoke-Cleanup }
    }

    "backend"   { try { Invoke-OllamaPull; Start-Backend;    if ($script:BackendProcess)   { Wait-Process -Id $script:BackendProcess.Id   } } finally { Invoke-Cleanup } }
    "ml"        { try { Invoke-OllamaPull; Start-Ml;         if ($script:MlProcess)        { Wait-Process -Id $script:MlProcess.Id        } } finally { Invoke-Cleanup } }
    "frontend"  { try { Start-Frontend; Start-Frontend2; if ($script:FrontendProcess)  { Wait-Process -Id $script:FrontendProcess.Id  } } finally { Invoke-Cleanup } }
    "frontend1" { try { Start-Frontend;  if ($script:FrontendProcess)  { Wait-Process -Id $script:FrontendProcess.Id  } } finally { Invoke-Cleanup } }
    "frontend2" { try { Start-Frontend2; if ($script:Frontend2Process) { Wait-Process -Id $script:Frontend2Process.Id } } finally { Invoke-Cleanup } }
    "voice"     { try { Start-VoiceService; if ($script:VoiceProcess) { Wait-Process -Id $script:VoiceProcess.Id } } finally { Invoke-Cleanup } }
    "setup"     { Invoke-Setup }
    "test"      { Invoke-Tests }
    "build"     { Build-All }
    "stop"      { Stop-Services }
    "status"    { Show-Status }

    default {
        Write-Err "Unknown command: $Command"
        Write-Host ""
        Write-Host "Usage: .\start.ps1 [COMMAND]"
        Write-Host "  start      Start all services (default)"
        Write-Host "  backend    Java backend only"
        Write-Host "  ml         Python ML backend only"
        Write-Host "  frontend   Both frontends"
        Write-Host "  frontend1  Desktop dashboard (:5173)"
        Write-Host "  frontend2  AI chat interface (:5174)"
        Write-Host "  voice      Voice service only"
        Write-Host "  setup      Install all dependencies"
        Write-Host "  test       Run Java backend tests"
        Write-Host "  build      Build all"
        Write-Host "  stop       Stop all services"
        Write-Host "  status     Show service status"
        exit 1
    }
}
