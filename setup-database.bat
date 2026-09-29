@echo off
setlocal
title KargoPazar - Database Setup
color 0B

echo.
echo  =============================================
echo    KargoPazar - Database Setup (MySQL 8)
echo  =============================================
echo.
echo  Usage: setup-database.bat [host] [port] [user] [password]
echo  (missing values are asked for; works for AWS RDS and local MySQL)
echo.

:: -- Check MySQL client ---------------------------------------------
where mysql >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  ERROR: mysql client not found in PATH.
    echo  Install MySQL Shell / MySQL Server client tools and add mysql.exe to PATH.
    echo  Typical path: C:\Program Files\MySQL\MySQL Server 8.0\bin
    pause
    exit /b 1
)
echo  MySQL client found.
echo.

:: -- Get credentials (args first, then prompt) ----------------------
set "MYSQL_HOST=%~1"
set "MYSQL_PORT=%~2"
set "MYSQL_USER=%~3"
set "MYSQL_PASS=%~4"
if "%MYSQL_HOST%"=="" (
    set "MYSQL_HOST=localhost"
    set /p MYSQL_HOST="MySQL Host (RDS endpoint) [localhost]: "
)
if "%MYSQL_PORT%"=="" (
    set "MYSQL_PORT=3306"
    set /p MYSQL_PORT="MySQL Port [3306]: "
)
if "%MYSQL_USER%"=="" (
    set "MYSQL_USER=admin"
    set /p MYSQL_USER="MySQL admin user (RDS master user) [admin]: "
)
if "%MYSQL_PASS%"=="" set /p MYSQL_PASS="MySQL Password: "
echo.

set "DB_DIR=%~dp0database"
set MYSQL_CMD=mysql -h %MYSQL_HOST% -P %MYSQL_PORT% -u %MYSQL_USER% -p%MYSQL_PASS% --default-character-set=utf8mb4

echo  Did you replace CHANGE_ME_STRONG_PASSWORD in database\000_CreateDatabase.sql?
set "GO=Y"
set /p GO="Continue? [Y/n]: "
if /I "%GO%"=="n" exit /b 1

:: -- 000: database + app user --------------------------------------
echo  [1/3] 000_CreateDatabase.sql (database kargopazar, user kargopazar_app)
%MYSQL_CMD% < "%DB_DIR%\000_CreateDatabase.sql"
if %ERRORLEVEL% NEQ 0 goto :fail

:: -- 001: schema ----------------------------------------------------
echo  [2/3] 001_InitialSchema.sql (tables)
%MYSQL_CMD% < "%DB_DIR%\001_InitialSchema.sql"
if %ERRORLEVEL% NEQ 0 goto :fail

:: -- 002: seed (optional) -------------------------------------------
echo.
echo  002_SeedData.sql is optional: the API seeds an empty database by itself
echo  on first start, with fresh dates.
set "SEED=N"
set /p SEED="Load 002_SeedData.sql now? [y/N]: "
if /I "%SEED%"=="y" (
    echo  [3/3] 002_SeedData.sql
    %MYSQL_CMD% < "%DB_DIR%\002_SeedData.sql"
    if errorlevel 1 goto :fail
) else (
    echo  [3/3] skipped
)

echo.
echo  =============================================
echo    Database ready.
echo  =============================================
echo.
echo  Database: kargopazar    App user: kargopazar_app
echo  Demo login (after seeding): demo / Demo123!
echo.
echo  App Runner env var ConnectionStrings__Default:
echo    Server=%MYSQL_HOST%;Port=%MYSQL_PORT%;Database=kargopazar;User=kargopazar_app;Password=YOUR_APP_PASSWORD;SslMode=Required;
echo.
pause
exit /b 0

:fail
echo.
echo  ERROR: a script failed. Check the credentials, network access (RDS security group) and the output above.
pause
exit /b 1
