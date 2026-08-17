@echo off
set "DEST_VSCODE=%USERPROFILE%\.vscode\extensions\local-llm.kai-0.0.1"
set "DEST_ANTIGRAVITY=%USERPROFILE%\.antigravity\extensions\local-llm.kai-0.0.1"
set "DEST_ANTIGRAVITY_IDE=%USERPROFILE%\.antigravity-ide\extensions\local-llm.kai-0.0.1"

echo ========================================================
echo   Installing Kai Agent Extension for VS Code / IDE
echo ========================================================
echo.

echo [1/5] Cleaning up old directories...
if exist "%USERPROFILE%\.vscode\extensions\lm-studio-agent" rmdir /S /Q "%USERPROFILE%\.vscode\extensions\lm-studio-agent"
if exist "%USERPROFILE%\.antigravity\extensions\lm-studio-agent" rmdir /S /Q "%USERPROFILE%\.antigravity\extensions\lm-studio-agent"
if exist "%USERPROFILE%\.antigravity-ide\extensions\lm-studio-agent" rmdir /S /Q "%USERPROFILE%\.antigravity-ide\extensions\lm-studio-agent"
if exist "%USERPROFILE%\.vscode\extensions\local-llm.lm-studio-agent-0.0.1" rmdir /S /Q "%USERPROFILE%\.vscode\extensions\local-llm.lm-studio-agent-0.0.1"
if exist "%USERPROFILE%\.antigravity\extensions\local-llm.lm-studio-agent-0.0.1" rmdir /S /Q "%USERPROFILE%\.antigravity\extensions\local-llm.lm-studio-agent-0.0.1"
if exist "%USERPROFILE%\.antigravity-ide\extensions\local-llm.lm-studio-agent-0.0.1" rmdir /S /Q "%USERPROFILE%\.antigravity-ide\extensions\local-llm.lm-studio-agent-0.0.1"
if exist "%DEST_VSCODE%" rmdir /S /Q "%DEST_VSCODE%"
if exist "%DEST_ANTIGRAVITY%" rmdir /S /Q "%DEST_ANTIGRAVITY%"
if exist "%DEST_ANTIGRAVITY_IDE%" rmdir /S /Q "%DEST_ANTIGRAVITY_IDE%"

echo.
echo [2/5] Compiling TypeScript...
node code/node_modules/typescript/bin/tsc -p code
if %ERRORLEVEL% neq 0 (
    echo [ERROR] TypeScript compilation failed!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/5] Packaging VSIX extension...
pushd code
call npx --yes @vscode/vsce package --allow-missing-repository --no-dependencies --out "kai-0.0.1.vsix"
popd
if %ERRORLEVEL% neq 0 (
    echo [WARNING] VSIX packaging had an issue, falling back to manual copy...
)

echo.
echo [4/5] Installing VSIX package to VS Code / IDE...
where code >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Installing into VS Code via CLI...
    call code --install-extension "code\kai-0.0.1.vsix" --force
) else (
    echo VS Code CLI ('code') not found in PATH.
)

where agy >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Installing into Antigravity IDE via CLI...
    call agy --install-extension "code\kai-0.0.1.vsix" --force
)

echo.
echo [5/5] Syncing to extension directories...
if not exist "%DEST_VSCODE%" mkdir "%DEST_VSCODE%"
copy /Y "code\package.json" "%DEST_VSCODE%\package.json" >nul
copy /Y "code\README.md" "%DEST_VSCODE%\README.md" >nul
copy /Y "code\system_prompt.md" "%DEST_VSCODE%\system_prompt.md" >nul
xcopy /E /I /Y "code\out" "%DEST_VSCODE%\out" >nul
xcopy /E /I /Y "code\media" "%DEST_VSCODE%\media" >nul

if not exist "%DEST_ANTIGRAVITY%" mkdir "%DEST_ANTIGRAVITY%"
copy /Y "code\package.json" "%DEST_ANTIGRAVITY%\package.json" >nul
copy /Y "code\README.md" "%DEST_ANTIGRAVITY%\README.md" >nul
copy /Y "code\system_prompt.md" "%DEST_ANTIGRAVITY%\system_prompt.md" >nul
xcopy /E /I /Y "code\out" "%DEST_ANTIGRAVITY%\out" >nul
xcopy /E /I /Y "code\media" "%DEST_ANTIGRAVITY%\media" >nul

if not exist "%DEST_ANTIGRAVITY_IDE%" mkdir "%DEST_ANTIGRAVITY_IDE%"
copy /Y "code\package.json" "%DEST_ANTIGRAVITY_IDE%\package.json" >nul
copy /Y "code\README.md" "%DEST_ANTIGRAVITY_IDE%\README.md" >nul
copy /Y "code\system_prompt.md" "%DEST_ANTIGRAVITY_IDE%\system_prompt.md" >nul
xcopy /E /I /Y "code\out" "%DEST_ANTIGRAVITY_IDE%\out" >nul
xcopy /E /I /Y "code\media" "%DEST_ANTIGRAVITY_IDE%\media" >nul

echo.
echo ========================================================
echo   Installation complete!
echo   Please reload/restart VS Code to see Kai on the Activity Bar.
echo ========================================================
echo.
pause
