"""
Yapay Zeka Destekli E-Posta Kategorilendirme - Flask API
Kategoriler: Normal, Önemli, Spam, Oltalama (Phishing)
"""

from flask import Flask, request, jsonify  
from flask_cors import CORS
import pickle
import os
import re
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Google Apps Script'in erişebilmesi için

# Model ve vectorizer yolları
MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'model', 'email_classifier.pkl')
VECTORIZER_PATH = os.path.join(os.path.dirname(__file__), '..', 'model', 'tfidf_vectorizer.pkl')

model = None
vectorizer = None

def load_model():
    """Model ve vectorizer'ı belleğe yükle"""
    global model, vectorizer
    try:
        with open(MODEL_PATH, 'rb') as f:
            model = pickle.load(f)
        with open(VECTORIZER_PATH, 'rb') as f:
            vectorizer = pickle.load(f)
        logger.info("Model ve vectorizer başarıyla yüklendi.")
    except FileNotFoundError:
        logger.warning("Model dosyaları bulunamadı. Önce train_model.py çalıştırın.")

def preprocess_text(text: str) -> str:
    """E-posta metnini temizle ve normalize et"""
    if not text:
        return ""
    # Küçük harfe çevir
    text = text.lower()
    # URL'leri çıkar
    text = re.sub(r'http\S+|www\S+', 'URL', text)
    # E-posta adreslerini çıkar
    text = re.sub(r'\S+@\S+', 'EMAIL', text)
    # Özel karakterleri temizle
    text = re.sub(r'[^a-zA-Z0-9\s]', ' ', text)
    # Fazladan boşlukları temizle
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def phishing_rule_check(subject: str, body: str) -> bool:
    """
    Oltalama saldırılarını yakalamak için kural tabanlı ek kontrol.
    ML modeli ile birlikte kullanılır.
    """
    phishing_keywords = [
        'verify your account', 'click here immediately', 'your account has been suspended',
        'urgent action required', 'confirm your password', 'bank account details',
        'prize winner', 'claim your reward', 'limited time offer', 'act now',
        'hesabınız askıya alındı', 'şifrenizi doğrulayın', 'hemen tıklayın',
        'acil eylem gerekli', 'banka bilgileriniz', 'ödülünüzü talep edin',
        'verify your identity', 'security alert', 'suspicious activity',
        'güvenlik uyarısı', 'şüpheli etkinlik'
    ]
    combined = (subject + " " + body).lower()
    matches = sum(1 for kw in phishing_keywords if kw in combined)
    return matches >= 2  # En az 2 anahtar kelime eşleşmesi

@app.route('/health', methods=['GET'])
def health_check():
    """API sağlık kontrolü"""
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'message': 'E-Posta AI Asistanı çalışıyor'
    })

