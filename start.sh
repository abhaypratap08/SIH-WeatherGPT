#!/usr/bin/env sh

# ============================================================
# WeatherGPT - Universal Startup Script
#
# Compatible with: bash, zsh, sh
# Fish users: use start.fish
#
# Services started:
#   Java backend       :8080  (Spring Boot — weather/climate/alerts)
#   Python ML backend  :8000  (FastAPI + LangChain agent + route weather)
#   frontend           :5173  (React/Vite — unified app, all pages)
#   voice service      :8001  (Python TTS/STT, optional)
#
# Usage:
#   ./start.sh              Start all services
#   ./start.sh backend      Java backend only
#   ./start.sh ml           Python ML backend only
#   ./start.sh frontend     Frontend only
#   ./start.sh voice        Voice service only
#   ./start.sh setup        Install all dependencies + pull Ollama model
#   ./start.sh test         Run backend tests
#   ./start.sh build        Build all
#   ./start.sh stop         Stop all services
#   ./start.sh status       Show running services
#
# Environment overrides:
#   OLLAMA_MODEL   Ollama model to use (default: llama3.2)
#   VOICE_ENABLED  Enable voice service (default: false)
# ============================================================

set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
ML_DIR="$PROJECT_DIR/ML"
VOICE_DIR="$PROJECT_DIR/voice_service"
VENV_DIR="$PROJECT_DIR/.venv"

BACKEND_PORT=8080
ML_PORT=8000
FRONTEND_PORT=5173
VOICE_PORT=8001
OLLAMA_PORT=11434

OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2}"
VOICE_ENABLED="${VOICE_ENABLED:-false}"

BACKEND_PID="" ML_PID="" FRONTEND_PID="" VOICE_PID="" OLLAMA_PID=""

# ------------------------------------------------------------
# Colors
# ------------------------------------------------------------
if [ -t 1 ]; then
    RED="$(printf '\033[0;31m')" GREEN="$(printf '\033[0;32m')"
    YELLOW="$(printf '\033[1;33m')" BLUE="$(printf '\033[0;34m')" NC="$(printf '\033[0m')"
else
    RED="" GREEN="" YELLOW="" BLUE="" NC=""
fi
info()    { printf "%s[INFO]%s %s\n"  "$BLUE"   "$NC" "$1"; }
success() { printf "%s[OK]%s %s\n"    "$GREEN"  "$NC" "$1"; }
warn()    { printf "%s[WARN]%s %s\n"  "$YELLOW" "$NC" "$1"; }
error()   { printf "%s[ERROR]%s %s\n" "$RED"    "$NC" "$1"; }

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
require_command() { command -v "$1" >/dev/null 2>&1 || { error "Required command not found: $1"; exit 1; }; }

port_in_use() {
    if command -v lsof >/dev/null 2>&1; then lsof -i ":$1" >/dev/null 2>&1; return $?; fi
    if command -v ss   >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -q ":$1 "; return $?; fi
    return 1
}

stop_port() {
    if command -v lsof >/dev/null 2>&1; then
        PIDS="$(lsof -ti ":$1" 2>/dev/null || true)"
        if [ -n "$PIDS" ]; then
            warn "Stopping process on port $1..."
            for P in $PIDS; do kill "$P" 2>/dev/null || true; done
            sleep 1
            for P in $(lsof -ti ":$1" 2>/dev/null || true); do kill -9 "$P" 2>/dev/null || true; done
            success "Port $1 freed."
        fi
    fi
}

python_cmd()  { [ -f "$VENV_DIR/bin/python" ]  && echo "$VENV_DIR/bin/python"  || (command -v python3 >/dev/null 2>&1 && echo python3 || echo python); }
uvicorn_cmd() { [ -f "$VENV_DIR/bin/uvicorn" ] && echo "$VENV_DIR/bin/uvicorn" || echo uvicorn; }

# ------------------------------------------------------------
# Cleanup
# ------------------------------------------------------------
cleanup() {
    printf "\n"; info "Stopping WeatherGPT..."
    for P in $BACKEND_PID $ML_PID $FRONTEND_PID $VOICE_PID $OLLAMA_PID; do
        [ -n "$P" ] && kill "$P" 2>/dev/null || true
    done
    success "WeatherGPT stopped."; exit 0
}
trap cleanup INT TERM

# ------------------------------------------------------------
# Ollama
# ------------------------------------------------------------
pull_ollama_model() {
    command -v ollama >/dev/null 2>&1 || { warn "Ollama not installed — skipping model pull."; return; }
    info "Ensuring Ollama model '$OLLAMA_MODEL' is available..."
    ollama list 2>/dev/null | grep -q "$OLLAMA_MODEL" && { success "Model '$OLLAMA_MODEL' already present."; return; }
    if ! port_in_use "$OLLAMA_PORT"; then
        info "Starting Ollama server..."; ollama serve >/tmp/weathergpt-ollama.log 2>&1 & OLLAMA_PID=$!
        COUNT=0; while [ "$COUNT" -lt 20 ] && ! port_in_use "$OLLAMA_PORT"; do sleep 1; COUNT=$((COUNT+1)); done
    fi
    ollama pull "$OLLAMA_MODEL" && success "Model '$OLLAMA_MODEL' ready." || warn "Could not pull '$OLLAMA_MODEL'."
}

