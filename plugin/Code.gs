/**
 * Yapay Zeka Destekli Gmail E-Posta Kategorilendirme Eklentisi
 * Google Apps Script (GAS) ile Gmail entegrasyonu
 * 
 * Kurulum:
 * 1. Gmail hesabınıza giriş yapın
 * 2. script.google.com adresine gidin
 * 3. Bu kodu yapıştırın
 * 4. API_URL değişkenini Flask API adresinizle güncelleyin
 * 5. Deploy > New deployment > Add-on olarak yayınlayın
 * 
 * Geliştirme ortamı için: API_URL'yi ngrok URL'siyle değiştirin
 * Üretim ortamı için: Render.com veya Railway.app ücretsiz sunucu kullanın
 */

// ============================================================
// YAPILANDIRMA
// ============================================================

// Flask API URL - geliştirme için ngrok, üretim için sunucu URL'si
const API_URL = "https://email-ai-plugin.onrender.com";

// Gmail etiket renkleri (Gmail API renk kodları)
const LABEL_COLORS = {
  "Normal":   { textColor: "#434343", backgroundColor: "#efefef" },
  "Önemli":   { textColor: "#ffffff", backgroundColor: "#4285f4" },
  "Spam":     { textColor: "#ffffff", backgroundColor: "#ea4335" },
  "Oltalama": { textColor: "#ffffff", backgroundColor: "#c62828" }
};

// Etiket isimleri
const LABEL_NAMES = {
  "Normal":   "AI-Normal",
  "Önemli":   "AI-Önemli",
  "Spam":     "AI-Spam",
  "Oltalama": "AI-Oltalama"
};

// Kaç e-posta işlensin (çok fazlası yavaşlatabilir)
const MAX_EMAILS_PER_RUN = 20;

// Oltalama için güven eşiği
const PHISHING_CONFIDENCE_THRESHOLD = 0.70;

// ============================================================
// ANA FONKSİYONLAR
// ============================================================

/**
 * E-postaları sınıflandır ve etiketle (ana fonksiyon)
 * Bu fonksiyon zamanlanmış olarak çalışır (her 5-10 dakikada bir)
 */
function classifyNewEmails() {
  Logger.log("=== E-Posta Kategorilendirme Başlıyor ===");
  
  try {
    // Gmail etiketlerini hazırla
    ensureLabelsExist();
    
    // AI tarafından henüz işlenmemiş ve eklentinin kendi uyarı mesajı olmayan e-postaları bul
    const unprocessed = GmailApp.search(
      'in:inbox -label:AI-Normal -label:AI-Önemli -label:AI-Spam -label:AI-Oltalama -subject:"⚠️ OLTALAMA TEHDİDİ TESPİT EDİLDİ"',
      0,
      MAX_EMAILS_PER_RUN
    );
    
    if (unprocessed.length === 0) {
      Logger.log("İşlenecek yeni e-posta yok.");
      return;
    }
    
    Logger.log(`${unprocessed.length} yeni e-posta bulundu. İşleniyor...`);
    
    // E-postaları toplu olarak hazırla
    const emailData = [];
    const threads = [];
    
    for (const thread of unprocessed) {
      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1];
      const subject = latestMessage.getSubject() || "(Konu Yok)";
      
      emailData.push({
        id: thread.getId(),
        subject: subject,
        body: latestMessage.getPlainBody().substring(0, 2000), // İlk 2000 karakter
        sender: latestMessage.getFrom()
      });
      threads.push(thread);
    }
    
    // API'ye toplu istek gönder
    const results = classifyBatch(emailData);
    
    // Sonuçlara göre etiketle
    let processedCount = 0;
    let phishingCount = 0;
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const thread = threads[i];
      
      if (result && result.category) {
        applyLabel(thread, result.category);
        processedCount++;
        
        // Oltalama tespitinde bildirim gönder
        if (result.category === "Oltalama") {
          phishingCount++;
          sendPhishingAlert(emailData[i], result);
        }
        
        Logger.log(`✓ "${emailData[i].subject.substring(0, 50)}" -> ${result.category} (${(result.confidence * 100).toFixed(1)}%)`);
      }
    }
    
    Logger.log(`=== Tamamlandı: ${processedCount} e-posta işlendi, ${phishingCount} oltalama tespit edildi ===`);
    
  } catch (error) {
    Logger.log("HATA: " + error.toString());
  }
}

/**
 * Flask API'sine toplu sınıflandırma isteği gönder
 */
