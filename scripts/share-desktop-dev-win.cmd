@echo off
setlocal EnableExtensions

for /f "usebackq delims=" %%I in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do set "VSPATH=%%I"
if not defined VSPATH set "VSPATH=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
set "VCVARS=%VSPATH%\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo Visual Studio Build Tools with the C++ workload are required.
  echo Install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
  echo Select "Desktop development with C++" and the Windows 10/11 SDK.
  exit /b 1
)

call "%VCVARS%" >nul 2>&1

set "SDKINC=%TEMP%\winsdk-full\c\Include\10.0.22621.0"
if exist "%SDKINC%\ucrt\stddef.h" (
  set "INCLUDE=%SDKINC%\ucrt;%SDKINC%\um;%SDKINC%\shared;%INCLUDE%"
)

set "SDKLIB=%TEMP%\winsdk\c"
if exist "%SDKLIB%\um\x64\kernel32.Lib" (
  set "LIB=%SDKLIB%\um\x64;%SDKLIB%\ucrt\x64;%LIB%"
)

set "RCBIN=%TEMP%\winsdk-full\c\bin\10.0.22621.0\x64"
if exist "%RCBIN%\rc.exe" set "PATH=%RCBIN%;%PATH%"

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
rem libopus is built with CMake. NMake uses cl.exe from this environment.
set CMAKE_POLICY_VERSION_MINIMUM=3.5
set CMAKE_GENERATOR=NMake Makefiles

cd /d "%~dp0.."
if /I "%~1"=="build" (
  npm run tauri build --prefix apps/share-desktop
) else (
  npm run tauri dev --prefix apps/share-desktop
)
exit /b %ERRORLEVEL%
