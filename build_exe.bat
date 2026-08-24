@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo   KAI Agent - Building Executable
echo ======================================================

cd /d "%~dp0"

if not exist node_modules (
    echo [0/4] Installing npm dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install npm dependencies (Exit Code: %ERRORLEVEL%^).
        echo Please check your internet connection or run 'npm install' manually to see details.
        echo.
        pause
        exit /b 1
    )
)

echo [1/4] Compiling TypeScript source files...
call npm run compile
if errorlevel 1 (
    echo.
    echo [ERROR] TypeScript compilation failed (Exit Code: %ERRORLEVEL%^).
    echo Check the TypeScript compiler output above for specific code/type errors.
    echo.
    pause
    exit /b 1
)

echo [2/4] Building standalone executable with Electron Builder...
taskkill /f /im "KAI Agent.exe" >nul 2>&1
taskkill /f /im "7za.exe" >nul 2>&1
taskkill /f /im "rcedit-x64.exe" >nul 2>&1

if exist "release_temp" (
    rmdir /s /q "release_temp" >nul 2>&1
)

call npx electron-builder --win portable --config.directories.output="release_temp"
if errorlevel 1 (
    echo.
    echo [ERROR] Electron Builder packaging failed (Exit Code: %ERRORLEVEL%^).
    echo Check the Electron Builder output above for packaging/configuration errors.
    echo.
    pause
    exit /b 1
)

echo [3/4] Moving executable to KAI Agent App root...
set FOUND_EXE=0
for %%F in (release_temp\*.exe) do (
    copy /y "%%F" ".\KAI Agent.exe" >nul
    if not errorlevel 1 (
        set FOUND_EXE=1
    )
)
if "%FOUND_EXE%"=="0" (
    echo.
    echo [ERROR] No executable was found in 'release_temp' to copy.
    echo.
    pause
    exit /b 1
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
