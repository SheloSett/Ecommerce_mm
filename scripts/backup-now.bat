@echo off
:: Backup manual de la base de datos PostgreSQL
:: Genera un archivo .sql con fecha y hora en la carpeta backups\

setlocal

:: Ir a la carpeta raiz del proyecto (un nivel arriba de scripts\)
cd /d "%~dp0.."

:: Obtener fecha y hora con PowerShell (compatible con Windows 11)
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TIMESTAMP=%%I

:: Leer variables del .env
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if "%%A"=="DB_NAME"     set DB_NAME=%%B
    if "%%A"=="DB_USER"     set DB_USER=%%B
    if "%%A"=="DB_PASSWORD" set DB_PASSWORD=%%B
)

if not defined DB_NAME (
    echo ERROR: No se pudo leer el archivo .env
    echo Asegurate de correr este script desde la carpeta del proyecto.
    pause
    exit /b 1
)

:: Crear carpeta backups si no existe
if not exist "backups" mkdir backups

set BACKUP_FILE=backups\manual_%TIMESTAMP%.sql

echo Generando backup: %BACKUP_FILE%

:: Ejecutar pg_dump dentro del contenedor de postgres
docker exec ecommerce_db pg_dump -U %DB_USER% %DB_NAME% > %BACKUP_FILE%

if %ERRORLEVEL% == 0 (
    echo.
    echo Backup guardado exitosamente en: %BACKUP_FILE%
) else (
    echo.
    echo ERROR: No se pudo generar el backup. Asegurate de que el contenedor ecommerce_db este corriendo.
    del "%BACKUP_FILE%" 2>nul
)

pause