# ------------------------------------------------------------
# Java backend
# ------------------------------------------------------------
start_backend() {
    require_command java; require_command mvn
    [ -f "$BACKEND_DIR/pom.xml" ] || { error "pom.xml not found"; exit 1; }
    if port_in_use "$BACKEND_PORT"; then warn "Port $BACKEND_PORT in use — assuming Java backend is running."; info "Java backend: http://localhost:$BACKEND_PORT"; return; fi
    info "Starting Java backend (Spring Boot) on :$BACKEND_PORT..."
    ( cd "$BACKEND_DIR" && mvn spring-boot:run ) & BACKEND_PID=$!
    COUNT=0
    while [ "$COUNT" -lt 90 ]; do
        port_in_use "$BACKEND_PORT" && { success "Java backend → http://localhost:$BACKEND_PORT"; return; }
        kill -0 "$BACKEND_PID" 2>/dev/null || { error "Java backend exited unexpectedly."; exit 1; }
        sleep 1; COUNT=$((COUNT+1))
    done
    error "Java backend did not start in 90 seconds."; exit 1
}

# ------------------------------------------------------------
# Python ML backend
# ------------------------------------------------------------
start_ml() {
    [ -f "$ML_DIR/main.py" ] || { warn "ML/main.py not found — skipping."; return; }
    UVCORN="$(uvicorn_cmd)"
    ! command -v "$UVCORN" >/dev/null 2>&1 && [ "$UVCORN" = "uvicorn" ] && { warn "uvicorn not found — skipping. Run: pip install -r ML/requirements.txt"; return; }
    if port_in_use "$ML_PORT"; then warn "Port $ML_PORT in use — assuming ML backend is running."; info "ML backend: http://localhost:$ML_PORT"; return; fi
    info "Starting Python ML backend on :$ML_PORT..."
    ( cd "$ML_DIR" && OLLAMA_MODEL="$OLLAMA_MODEL" "$(uvicorn_cmd)" main:app --host 0.0.0.0 --port "$ML_PORT" --reload ) & ML_PID=$!
    COUNT=0
    while [ "$COUNT" -lt 30 ]; do
        port_in_use "$ML_PORT" && { success "ML backend → http://localhost:$ML_PORT"; return; }
        kill -0 "$ML_PID" 2>/dev/null || { warn "ML backend exited — check Ollama is running."; return; }
        sleep 1; COUNT=$((COUNT+1))
    done
    warn "ML backend did not start in 30 seconds."
}

# ------------------------------------------------------------
# Voice service
# ------------------------------------------------------------
start_voice_service() {
    [ -f "$VOICE_DIR/main.py" ] || { warn "Voice service not found — skipping."; return; }
    if port_in_use "$VOICE_PORT"; then warn "Port $VOICE_PORT in use."; return; fi
    info "Starting voice service on :$VOICE_PORT..."
    ( cd "$VOICE_DIR" && "$(python_cmd)" main.py ) & VOICE_PID=$!
    COUNT=0
    while [ "$COUNT" -lt 30 ]; do
        port_in_use "$VOICE_PORT" && { success "Voice service → http://localhost:$VOICE_PORT"; return; }
        kill -0 "$VOICE_PID" 2>/dev/null || { warn "Voice service exited."; return; }
        sleep 1; COUNT=$((COUNT+1))
    done
    warn "Voice service did not start in 30 seconds."
}

# ------------------------------------------------------------
# Frontend (unified app on :5173)
# ------------------------------------------------------------
start_frontend() {
    require_command npm
    [ -f "$FRONTEND_DIR/package.json" ] || { warn "frontend/package.json not found — skipping."; return; }
    if port_in_use "$FRONTEND_PORT"; then warn "Port $FRONTEND_PORT in use."; info "Frontend: http://localhost:$FRONTEND_PORT"; return; fi
    info "Starting frontend on :$FRONTEND_PORT..."
    ( cd "$FRONTEND_DIR" && npm run dev ) & FRONTEND_PID=$!
    COUNT=0
    while [ "$COUNT" -lt 30 ]; do
        port_in_use "$FRONTEND_PORT" && { success "Frontend → http://localhost:$FRONTEND_PORT"; return; }
        kill -0 "$FRONTEND_PID" 2>/dev/null || { error "Frontend exited unexpectedly."; exit 1; }
        sleep 1; COUNT=$((COUNT+1))
    done
    warn "Frontend did not start in 30 seconds."
}

