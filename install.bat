@echo off
set "DEST_VSCODE=%USERPROFILE%\.vscode\extensions\local-llm.kai-0.0.1"
set "DEST_ANTIGRAVITY=%USERPROFILE%\.antigravity\extensions\local-llm.kai-0.0.1"

echo Cleaning up old directories...
if exist "%USERPROFILE%\.vscode\extensions\lm-studio-agent" rmdir /S /Q "%USERPROFILE%\.vscode\extensions\lm-studio-agent"
if exist "%USERPROFILE%\.antigravity\extensions\lm-studio-agent" rmdir /S /Q "%USERPROFILE%\.antigravity\extensions\lm-studio-agent"
if exist "%USERPROFILE%\.vscode\extensions\local-llm.lm-studio-agent-0.0.1" rmdir /S /Q "%USERPROFILE%\.vscode\extensions\local-llm.lm-studio-agent-0.0.1"
if exist "%USERPROFILE%\.antigravity\extensions\local-llm.lm-studio-agent-0.0.1" rmdir /S /Q "%USERPROFILE%\.antigravity\extensions\local-llm.lm-studio-agent-0.0.1"
if exist "%DEST_VSCODE%" rmdir /S /Q "%DEST_VSCODE%"
if exist "%DEST_ANTIGRAVITY%" rmdir /S /Q "%DEST_ANTIGRAVITY%"

echo.
echo Copying to VS Code extensions directory: %DEST_VSCODE%
if not exist "%DEST_VSCODE%" mkdir "%DEST_VSCODE%"
copy /Y "code\package.json" "%DEST_VSCODE%\package.json" >nul
copy /Y "code\README.md" "%DEST_VSCODE%\README.md" >nul
copy /Y "code\system_prompt.md" "%DEST_VSCODE%\system_prompt.md" >nul
xcopy /E /I /Y "code\out" "%DEST_VSCODE%\out" >nul
xcopy /E /I /Y "code\media" "%DEST_VSCODE%\media" >nul

echo Copying to Antigravity extensions directory: %DEST_ANTIGRAVITY%
if not exist "%DEST_ANTIGRAVITY%" mkdir "%DEST_ANTIGRAVITY%"
copy /Y "code\package.json" "%DEST_ANTIGRAVITY%\package.json" >nul
copy /Y "code\README.md" "%DEST_ANTIGRAVITY%\README.md" >nul
copy /Y "code\system_prompt.md" "%DEST_ANTIGRAVITY%\system_prompt.md" >nul
xcopy /E /I /Y "code\out" "%DEST_ANTIGRAVITY%\out" >nul
xcopy /E /I /Y "code\media" "%DEST_ANTIGRAVITY%\media" >nul

echo.
echo Installation complete! Please restart VS Code to load the extension.
echo.
pause