function classifyBatch(emails) {
  const payload = JSON.stringify({ emails: emails });
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: payload,
    headers: {
      "ngrok-skip-browser-warning": "true"
    },
    muteHttpExceptions: true,
    timeout: 30
  };
  
  try {
    const response = UrlFetchApp.fetch(API_URL + "/classify/batch", options);
    const responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      Logger.log("API Hatası: HTTP " + responseCode);
      Logger.log("Yanıt: " + response.getContentText().substring(0, 500));
      // Sunucu hatasında yerel kural motorunu veya güvenli whitelist kontrolünü çalıştır
      const trusted = ["@google.com", "accounts.google.com"];
      return emails.map(email => {
        const senderLower = (email.sender || "").toLowerCase();
        if (trusted.some(domain => senderLower.indexOf(domain) !== -1)) {
          return { category: "Normal", confidence: 1.0 };
        }
        return ruleBased_classify(email.subject, email.body);
      });
    }
    
    const data = JSON.parse(response.getContentText());
    return data.results || [];
    
  } catch (error) {
    Logger.log("API bağlantı hatası: " + error.toString());
    // API erişilemezse kural tabanlı sınıflandırma veya güvenli whitelist kontrolü yap
    const trusted = ["@google.com", "accounts.google.com"];
    return emails.map(email => {
      const senderLower = (email.sender || "").toLowerCase();
      if (trusted.some(domain => senderLower.indexOf(domain) !== -1)) {
        return { category: "Normal", confidence: 1.0 };
      }
      return ruleBased_classify(email.subject, email.body);
    });
  }
}

/**
 * Tek bir e-postayı sınıflandır
 */
function classifySingleEmail(subject, body, sender) {
  const payload = JSON.stringify({ subject, body, sender });
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: payload,
    headers: {
      "ngrok-skip-browser-warning": "true"
    },
    muteHttpExceptions: true,
    timeout: 15
  };
  
  try {
    const response = UrlFetchApp.fetch(API_URL + "/classify", options);
    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText());
    }
  } catch (error) {
    Logger.log("API hatası (tek e-posta): " + error.toString());
  }
  
  return ruleBased_classify(subject, body);
}

// ============================================================
// ETİKET YÖNETİMİ
// ============================================================

/**
 * Gerekli Gmail etiketlerini oluştur (yoksa)
 */
function ensureLabelsExist() {
  for (const [category, labelName] of Object.entries(LABEL_NAMES)) {
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
      Logger.log(`Etiket oluşturuldu: ${labelName}`);
    }
  }
}

/**
 * E-posta konusuna uygun etiketi uygula
 */
function applyLabel(thread, category) {
  const labelName = LABEL_NAMES[category] || LABEL_NAMES["Normal"];
  const label = GmailApp.getUserLabelByName(labelName);
  
  if (label) {
    // Diğer AI etiketlerini kaldır
    for (const name of Object.values(LABEL_NAMES)) {
      const oldLabel = GmailApp.getUserLabelByName(name);
      if (oldLabel) {
        thread.removeLabel(oldLabel);
      }
    }
    // Yeni etiketi uygula
    thread.addLabel(label);
    
    // Oltalama veya Spam ise gelen kutusundan kaldır (arşivle)
    if (category === "Oltalama" || category === "Spam") {
      thread.moveToArchive();
    }
  }
}

// ============================================================
// GÜVENLİK: OLTALAMA UYARISI
// ============================================================

/**
 * Oltalama tespitinde e-posta bildirimi gönder
 */
function sendPhishingAlert(emailInfo, classification) {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const alertSubject = "⚠️ OLTALAMA TEHDİDİ TESPİT EDİLDİ";
    const alertBody = `
AI E-Posta Asistanınız bir oltalama (phishing) girişimi tespit etti.

📧 Şüpheli E-Posta Bilgileri:
- Konu: ${emailInfo.subject}
- Gönderen: ${emailInfo.sender}
- Güven Skoru: ${(classification.confidence * 100).toFixed(1)}%

Bu e-postayı açmayın ve içindeki linklere tıklamayın!

Bu mesaj otomatik olarak AI E-Posta Asistanı tarafından oluşturulmuştur.
    `.trim();
    
    GmailApp.sendEmail(userEmail, alertSubject, alertBody);
    Logger.log(`Oltalama uyarısı gönderildi: ${emailInfo.subject.substring(0, 50)}`);
    
  } catch (error) {
    Logger.log("Oltalama uyarısı gönderilemedi: " + error.toString());
  }
}

// ============================================================
// YEDEK: KURAL TABANLI SINIFLANDIRICI
// ============================================================

/**
 * API erişilemez olduğunda kullanılacak basit kural tabanlı sınıflandırıcı
 */