# ------------------------------------------------------------
# Setup
# ------------------------------------------------------------
setup_project() {
    require_command mvn; require_command npm
    printf "\n============================================================\n"
    printf "                 WEATHERGPT SETUP\n"
    printf "============================================================\n\n"
    info "Installing Java backend dependencies (Maven)..."
    ( cd "$BACKEND_DIR" && mvn -q dependency:resolve ); success "Java deps resolved."
    info "Installing frontend dependencies (npm)..."
    ( cd "$FRONTEND_DIR" && npm install ); success "Frontend deps installed."
    if [ -f "$ML_DIR/requirements.txt" ]; then
        if [ -f "$VENV_DIR/bin/pip" ]; then PIP="$VENV_DIR/bin/pip"
        elif command -v pip3 >/dev/null 2>&1; then PIP="pip3"
        else PIP="pip"; fi
        info "Installing Python ML dependencies ($PIP)..."; "$PIP" install -r "$ML_DIR/requirements.txt" -q; success "Python ML deps installed."
    fi
    pull_ollama_model
    printf "\n"; success "Setup complete. Run ./start.sh to launch."; printf "\n"
}

# ------------------------------------------------------------
# Test / Build / Stop
# ------------------------------------------------------------
run_tests() { require_command mvn; info "Running Java backend tests..."; ( cd "$BACKEND_DIR" && mvn clean test ); success "Tests completed."; }

build_all() {
    require_command mvn; require_command npm
    info "Building Java backend..."; ( cd "$BACKEND_DIR" && mvn clean package -DskipTests ); success "Java backend built."
    info "Building frontend..."; ( cd "$FRONTEND_DIR" && npm run build ); success "Frontend built."
}

stop_services() {
    info "Stopping all services..."
    stop_port "$BACKEND_PORT"; stop_port "$ML_PORT"; stop_port "$FRONTEND_PORT"; stop_port "$VOICE_PORT"
    success "All services stopped."
}

print_summary() {
    printf "\n============================================================\n"
    printf "  WeatherGPT is running\n"
    printf "============================================================\n\n"
    printf "  %-32s %s\n" "Java backend (Spring Boot):"   "http://localhost:$BACKEND_PORT"
    printf "  %-32s %s\n" "Python ML backend (FastAPI):"  "http://localhost:$ML_PORT"
    printf "  %-32s %s\n" "Frontend (unified, all pages):" "http://localhost:$FRONTEND_PORT"
    port_in_use "$VOICE_PORT" && printf "  %-32s %s\n" "Voice service:" "http://localhost:$VOICE_PORT"
    printf "\n  Ollama model: %s\n" "$OLLAMA_MODEL"
    printf "\n  Press Ctrl+C to stop all services.\n\n"
}

# ------------------------------------------------------------
# Main
# ------------------------------------------------------------
COMMAND="${1:-start}"
case "$COMMAND" in
    start)
        printf "\n============================================================\n"
        printf "                 WEATHERGPT STARTUP\n"
        printf "============================================================\n\n"
        pull_ollama_model; start_backend; start_ml; start_voice_service; start_frontend
        print_summary
        while true; do
            sleep 30
            [ -n "$BACKEND_PID"  ] && ! kill -0 "$BACKEND_PID"  2>/dev/null && { error "Java backend stopped.";  cleanup; }
            [ -n "$FRONTEND_PID" ] && ! kill -0 "$FRONTEND_PID" 2>/dev/null && { error "Frontend stopped.";      cleanup; }
        done ;;
    backend)
        pull_ollama_model; start_backend; [ -n "$BACKEND_PID" ] && wait "$BACKEND_PID" ;;
    ml)
        pull_ollama_model; start_ml; [ -n "$ML_PID" ] && wait "$ML_PID" ;;
    frontend)
        start_frontend; [ -n "$FRONTEND_PID" ] && wait "$FRONTEND_PID" ;;
    voice)
        start_voice_service; [ -n "$VOICE_PID" ] && wait "$VOICE_PID" ;;
    setup)   setup_project ;;
    test)    run_tests ;;
    build)   build_all ;;
    stop)    stop_services ;;
    status)
        printf "\n============================================================\n"
        printf "                 WEATHERGPT STATUS\n"
        printf "============================================================\n\n"
        for ENTRY in "$BACKEND_PORT:Java backend" "$ML_PORT:Python ML backend" "$FRONTEND_PORT:Frontend" "$VOICE_PORT:Voice service" "$OLLAMA_PORT:Ollama"; do
            PORT="${ENTRY%%:*}"; NAME="${ENTRY#*:}"
            if port_in_use "$PORT"; then printf "  %-32s running → http://localhost:%s\n" "$NAME" "$PORT"
            else printf "  %-32s not running\n" "$NAME"; fi
        done; printf "\n" ;;
    *)
        error "Unknown command: $COMMAND"
        printf "\nUsage: ./start.sh [COMMAND]\n"
        printf "  start     Start all services (default)\n  backend   Java backend\n  ml        Python ML backend\n  frontend  Frontend\n  voice     Voice service\n  setup     Install deps\n  test      Run tests\n  build     Build all\n  stop      Stop all\n  status    Show status\n"
        exit 1 ;;
esac
