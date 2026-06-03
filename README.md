# 🎓 Yapay Zeka Destekli E-Posta Sınıflandırma ve Güvenlik Asistanı

> **Tez / Bitirme Projesi Teslim ve Değerlendirme Kılavuzu**
> 
> * **Öğrenci:** Ahmet Sarp Kaya (20240108017)
> * **Danışman:** Prof. Dr. İbrahim Soğukpınar
> * **Kurum:** Piri Reis Üniversitesi - Bilgisayar Mühendisliği Bölümü - 2026
> * **Canlı API Sunucusu:** https://email-ai-plugin.onrender.com (Aktif)
> * **Kod Deposu:** https://github.com/NotMegalist/email-ai-plugin

---

## ⚡ Jüri Değerlendirme Seçenekleri (Test Kılavuzu)

Projeyi test edebilmeniz için iki farklı esnek seçenek sunulmuştur:

### Seçenek A: Kurulumsuz Canlı Test (Önerilen)
Bilgisayarınıza hiçbir Python, kütüphane veya paket kurulumu **yapmadan** eklentinin yapay zekasını test edebilirsiniz:
1. Teslim klasörü içerisindeki **`demo.html`** dosyasına çift tıklayarak tarayıcınızda açın.
2. Üst durum çubuğundaki **Bağlantı** seçeneğinin `☁️ Canlı Bulut (Render.com)` olarak seçildiğinden emin olun (varsayılan ayarlıdır).
3. Hazır örnek butonlarına (**Normal, Önemli, Spam, Oltalama**) tıklayarak metin şablonlarını yükleyin ve **"Sınıflandır"** butonuna basın. Sonuçlar Render bulut sunucumuz üzerinden anında döndürülecektir.

### Seçenek B: Yerel (Lokal) Sunucu Testi
Projeyi tamamen kendi bilgisayarınızda yerel olarak çalıştırıp test etmek isterseniz:
1. Projenin kök dizininde bulunan **`install_and_run.bat`** dosyasına çift tıklayın. Betik otomatik olarak yerel sanal ortamı (`venv`) kuracak, bağımlılıkları yükleyecek ve yerel Flask API sunucusunu (`http://localhost:5000`) başlatacaktır.
2. Sunucu başladıktan sonra **`demo.html`** dosyasını tarayıcınızda açın.
3. Üst durum çubuğundaki **Bağlantı** açılır menüsünden **`💻 Yerel Sunucu (Localhost:5000)`** seçeneğini seçin.
4. Örnek butonlarına tıklayarak veya kendi belirlediğiniz metinleri girerek yerelinizde çalışan yapay zeka modelinin tahmin başarısını test edebilirsiniz.

---

## Proje Özeti
Gmail'e entegre çalışan, yapay zeka destekli e-posta sınıflandırma eklentisi.
E-postaları **Normal**, **Önemli**, **Spam** ve **Oltalama (Phishing)** olmak üzere 4 kategoriye ayırır.

## Proje Yapısı

```
email-ai-plugin/
├── backend/
│   ├── app.py              # Flask REST API (ana sunucu)
│   └── requirements.txt    # Python bağımlılıkları
├── model/
│   ├── train_model.py      # Model eğitim scripti
│   ├── email_classifier.pkl   # (train sonrası oluşur)
│   └── tfidf_vectorizer.pkl   # (train sonrası oluşur)
├── plugin/
│   └── Code.gs             # Google Apps Script (Gmail eklentisi)
└── README.md
```

## Kurulum ve Çalıştırma

### A. Kolay Kurulum ve Başlatma (Windows)
Sistemi tek tıkla kurup çalıştırmak için projenin kök dizinindeki `install_and_run.bat` dosyasına çift tıklamanız yeterlidir. Bu betik otomatik olarak:
* Bilgisayardaki Python kurulumunu doğrular.
* Gerekli sanal ortamı (`venv`) oluşturur.
* Gerekli kütüphaneleri yükler (`requirements.txt`).
* Modeli eğitir ve kaydeder.
* Flask API sunucusunu `http://localhost:5000` portunda başlatır.

### B. Manuel Kurulum ve Başlatma

