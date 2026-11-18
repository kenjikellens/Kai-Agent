@echo off
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

set "EXE_PATH=%~dp0target\release\kai-agent-tauri.exe"

if not exist "%EXE_PATH%" (
    echo Building KAI Agent Rust release binary...
    cargo build --release -p kai-agent-tauri
    if errorlevel 1 (
        echo Build failed.
        pause
        exit /b 1
    )
)

start "" "%EXE_PATH%"
endlocal
