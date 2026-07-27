@echo off
setlocal enabledelayedexpansion

:: Fichier de sortie
set "OUTPUT=output.txt"

:: Vide le fichier au debut
echo. > "%OUTPUT%"

:: Dossier racine du script
set "ROOT=%cd%"

for /r %%F in (*) do (

    :: Ignore le fichier de sortie
    if /I "%%~nxF"=="%OUTPUT%" (
        continue
    )

    :: Chemin complet
    set "FULL=%%F"

    :: Chemin relatif
    set "REL=%%F"
    set "REL=!REL:%ROOT%\=!"

    :: Vérifie si le fichier est dans src/
    echo "!REL!" | findstr /I "^src\\" >nul
    if !errorlevel! == 0 (
        goto :process
    )

    :: Vérifie si le fichier est à la racine (pas de sous-dossier)
    echo "!REL!" | findstr /R "^[^\\]*$" >nul
    if !errorlevel! == 0 (
        goto :process
    )

    :: Sinon on ignore
    continue

:process
    echo Chemin: %%F >> "%OUTPUT%"
    echo. >> "%OUTPUT%"

    type "%%F" >> "%OUTPUT%" 2>nul

    echo. >> "%OUTPUT%"
    echo. >> "%OUTPUT%"
)

echo Termine ! Resultat dans %OUTPUT%
pause