function ruleBased_classify(subject, body) {
  const combined = (subject + " " + body).toLowerCase();
  
  // Oltalama anahtar kelimeleri
  const phishingKeywords = [
    'verify your account', 'account suspended', 'click here immediately',
    'confirm your password', 'security alert', 'suspicious activity',
    'hesabınız askıya', 'şifrenizi doğrulayın', 'güvenlik uyarısı'
  ];
  const phishingMatches = phishingKeywords.filter(kw => combined.includes(kw)).length;
  if (phishingMatches >= 2) return { category: "Oltalama", confidence: 0.80 };
  
  // Spam anahtar kelimeleri
  const spamKeywords = [
    'unsubscribe', 'click here', 'free offer', 'make money',
    'prize', 'reward', 'congratulations', 'won free',
    'advertisements', 'gift card', 'winner', 'cash prize'
  ];
  const spamMatches = spamKeywords.filter(kw => combined.includes(kw)).length;
  if (spamMatches >= 2) return { category: "Spam", confidence: 0.75 };
  
  // Önemli e-posta anahtar kelimeleri
  const importantKeywords = [
    'urgent', 'deadline', 'invoice', 'payment', 'meeting tomorrow',
    'action required', 'acil', 'toplantı', 'son tarih', 'fatura'
  ];
  const importantMatches = importantKeywords.filter(kw => combined.includes(kw)).length;
  if (importantMatches >= 1) return { category: "Önemli", confidence: 0.65 };
  
  return { category: "Normal", confidence: 0.60 };
}

// ============================================================
// ZAMANLANMIŞ GÖREV KURULUMU
// ============================================================

/**
 * Zamanlanmış görevi kur (ilk kez çalıştırıldığında)
 * Her 5 dakikada bir e-postaları sınıflandır
 */
function setupTrigger() {
  // Mevcut tetikleyicileri temizle
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // Yeni tetikleyici oluştur - her 5 dakikada bir
  ScriptApp.newTrigger("classifyNewEmails")
    .timeBased()
    .everyMinutes(5)
    .create();
  
  Logger.log("✓ Zamanlanmış görev kuruldu: Her 5 dakikada bir çalışacak.");
}

/**
 * Tüm etiketi ve zamanlanmış görevi kaldır (sıfırlama)
 */
function cleanup() {
  // Tetikleyicileri kaldır
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // AI etiketlerini kaldır
  for (const labelName of Object.values(LABEL_NAMES)) {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      label.deleteLabel();
      Logger.log(`Etiket silindi: ${labelName}`);
    }
  }
  
  Logger.log("✓ Temizlik tamamlandı.");
}

/**
 * API bağlantısını test et
 */
function testApiConnection() {
  Logger.log("API bağlantısı test ediliyor: " + API_URL);
  
  try {
    const response = UrlFetchApp.fetch(API_URL + "/health", {
      headers: {
        "ngrok-skip-browser-warning": "true"
      },
      muteHttpExceptions: true,
      timeout: 10
    });
    
    const code = response.getResponseCode();
    const body = response.getContentText();
    
    Logger.log("HTTP Kodu: " + code);
    Logger.log("Yanıt: " + body);
    
    if (code === 200) {
      Logger.log("✓ API bağlantısı başarılı!");
    } else {
      Logger.log("✗ API yanıt hatası");
    }
    
  } catch (error) {
    Logger.log("✗ API erişilemez: " + error.toString());
    Logger.log("ngrok çalışıyor mu? API_URL doğru mu?");
  }
}

/**
 * Kolay test için gelen kutunuza 4 farklı kategoride test e-postaları gönderir.
 * Bu fonksiyonu Apps Script editöründe seçip çalıştırabilirsiniz.
 */
