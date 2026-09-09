#!/usr/bin/env fish
# WeatherGPT — fish frontend for start.sh
#
# Usage (same commands as start.sh):
#   ./start.fish
#   ./start.fish backend
#   ./start.fish ml
#   ./start.fish frontend
#   ./start.fish frontend1
#   ./start.fish frontend2
#   ./start.fish voice
#   ./start.fish setup
#   ./start.fish test
#   ./start.fish build
#   ./start.fish stop
#   ./start.fish status
#
# Environment overrides:
#   set -x OLLAMA_MODEL llama3.2
#   set -x VOICE_ENABLED true

set -l script_dir (dirname (status filename))
set -l posix_script "$script_dir/start.sh"

if test ! -f "$posix_script"
    echo "[ERROR] start.sh not found: $posix_script" >&2
    exit 1
end

set -l command (count $argv) -gt 0 && echo $argv[1] || echo ""

# --help
if test "$argv[1]" = "--help"; or test "$argv[1]" = "-h"
    echo ""
    echo "WeatherGPT — fish startup wrapper"
    echo "=================================="
    echo ""
    echo "Usage: ./start.fish [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  (no args)  Start all services"
    echo "  backend    Java backend only         (:8080)"
    echo "  ml         Python ML backend only    (:8000)"
    echo "  frontend   Both frontends"
    echo "  frontend1  Desktop dashboard         (:5173)"
    echo "  frontend2  AI chat interface         (:5174)"
    echo "  voice      Voice service only        (:8001)"
    echo "  setup      Install all dependencies + pull Ollama model"
    echo "  test       Run Java backend tests"
    echo "  build      Build all (backend + both frontends)"
    echo "  stop       Stop all WeatherGPT services"
    echo "  status     Show running services"
    echo ""
    echo "Environment overrides:"
    echo "  set -x OLLAMA_MODEL llama3.2"
    echo "  set -x VOICE_ENABLED true"
    exit 0
end

# Inline status (fish-native output)
if test (count $argv) -gt 0; and test "$argv[1]" = "status"
    echo ""
    echo "============================================================"
    echo "                 WEATHERGPT STATUS"
    echo "============================================================"
    echo ""

    for entry in "8080:Java backend" "8000:Python ML backend" "5173:frontend (desktop)" "5174:frontend2 (AI chat)" "8001:Voice service" "11434:Ollama"
        set -l port (string split ":" $entry)[1]
        set -l name (string split ":" $entry)[2]
        if lsof -i :$port >/dev/null 2>&1
            printf "  %-32s running → http://localhost:%s\n" "$name" "$port"
        else
            printf "  %-32s not running\n" "$name"
        end
    end
    echo ""
    exit 0
end

# Forward everything else to the POSIX script
if test (count $argv) -eq 0
    exec sh "$posix_script" start
else
    exec sh "$posix_script" $argv
end
