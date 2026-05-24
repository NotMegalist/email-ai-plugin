@echo off
title GitHub'a Yukleme Yardimcisi
color 0B
echo ====================================================
echo GitHub Reposuna Yukleme Yardimcisi
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

:: Git reposu başlatma
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
git commit -m "Initial commit for Render deployment"

echo.
echo ====================================================
echo Yapmaniz Gereken Son Adimlar:
echo ====================================================
echo 1. GitHub hesabinizda bos bir repository (depo) olusturun.
echo 2. Olusturdugunuz deponun baglantisini kopyalayip asagidaki komutu calistirin:
echo    (KULLANICI_ADINIZ ve REPO_ADINIZ kisimlarini kendi deponuzla degistirin)
echo.
echo    git remote add origin https://github.com/KULLANICI_ADINIZ/REPO_ADINIZ.git
echo.
echo 3. Ardindan dosyalari yuklemek icin su komutu calistirin:
echo    git push -u origin main
echo ====================================================
echo.
pause
