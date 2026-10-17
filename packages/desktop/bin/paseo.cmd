@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "RESOURCES_DIR=%SCRIPT_DIR%.."
set /p APP_EXECUTABLE_NAME=<"%RESOURCES_DIR%\paseo-executable-name"
set "APP_EXECUTABLE=%RESOURCES_DIR%\..\%APP_EXECUTABLE_NAME%.exe"
if exist "%RESOURCES_DIR%\paseo-daemon-home-name" (
  set /p PASEO_DAEMON_HOME_NAME=<"%RESOURCES_DIR%\paseo-daemon-home-name"
)
if defined PASEO_DAEMON_HOME_NAME if not defined PASEO_HOME set "PASEO_HOME=%USERPROFILE%\%PASEO_DAEMON_HOME_NAME%"
if defined PASEO_DAEMON_HOME_NAME if not defined PASEO_LISTEN set /p PASEO_LISTEN=<"%RESOURCES_DIR%\paseo-daemon-listen"
if not exist "%APP_EXECUTABLE%" (
  echo Bundled Paseo executable not found at %APP_EXECUTABLE% 1>&2
  exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
set "PASEO_NODE_ENV=production"
rem PASEO_DESKTOP_MANAGED marks daemons started through this bundled CLI as
rem desktop-managed, so the desktop app restarts them when it upgrades.
set "PASEO_DESKTOP_MANAGED=1"
set "PASEO_CLI=%~f0"
"%APP_EXECUTABLE%" --disable-warning=DEP0040 "%RESOURCES_DIR%\app.asar.unpacked\dist\daemon\node-entrypoint-runner.js" node-script "%RESOURCES_DIR%\app.asar\node_modules\@getpaseo\cli\dist\index.js" %*
exit /b %errorlevel%
