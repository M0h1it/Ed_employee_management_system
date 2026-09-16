@echo off
REM scripts/run-cleanup.bat
REM
REM Wraps `python -m app.cleanup_punch_photos` for Windows Task Scheduler.
REM Task Scheduler runs a task with no shell profile loaded — it does not
REM know about the venv, does not `cd` anywhere first, and (unlike a
REM person's own terminal) has no PowerShell activation step already run.
REM This script does all three explicitly, in order, so the scheduled task
REM only ever needs to point at THIS file, not reconstruct that setup itself.
REM
REM Logs every run's output to logs\cleanup_punch_photos.log, with a
REM timestamp header per run, since a scheduled task's own output is not
REM visible anywhere the person would normally look — the log file is the
REM only way to notice the job stopped running, or started failing.

setlocal
cd /d "%~dp0.."

if not exist logs mkdir logs

echo. >> logs\cleanup_punch_photos.log
echo ===== %date% %time% ===== >> logs\cleanup_punch_photos.log

call .venv\Scripts\activate.bat
python -m app.cleanup_punch_photos >> logs\cleanup_punch_photos.log 2>&1

echo Exit code: %ERRORLEVEL% >> logs\cleanup_punch_photos.log