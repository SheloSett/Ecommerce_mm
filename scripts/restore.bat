@echo off
:: Restaurar base de datos desde un archivo .sql
:: Uso: arrastra el archivo .sql sobre este .bat, o ejecutalo y escribe la ruta

setlocal

:: Leer variables del .env
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if "%%A"=="DB_NAME"     set DB_NAME=%%B
    if "%%A"=="DB_USER"     set DB_USER=%%B
    if "%%A"=="DB_PASSWORD" set DB_PASSWORD=%%B
)

:: Archivo pasado como argumento (drag & drop) o pedir al usuario
if "%~1"=="" (
    echo Ingresa la ruta al archivo de backup .sql:
    set /p BACKUP_FILE="> "
) else (
    set BACKUP_FILE=%~1
)

if not exist "%BACKUP_FILE%" (
    echo ERROR: El archivo "%BACKUP_FILE%" no existe.
    pause
    exit /b 1
)

echo.
echo ATENCION: Esto va a RESTAURAR la base de datos desde:
echo   %BACKUP_FILE%
echo.
echo Los datos actuales NO se borran: los registros del backup se insertan/sobreescriben.
echo.
set /p CONFIRM=Continuar? [s/N]:

if /i not "%CONFIRM%"=="s" (
    echo Cancelado.
    pause
    exit /b 0
)

echo.
echo Restaurando...

docker exec -i ecommerce_db psql -U %DB_USER% %DB_NAME% < "%BACKUP_FILE%"

if %ERRORLEVEL% == 0 (
    echo.
    echo Restauracion completada.
) else (
    echo.
    echo ERROR durante la restauracion. Revisa el log arriba.
)

pause
