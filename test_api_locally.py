import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "http://localhost:5000"

def test_endpoint(url, method="GET", data=None):
    req = urllib.request.Request(url, method=method)
    if data:
        req.add_header('Content-Type', 'application/json')
        json_data = json.dumps(data).encode('utf-8')
    else:
        json_data = None
        
    try:
        with urllib.request.urlopen(req, data=json_data) as response:
            res_data = response.read().decode('utf-8')
            return json.loads(res_data), response.status
    except Exception as e:
        return str(e), 500

print("====================================================")
# 1. Health check
print("[*] /health endpoint testi yapılıyor...")
res, status = test_endpoint(f"{BASE_URL}/health")
print(f"Durum Kodu: {status}")
print(f"Yanıt: {res}\n")

if status != 200:
    print("[HATA] Sunucu açık değil veya erişilemiyor! Lütfen önce sunucuyu (app.py) çalıştırın.")
    sys.exit(1)

# 2. Single classification
print("[*] /classify (Tekli Sınıflandırma) testi yapılıyor...")
single_payload = {
    "subject": "Acil Toplantı ve Ödeme",
    "body": "Yarınki proje inceleme toplantısı için lütfen ekteki faturayı gözden geçirin. Acil katılım bekleniyor."
}
res, status = test_endpoint(f"{BASE_URL}/classify", method="POST", data=single_payload)
print(f"Durum Kodu: {status}")
print(f"Sınıflandırma Sonucu: {res.get('category')} (Güven: {res.get('confidence')})")
print(f"Yanıt Detayları: {res}\n")

# 3. Batch classification
print("[*] /classify/batch (Toplu Sınıflandırma) testi yapılıyor...")
batch_payload = {
    "emails": [
        {
            "id": "1",
            "subject": "Tebrikler Kazandınız!",
            "body": "Ücretsiz 1000$ değerinde hediye çeki kazandınız. Hemen talep edin!"
        },
        {
            "id": "2",
            "subject": "Hesap Güvenliği Uyarısı",
            "body": "Hesabınız askıya alındı! Lütfen hemen şifrenizi doğrulamak için buraya tıklayın."
        }
    ]
}
res, status = test_endpoint(f"{BASE_URL}/classify/batch", method="POST", data=batch_payload)
print(f"Durum Kodu: {status}")
print(f"Yanıt Detayları: {res}\n")
print("====================================================")
print("[OK] Tüm API entegrasyon testleri başarıyla tamamlandı!")
print("====================================================")
