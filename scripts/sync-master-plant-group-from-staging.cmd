@echo off
REM Sync master_plants.group_plant from staging to local (bypasses PowerShell execution policy).
REM Usage:
REM   scripts\sync-master-plant-group-from-staging.cmd
REM   scripts\sync-master-plant-group-from-staging.cmd -Apply
REM   scripts\sync-master-plant-group-from-staging.cmd -ApplyOnly -CsvPath tmp\export.csv -Apply

setlocal EnableExtensions
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-master-plant-group-from-staging.ps1" %*
endlocal
