@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo   KAI Agent - Building Executable
echo ======================================================

cd /d "%~dp0"

echo [1/4] Compiling TypeScript source files...
call npm run compile
if errorlevel 1 (
    echo [ERROR] TypeScript compilation failed.
    pause
    exit /b 1
)

echo [2/4] Building standalone executable with Electron Builder...
call npx electron-builder --win portable --config.directories.output="release_temp"
if errorlevel 1 (
    echo [ERROR] Electron builder build failed.
    pause
    exit /b 1
)

echo [3/4] Moving executable to KAI Agent App root...
for %%F in (release_temp\*.exe) do (
    copy /y "%%F" ".\KAI Agent.exe" >nul
)

echo [4/4] Cleaning up temporary build artifacts...
if exist "release_temp" (
    rmdir /s /q "release_temp"
)

if exist "dist\builder-effective-config.yaml" (
    del /f /q "dist\builder-effective-config.yaml"
)

echo ======================================================
echo   Build complete! "KAI Agent.exe" is ready in:
echo   %~dp0KAI Agent.exe
echo ======================================================
pause