function sendTestEmails() {
  const myEmail = Session.getActiveUser().getEmail();
  Logger.log("Test e-postaları gönderiliyor: " + myEmail);
  
  // 1. SPAM E-Posta
  GmailApp.sendEmail(
    myEmail, 
    "!!! URGENT !!! Claim Your Free $1000 Gift Card Now!", 
    "Congratulations! You have been selected as the lucky winner of a free $1000 Walmart Gift Card. Click here to claim your reward immediately. Unsubscribe if you do not wish to receive more promotional offers from us."
  );
  Logger.log("✓ Spam test e-postası gönderildi.");
  
  // 2. OLTALAMA (Phishing) E-Posta
  GmailApp.sendEmail(
    myEmail, 
    "[Security Alert] Confirm your password and verify your bank account details", 
    "Dear Customer,\n\nWe detected suspicious activity on your online banking account. For your safety, your account has been temporarily suspended. Please click the link below to confirm your password and verify your identity immediately:\nhttp://secure-banking-alert-identity.com/login\n\nUrgent action is required within 24 hours to prevent permanent account closure."
  );
  Logger.log("✓ Oltalama test e-postası gönderildi.");
  
  // 3. ÖNEMLİ E-Posta
  GmailApp.sendEmail(
    myEmail, 
    "Proje Final Raporu Teslimi ve Fatura Ödeme Planı", 
    "Selamlar,\n\nE-posta asistanı projesi için hazırladığımız final raporunun son teslim tarihi bu Cuma günüdür. Ayrıca sunucu masrafları için hazırlanan fatura ekte yer almaktadır. Ödeme işlemlerini en kısa sürede tamamlamamız gerekiyor. Yarın sabah saat 10:00'da son durum değerlendirmesi için bir online toplantı yapacağız.\n\nİyi çalışmalar."
  );
  Logger.log("✓ Önemli test e-postası gönderildi.");
  
  // 4. NORMAL E-Posta
  GmailApp.sendEmail(
    myEmail, 
    "Hafta sonu piknik ve kahvaltı planı", 
    "Selam dostum,\n\nBu hafta sonu hava çok güzel olacakmış. Cumartesi sabahı Belgrad Ormanı'nda piknik yapıp kahvaltı etmeyi düşünüyoruz. Diğer arkadaşlar da gelecek. Sen de katılmak ister misin? Yanıtına göre hazırlık yapacağız, haber verirsin."
  );
  Logger.log("✓ Normal test e-postası gönderildi.");
  
  Logger.log("=== Tüm test e-postaları başarıyla gönderildi! Lütfen gelen kutunuza düşmelerini bekleyin (yaklaşık 10-15 saniye) ===");
}

// ============================================================
// GÖRSEL EKLENTİ (SIDEBAR / CARD SERVICE) ARAYÜZÜ
// ============================================================

/**
 * Eklentinin ana sayfa (homepage) kartını oluşturur.
 */
function buildHomepage(e) {
  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle("Yapay Zeka E-Posta Asistanı"));
  
  const section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText("Hoş geldiniz! Lütfen analiz etmek istediğiniz bir e-postayı açın."));
    
  card.addSection(section);
  return card.build();
}

/**
 * Bir e-posta açıldığında çalışan görsel kart arayüzünü oluşturur.
 */
function onGmailMessageOpen(e) {
  const messageId = e.gmail.messageId;
  const accessToken = e.gmail.accessToken;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  
  const message = GmailApp.getMessageById(messageId);
  const subject = message.getSubject() || "(Konu Yok)";
  const body = message.getPlainBody().substring(0, 1000);
  const sender = message.getFrom();
  
  // Eklentinin kendi uyarı mesajı ise yapay zekaya gönderme, doğrudan bilgi kartı göster
  if (subject.indexOf("⚠️ OLTALAMA TEHDİDİ TESPİT EDİLDİ") !== -1) {
    const card = CardService.newCardBuilder();
    card.setHeader(CardService.newCardHeader().setTitle("Sistem Güvenlik Bildirimi"));
    const section = CardService.newCardSection()
      .addWidget(CardService.newTextParagraph().setText("Bu e-posta, AI E-Posta Asistanı tarafından otomatik olarak gönderilmiş resmi bir güvenlik uyarı bildirimidir. Analiz edilmesine gerek yoktur."));
    card.addSection(section);
    return card.build();
  }
  
  // Yapay Zeka sorgusu yap (API'ye veya yerel kural motoruna sorar)
  const result = classifySingleEmail(subject, body, sender);

  
  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader()
    .setTitle("E-Posta AI Analizi")
    .setSubtitle(subject.substring(0, 40) + "..."));
    
  const section = CardService.newCardSection();
  
  // Kategoriye göre renk ve simge belirle
  let categoryColor = "#434343"; // Normal - Gri
  let iconText = "✉️";
  if (result.category === "Önemli") {
    categoryColor = "#4285f4"; // Mavi
    iconText = "⭐";
  } else if (result.category === "Spam") {
    categoryColor = "#ea4335"; // Kırmızı
    iconText = "🚫";
  } else if (result.category === "Oltalama") {
    categoryColor = "#c62828"; // Koyu Kırmızı
    iconText = "⚠️";
  }
  
  // Detay widget'ları
  section.addWidget(CardService.newKeyValue()
    .setTopLabel("Tespit Edilen Kategori")
    .setContent(`<b><font color="${categoryColor}">${iconText} ${result.category}</font></b>`)
    .setBottomLabel(`Güven Skoru: %${(result.confidence * 100).toFixed(1)}`));
    
  section.addWidget(CardService.newKeyValue()
    .setTopLabel("Gönderici")
    .setContent(sender));
    
  card.addSection(section);
  return card.build();
}