#### 1. Model Eğitimi

```bash
cd model/

# (Opsiyonel) Kaggle dataset'i indirip 'emails.csv' olarak bu klasöre koy
# https://www.kaggle.com/datasets/balaka18/email-spam-classification-dataset-csv

# Modeli eğit (dataset yoksa sentetik data kullanır)
python train_model.py
```

### 2. Flask API'yi Başlat

```bash
cd backend/

# Bağımlılıkları yükle
pip install -r requirements.txt

# API'yi başlat
python app.py
```

API `http://localhost:5000` adresinde çalışmaya başlar.

### 3. ngrok ile İnternete Aç (Geliştirme için)

```bash
# ngrok indir: https://ngrok.com/download
ngrok http 5000
```

ngrok size bir URL verecek: `https://xxxx.ngrok-free.app`

### 4. Gmail Eklentisi Kurulumu

1. [script.google.com](https://script.google.com) adresine git
2. **Yeni Proje** oluştur
3. `plugin/Code.gs` içeriğini yapıştır
4. Dosyanın en üstündeki `API_URL` değişkenini ngrok URL'nizle güncelle:
   ```javascript
   const API_URL = "https://xxxx.ngrok-free.app";
   ```
5. **setupTrigger()** fonksiyonunu çalıştır (tetikleyici kurar)
6. **testApiConnection()** fonksiyonunu çalıştırarak bağlantıyı test et

## API Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/health` | GET | API sağlık kontrolü |
| `/classify` | POST | Tek e-posta sınıflandır |
| `/classify/batch` | POST | Toplu e-posta sınıflandır |

### Örnek İstek (`/classify`):
```json
{
  "subject": "URGENT: Your account has been suspended",
  "body": "Click here to verify your identity...",
  "sender": "noreply@suspicious.com"
}
```

### Örnek Yanıt:
```json
{
  "category": "Oltalama",
  "confidence": 0.9234,
  "category_code": 3,
  "details": {
    "subject_preview": "URGENT: Your account...",
    "all_probabilities": {
      "Normal": 0.02,
      "Önemli": 0.03,
      "Spam": 0.12,
      "Oltalama": 0.83
    }
  }
}
```

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| ML Modeli | TF-IDF + Naive Bayes (MultinomialNB) (scikit-learn) |
| Backend API | Python Flask + Flask-CORS |
| Gmail Entegrasyon | Google Apps Script (JavaScript) |
| Tünel (Geliştirme) | ngrok |
| Ücretsiz Sunucu (Üretim) | Render.com veya Railway.app |

## Ücretsiz Sunucu Seçenekleri (Sürekli Çalışma için)

Ngrok geliştirme içindir ve yeniden başlatmada URL değişir. Kalıcı bir sunucu için:

### Render.com (Önerilen - Ücretsiz Canlı Sunucu)
1. [render.com](https://render.com) üye ol
2. GitHub'a backend klasörünü push et
3. "New Web Service" oluştur → GitHub repoyu bağla
4. Build command: `pip install -r requirements.txt`
5. Start command: `gunicorn app:app` (Flask'ın yerleşik sunucusu yerine canlı ortam için gunicorn WSGI sunucusu kullanılır)
6. Ücretsiz tier: Ayda 750 saat (yeterli)
7. Size kalıcı bir URL verecek (örn: `https://email-ai.onrender.com`)
8. Code.gs'teki `API_URL`'yi bu URL ile güncelle

### Railway.app (Alternatif)
1. [railway.app](https://railway.app) üye ol
2. "Deploy from GitHub Repo" seç
3. `$5/ay` ücretsiz kredi (düşük trafikte yeterli)

## Kategoriler ve Açıklamaları

| Kategori | Gmail Etiketi | Açıklama |
|----------|---------------|----------|
| Normal | AI-Normal | Günlük rutin e-postalar |
| Önemli | AI-Önemli | Acil, fatura, toplantı gibi önemli e-postalar |
| Spam | AI-Spam | İstenmeyen promosyon içerikleri |
| Oltalama | AI-Oltalama | Kimlik avı / phishing girişimleri (+ uyarı e-postası) |
