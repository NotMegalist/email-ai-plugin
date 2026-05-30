@echo off
title GitHub'a Otomatik Yukleme Yardimcisi
color 0B
echo ====================================================
echo GitHub Reposuna Yukleme Yardimcisi (Otomatik)
echo ====================================================
echo.

:: Git kontrolü
where git >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [HATA] Sisteminizde Git kurulu bulunamadi!
    echo Lutfen Git yukleyin: https://git-scm.com/downloads
    pause
    exit /b 1
)

:: Git reposu kontrolü ve başlatma
if not exist .git (
    echo [*] Git deposu baslatiliyor...
    git init
    git branch -M main
) else (
    echo [*] Mevcut Git deposu bulundu.
)

:: .gitignore ve dosyaların eklenmesi
echo [*] Dosyalar index'e ekleniyor...
git add .gitignore
git add backend/
git add model/
git add plugin/
git add README.md
git add install_and_run.bat
git commit -m "Initial commit for Render deployment" 2>nul

echo.
echo ====================================================
echo 1. GitHub'da bos depo olusturduysaniz, asagidaki link benzeri baglantiyi kopyalayin:
echo    https://github.com/KULLANICI_ADINIZ/REPO_ADINIZ.git
echo.
echo 2. Kopyaladiginiz linki asagiya sag tiklayarak yapistirin ve ENTER'a basin:
echo ====================================================
echo.

set /p repo_url="GitHub Repository URL: "

if "%repo_url%"=="" (
    color 0C
    echo [HATA] Gecerli bir URL girmediniz. Islem iptal edildi.
    pause
    exit /b 1
)

:: Uzak sunucu adresi ekleme (Varsa eskiyi siler hata almamak için)
git remote remove origin 2>nul
git remote add origin %repo_url%

echo.
echo [*] Kodlariniz GitHub'a yukleniyor (git push)...
echo (Giris yapmaniz istenirse tarayici veya token ile giris yapin)
echo.

git push -u origin main

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [HATA] Kodlar yuklenemedi! 
    echo Lutfen GitHub kullanici adi/sifrenizin veya tokeninizin dogru oldugundan emin olun.
    pause
    exit /b 1
)

color 0A
echo.
echo ====================================================
echo [OK] Kodlariniz GitHub'a basariyla yuklendi!
echo Simdi Render.com uzerinden deploy adimina gecebilirsiniz.
echo ====================================================
echo.
pause
