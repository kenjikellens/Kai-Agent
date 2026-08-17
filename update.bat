@echo off
setlocal enabledelayedexpansion

set "DEST_VSCODE=%USERPROFILE%\.vscode\extensions\local-llm.kai-0.0.1"
set "DEST_ANTIGRAVITY=%USERPROFILE%\.antigravity\extensions\local-llm.kai-0.0.1"
set "DEST_ANTIGRAVITY_IDE=%USERPROFILE%\.antigravity-ide\extensions\local-llm.kai-0.0.1"

echo ========================================================
echo   Kai Agent - Quick Code Update
echo ========================================================
echo.

echo [1/2] Compiling TypeScript...
node code/node_modules/typescript/bin/tsc -p code
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] TypeScript compilation failed! Fix errors above.
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo [2/2] Syncing updated files to extensions directories...

:: VS Code
if exist "%USERPROFILE%\.vscode\extensions" (
    if not exist "%DEST_VSCODE%" mkdir "%DEST_VSCODE%"
    copy /Y "code\package.json" "%DEST_VSCODE%\package.json" >nul
    copy /Y "code\README.md" "%DEST_VSCODE%\README.md" >nul
    copy /Y "code\system_prompt.md" "%DEST_VSCODE%\system_prompt.md" >nul
    xcopy /E /I /Y "code\out" "%DEST_VSCODE%\out" >nul
    xcopy /E /I /Y "code\media" "%DEST_VSCODE%\media" >nul
    echo   - Synced to VS Code
)

:: Antigravity
if exist "%USERPROFILE%\.antigravity\extensions" (
    if not exist "%DEST_ANTIGRAVITY%" mkdir "%DEST_ANTIGRAVITY%"
    copy /Y "code\package.json" "%DEST_ANTIGRAVITY%\package.json" >nul
    copy /Y "code\README.md" "%DEST_ANTIGRAVITY%\README.md" >nul
    copy /Y "code\system_prompt.md" "%DEST_ANTIGRAVITY%\system_prompt.md" >nul
    xcopy /E /I /Y "code\out" "%DEST_ANTIGRAVITY%\out" >nul
    xcopy /E /I /Y "code\media" "%DEST_ANTIGRAVITY%\media" >nul
    echo   - Synced to Antigravity
)

:: Antigravity IDE
if exist "%USERPROFILE%\.antigravity-ide\extensions" (
    if not exist "%DEST_ANTIGRAVITY_IDE%" mkdir "%DEST_ANTIGRAVITY_IDE%"
    copy /Y "code\package.json" "%DEST_ANTIGRAVITY_IDE%\package.json" >nul
    copy /Y "code\README.md" "%DEST_ANTIGRAVITY_IDE%\README.md" >nul
    copy /Y "code\system_prompt.md" "%DEST_ANTIGRAVITY_IDE%\system_prompt.md" >nul
    xcopy /E /I /Y "code\out" "%DEST_ANTIGRAVITY_IDE%\out" >nul
    xcopy /E /I /Y "code\media" "%DEST_ANTIGRAVITY_IDE%\media" >nul
    echo   - Synced to Antigravity IDE
)

echo.
echo ========================================================
echo   [OK] Update complete in ~1 second!
echo   Press Ctrl+Shift+P in VS Code -> 'Developer: Reload Window'
echo ========================================================
echo.
timeout /t 3
