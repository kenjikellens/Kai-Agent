@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0"

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "REQ_FILE=%~dp0requirements.txt"
set "EXE_PATH=%~dp0target\release\kai-agent-tauri.exe"

echo Checking requirements from requirements.txt...
if not exist "%REQ_FILE%" (
    echo [ERROR] Requirements file not found: "%REQ_FILE%"
    pause
    popd
    exit /b 1
)

for /f "usebackq eol=# tokens=1-6 delims=|" %%A in ("%REQ_FILE%") do (
    call :ensure_requirement "%%~A" "%%~B" "%%~C" "%%~D" "%%~E" "%%~F"
    if !errorlevel! neq 0 (
        echo.
        echo [ERROR] Failed to satisfy requirement: %%~A
        pause
        popd
        exit /b 1
    )
)

if not exist "%EXE_PATH%" (
    echo.
    echo Building KAI Agent Rust release binary...
    cargo build --release -p kai-agent-tauri
    if !errorlevel! neq 0 (
        echo Build failed.
        pause
        popd
        exit /b 1
    )
)

start "" "%EXE_PATH%"
popd
endlocal
exit /b 0

:: ---------------------------------------------------------------------------
:: Ensures a single requirement from requirements.txt is present, downloading
:: and installing it via winget or direct fallback URL if missing.
:: ---------------------------------------------------------------------------
:ensure_requirement
set "REQ_ID=%~1"
set "REQ_KIND=%~2"
set "REQ_TARGET=%~3"
set "REQ_WINGET=%~4"
set "REQ_URL=%~5"
set "REQ_ARGS=%~6"

call :check_requirement "%REQ_KIND%" "%REQ_TARGET%"
if "%REQ_OK%"=="1" (
    echo   [OK] %REQ_ID%
    exit /b 0
)

echo   [MISSING] %REQ_ID% - downloading and installing...

where winget >nul 2>&1
if %errorlevel% equ 0 if not "%REQ_WINGET%"=="" (
    if /i "%REQ_KIND%"=="msvc" (
        winget install --id "%REQ_WINGET%" -e --source winget --accept-package-agreements --accept-source-agreements --override "%REQ_ARGS%"
    ) else (
        winget install --id "%REQ_WINGET%" -e --source winget --accept-package-agreements --accept-source-agreements --silent
    )
)

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
if /i "%REQ_ID%"=="rust" (
    where rustup >nul 2>&1
    if !errorlevel! equ 0 (
        where cargo >nul 2>&1
        if !errorlevel! neq 0 (
            rustup default stable
        )
    )
)

call :check_requirement "%REQ_KIND%" "%REQ_TARGET%"
if "%REQ_OK%"=="1" (
    echo   [INSTALLED] %REQ_ID%
    exit /b 0
)

if not "%REQ_URL%"=="" (
    set "TMP_EXE=%TEMP%\kai_req_%REQ_ID%.exe"
    echo   Downloading %REQ_ID% from fallback URL...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%REQ_URL%' -OutFile '!TMP_EXE!' -UseBasicParsing"
    if exist "!TMP_EXE!" (
        echo   Running installer for %REQ_ID%...
        "!TMP_EXE!" %REQ_ARGS%
        del /q "!TMP_EXE!" >nul 2>&1
    )
)

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
call :check_requirement "%REQ_KIND%" "%REQ_TARGET%"
if "%REQ_OK%"=="1" (
    echo   [INSTALLED] %REQ_ID%
    exit /b 0
)

exit /b 1

:: ---------------------------------------------------------------------------
:: Checks whether a requirement (cmd, msvc, webview2) is satisfied on this PC.
:: Sets REQ_OK=1 when present, REQ_OK=0 otherwise.
:: ---------------------------------------------------------------------------
:check_requirement
set "REQ_OK=0"
set "CHK_KIND=%~1"
set "CHK_TARGET=%~2"

if /i "%CHK_KIND%"=="cmd" (
    where "%CHK_TARGET%" >nul 2>&1 && set "REQ_OK=1"
    if "!REQ_OK!"=="0" if /i "%CHK_TARGET%"=="cargo" (
        if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "REQ_OK=1"
    )
    exit /b 0
)

if /i "%CHK_KIND%"=="msvc" (
    where cl >nul 2>&1 && set "REQ_OK=1"
    if "!REQ_OK!"=="0" (
        set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
        if exist "!VSWHERE!" (
            "!VSWHERE!" -latest -products * -requires "%CHK_TARGET%" -property installationPath | findstr /r "." >nul 2>&1 && set "REQ_OK=1"
        )
    )
    exit /b 0
)

if /i "%CHK_KIND%"=="webview2" (
    reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\%CHK_TARGET%" /v pv >nul 2>&1 && set "REQ_OK=1"
    if "!REQ_OK!"=="0" reg query "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\%CHK_TARGET%" /v pv >nul 2>&1 && set "REQ_OK=1"
    if "!REQ_OK!"=="0" reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\%CHK_TARGET%" /v pv >nul 2>&1 && set "REQ_OK=1"
    exit /b 0
)

exit /b 0
