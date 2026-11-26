@echo off
rem Refreshes src/workshop.json (every Sandustry Workshop mod: id, title, author, versions from the change notes)
rem from steamcommunity.com, then rebuilds mod/. Run it from anywhere, outside the game; the game can't reach Steam's
rem web pages, so Mod Sync ships this list.
rem Uses Node 18+ if it is on PATH, otherwise the game's own exe as Node (set SANDUSTRY_EXE if Steam is elsewhere).
rem   tools\refresh_workshop.bat              titles and authors (about 15 s; what each release needs)
rem   tools\refresh_workshop.bat --versions   also each mod's change-note versions (slow: Steam rate-limits those
rem                                           pages; it can take 10+ minutes or stop on HTTP 429, then retry later)
setlocal
cd /d "%~dp0.."
set "ARGS="
if /i "%~1"=="--versions" set "ARGS=--versions"

where node >nul 2>nul
if not errorlevel 1 (
  node tools\workshop_catalog.cjs %ARGS% || goto :fail
  node tools\build.cjs || goto :fail
  goto :done
)

if not defined SANDUSTRY_EXE (
  for %%P in ("%~dp0..\..\..\links\steam\Sandustry.exe" "D:\Steam\steamapps\common\Sandustry\Sandustry.exe" "C:\Program Files (x86)\Steam\steamapps\common\Sandustry\Sandustry.exe") do (
    if not defined SANDUSTRY_EXE if exist %%P set "SANDUSTRY_EXE=%%~P"
  )
)
if not defined SANDUSTRY_EXE (
  echo No Node on PATH and Sandustry.exe not found. Set SANDUSTRY_EXE to the game's exe and run again.
  goto :fail
)
set ELECTRON_RUN_AS_NODE=1
"%SANDUSTRY_EXE%" tools\workshop_catalog.cjs %ARGS% || goto :fail
"%SANDUSTRY_EXE%" tools\build.cjs || goto :fail

:done
echo.
echo Done. src\workshop.json and mod\ are up to date.
exit /b 0
:fail
echo.
echo Failed: nothing was shipped. See the message above.
exit /b 1
