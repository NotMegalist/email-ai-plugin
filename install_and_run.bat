@echo off
title Yapay Zeka Destekli E-Posta Asistani - Kurulum ve Calistirma
color 0A
echo ====================================================
echo Yapay Zeka Destekli E-Posta Asistani - Kurulum ve Baslatici
echo ====================================================
echo.

:: 1. Python Kontrolü
where python >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [HATA] Sisteminizde Python bulunamadi!
    echo Lutfen Python 3.8+ yukleyin ve "Add Python to PATH" secenegini isaretleyin.
    echo Python Indirme Adresi: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 2. Sanal Ortam (venv) Olusturma
if not exist venv (
    echo [*] Sanal ortam (venv) olusturuluyor, lutfen bekleyin...
    python -m venv venv
    if %errorlevel% neq 0 (
        color 0C
        echo [HATA] Sanal ortam olusturulamadi!
        pause
        exit /b 1
    )
    echo [OK] Sanal ortam basariyla olusturuldu.
) else (
    echo [*] Mevcut sanal ortam (venv) bulundu.
)

:: 3. Bagimliliklari Yukleme
echo [*] Bagimliliklar yukleniyor (requirements.txt)...
call venv\Scripts\pip install -r backend\requirements.txt
if %errorlevel% neq 0 (
    color 0C
    echo [HATA] Gerekli Python kutuphaneleri yuklenemedi!
    pause
    exit /b 1
)
echo [OK] Bagimliliklar basariyla yuklendi.

:: 4. Model Kontrolü ve Egitimi
if not exist model\email_classifier.pkl (
    echo [*] Egitilmis model dosyasi bulunamadi. Model egitimi baslatiliyor...
    call venv\Scripts\python model\train_model.py
    if %errorlevel% neq 0 (
        color 0C
        echo [HATA] Model egitimi sirasinda bir sorun olustu!
        pause
        exit /b 1
    )
    echo [OK] Model basariyla egitildi ve kaydedildi.
) else (
    echo [*] Egitilmis model dosyasi bulundu.
)

:: 5. Flask API'yi Baslatma
echo.
echo ====================================================
echo [OK] Kurulum ve Kontroller Basarili!
echo REST API Sunucusu Baslatiliyor...
echo Sunucu Adresi: http://localhost:5000
echo ====================================================
echo.
call venv\Scripts\python backend\app.py
pause