@app.route('/classify', methods=['POST'])
def classify_email():
    """
    E-posta sınıflandırma endpoint'i.
    
    Beklenen JSON body:
    {
        "subject": "E-posta konusu",
        "body": "E-posta gövde metni",
        "sender": "gonderen@email.com" (opsiyonel)
    }
    
    Dönen JSON:
    {
        "category": "Normal|Önemli|Spam|Oltalama",
        "confidence": 0.95,
        "category_code": 0,
        "details": {...}
    }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON body bekleniyor'}), 400

        subject = data.get('subject', '')
        body = data.get('body', '')

        if not subject and not body:
            return jsonify({'error': 'Konu veya gövde metni gereklidir'}), 400

        # Model yüklü değilse kural tabanlı sınıflandırma kullan
        if model is None or vectorizer is None:
            category, confidence = rule_based_classify(subject, body)
            return jsonify({
                'category': category,
                'confidence': confidence,
                'method': 'rule_based',
                'warning': 'ML modeli yüklü değil, kural tabanlı sınıflandırma kullanıldı'
            })

        # Metni ön işle
        combined_text = preprocess_text(f"{subject} {body}")

        # TF-IDF vektörü oluştur
        features = vectorizer.transform([combined_text])

        # Model tahmini
        prediction = model.predict(features)[0]
        probabilities = model.predict_proba(features)[0]
        confidence = float(max(probabilities))

        # Kategori etiketleri
        category_map = {
            0: 'Normal',
            1: 'Önemli',
            2: 'Spam',
            3: 'Oltalama'
        }
        category = category_map.get(int(prediction), 'Normal')

        # Oltalama kural kontrolü - ML modelini destekle
        if phishing_rule_check(subject, body) and category in ['Normal', 'Spam']:
            category = 'Oltalama'
            confidence = max(confidence, 0.75)
            logger.info(f"Kural tabanlı oltalama tespiti uygulandı: {subject[:50]}")

        logger.info(f"Sınıflandırıldı: '{subject[:50]}' -> {category} ({confidence:.2f})")

        return jsonify({
            'category': category,
            'confidence': round(confidence, 4),
            'category_code': int(prediction),
            'details': {
                'subject_preview': subject[:100],
                'all_probabilities': {
                    'Normal': round(float(probabilities[0]), 4),
                    'Önemli': round(float(probabilities[1]), 4),
                    'Spam': round(float(probabilities[2]), 4),
                    'Oltalama': round(float(probabilities[3]), 4)
                }
            }
        })

    except Exception as e:
        logger.error(f"Sınıflandırma hatası: {str(e)}")
        return jsonify({'error': f'Sunucu hatası: {str(e)}'}), 500

@app.route('/classify/batch', methods=['POST'])
def classify_batch():
    """
    Toplu e-posta sınıflandırma (birden fazla e-posta aynı anda).
    
    Beklenen JSON body:
    {
        "emails": [
            {"id": "msg_id", "subject": "...", "body": "...", "sender": "..."},
            ...
        ]
    }
    """
    try:
        data = request.get_json()
        emails = data.get('emails', [])

        if not emails:
            return jsonify({'error': 'E-posta listesi boş'}), 400

        results = []
        for email in emails:
            email_id = email.get('id', '')
            subject = email.get('subject', '')
            body = email.get('body', '')

            if model is not None and vectorizer is not None:
                combined = preprocess_text(f"{subject} {body}")
                features = vectorizer.transform([combined])
                prediction = model.predict(features)[0]
                probabilities = model.predict_proba(features)[0]
                confidence = float(max(probabilities))
                category_map = {0: 'Normal', 1: 'Önemli', 2: 'Spam', 3: 'Oltalama'}
                category = category_map.get(int(prediction), 'Normal')

                if phishing_rule_check(subject, body) and category in ['Normal', 'Spam']:
                    category = 'Oltalama'
                    confidence = max(confidence, 0.75)
            else:
                category, confidence = rule_based_classify(subject, body)

            results.append({
                'id': email_id,
                'category': category,
                'confidence': round(confidence, 4)
            })

        return jsonify({'results': results, 'total': len(results)})

    except Exception as e:
        logger.error(f"Toplu sınıflandırma hatası: {str(e)}")
        return jsonify({'error': str(e)}), 500

def rule_based_classify(subject: str, body: str) -> tuple:
    """
    ML modeli yüklü değilken kullanılan basit kural tabanlı sınıflandırıcı.
    Yalnızca geliştirme/test amaçlıdır.
    """
    combined = (subject + " " + body).lower()

    # Oltalama kontrol
    if phishing_rule_check(subject, body):
        return 'Oltalama', 0.80

    # Spam anahtar kelimeleri
    spam_keywords = ['unsubscribe', 'click here', 'free offer', 'make money',
                     'abonelikten çık', 'ücretsiz teklif', 'para kazan',
                     'kazandınız', 'kampanya', 'indirim']
    if sum(1 for kw in spam_keywords if kw in combined) >= 2:
        return 'Spam', 0.75

    # Önemli e-posta anahtar kelimeleri
    important_keywords = ['urgent', 'meeting', 'deadline', 'invoice', 'payment',
                          'acil', 'toplantı', 'son tarih', 'fatura', 'ödeme',
                          'sınav', 'ödev', 'proje', 'rapor']
    if sum(1 for kw in important_keywords if kw in combined) >= 1:
        return 'Önemli', 0.70

    return 'Normal', 0.65

if __name__ == '__main__':
    load_model()
    # Not: Production'da ngrok veya Render.com kullanılacak
    app.run(host='0.0.0.0', port=5000, debug=True)
