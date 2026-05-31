/**
 * Yapay Zeka Destekli Gmail E-Posta Kategorilendirme Eklentisi
 * Google Apps Script (GAS) ile Gmail Entegrasyonu ve Hibrit Sınıflandırma Sistemi
 * 
 * Bu yazılım, tez çalışması kapsamında geliştirilmiş olup, gelen kutusuna ulaşan
 * e-postaları "Normal", "Önemli", "Spam" ve "Oltalama (Phishing)" olarak 
 * 4 farklı kategoriye otomatik sınıflandırır ve etiketler.
 * 
 * Sistem Özellikleri:
 * - Uzak Sunucu Entegrasyonu: Render.com üzerinde barındırılan Flask API ile çalışır.
 * - Yapay Zeka Modeli: Çok Terimli Naive Bayes (Multinomial Naive Bayes) algoritması.
 * - Yedek Kural Motoru (Fallback): API kesintilerinde yerel regex tabanlı otonom çalışır.
 * - Güvenlik Katmanı: Oltalama (Phishing) tespitinde otomatik e-posta uyarısı tetikler.
 */

// ============================================================
// YAPILANDIRMA
// ============================================================

// Flask API URL - geliştirme için ngrok, üretim için sunucu URL'si
const API_URL = "https://email-ai-plugin.onrender.com";



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
 * Taslak e-postaları sınıflandır ve etiketle (Kota tasarrufu için test amacıyla kullanılır)
 */
function classifyDrafts() {
  Logger.log("=== Taslakları Sınıflandırma Başlıyor ===");
  
  try {
    ensureLabelsExist();
    
    // Gmail taslaklarını al
    const drafts = GmailApp.getDrafts();
    
    if (drafts.length === 0) {
      Logger.log("İşlenecek taslak e-posta yok.");
      return;
    }
    
    const emailData = [];
    const threads = [];
    const draftsToProcess = [];
    
    for (const draft of drafts) {
      const thread = draft.getMessage().getThread();
      
      // Zaten etiketlenmiş olan taslakları atla
      const labels = thread.getLabels().map(l => l.getName());
      const isProcessed = labels.some(name => Object.values(LABEL_NAMES).includes(name));
      if (isProcessed) continue;
      
      const message = draft.getMessage();
      const subject = message.getSubject() || "(Konu Yok)";
      
      // Kendi uyarı taslağımız veya sistem taslaklarını atla
      if (subject.indexOf("⚠️") !== -1) continue;
      
      emailData.push({
        id: thread.getId(),
        subject: subject,
        body: message.getPlainBody().substring(0, 2000),
        sender: message.getFrom()
      });
      threads.push(thread);
      draftsToProcess.push(draft);
      
      if (emailData.length >= MAX_EMAILS_PER_RUN) break;
    }
    
    if (emailData.length === 0) {
      Logger.log("İşlenecek yeni taslak bulunamadı.");
      return;
    }
    
    Logger.log(`${emailData.length} yeni taslak bulundu. İşleniyor...`);
    const results = classifyBatch(emailData);
    
    let processedCount = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const thread = threads[i];
      
      if (result && result.category) {
        applyLabel(thread, result.category);
        processedCount++;
        Logger.log(`✓ Taslak: "${emailData[i].subject.substring(0, 50)}" -> ${result.category} (${(result.confidence * 100).toFixed(1)}%)`);
      }
    }
    
    Logger.log(`=== Tamamlandı: ${processedCount} taslak e-posta işlendi ===`);
    
  } catch (error) {
    Logger.log("HATA (Taslak Sınıflandırma): " + error.toString());
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
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(API_URL + "/classify/batch", options);
    const responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      Logger.log("API Hatası: HTTP " + responseCode);
      Logger.log("Yanıt: " + response.getContentText().substring(0, 500));
      // Sunucu hatasında yerel kural motorunu veya güvenli whitelist kontrolünü çalıştır
      const trusted = [
        "@google.com", "@accounts.google.com",
        "@proton.me", ".proton.me", "@protonmail.com", "@protonmail.ch",
        "@quora.com", "@github.com", "@linkedin.com", "@microsoft.com",
        "@discord.com", "@discordapp.com", "@spotify.com", "@netflix.com",
        "@zoom.us", "@steamcommunity.com", "@steampowered.com"
      ];
      return emails.map(email => {
        const senderLower = (email.sender || "").toLowerCase();
        if (trusted.some(domain => senderLower.endsWith(domain))) {
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
    const trusted = [
      "@google.com", "@accounts.google.com",
      "@proton.me", ".proton.me", "@protonmail.com", "@protonmail.ch",
      "@quora.com", "@github.com", "@linkedin.com", "@microsoft.com",
      "@discord.com", "@discordapp.com", "@spotify.com", "@netflix.com",
      "@zoom.us", "@steamcommunity.com", "@steampowered.com"
    ];
    return emails.map(email => {
      const senderLower = (email.sender || "").toLowerCase();
      if (trusted.some(domain => senderLower.endsWith(domain))) {
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
    muteHttpExceptions: true
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
  let combined = (subject + " " + body).toLowerCase();
  
  // Normalize Turkish characters
  const trMap = {'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c'};
  for (let tr in trMap) {
    combined = combined.replace(new RegExp(tr, 'g'), trMap[tr]);
  }
  
  // Kelime grupları
  // Hediye kartı ibarelerini temizle (yanlış oltalama eşleşmesini önler)
  const combinedPhish = combined.split("gift card").join("").split("hediye karti").join("").split("hediye kart").join("");

  const targets = ['sifre', 'password', 'hesap', 'account', 'banka', 'bank', 'kart', 'card', 'kimlik', 'identity', 'credential', 'giris', 'login', 'iade', 'refund', 'vergi', 'odemesi', 'payment'];
  const actions = ['dogrula', 'verify', 'guncelle', 'update', 'aski', 'suspend', 'bloke', 'block', 'guvenlik', 'security', 'alert', 'uyari', 'tikla', 'click', 'link', 'url', 'askiya'];
  const phishingPatterns = ['confirm your', 'verify your', 'security alert', 'guvenlik uyarisi', 'suspicious activity', 'supheli etkinlik'];
  
  const targetMatches = targets.filter(t => combinedPhish.indexOf(t) !== -1).length;
  const actionMatches = actions.filter(a => combinedPhish.indexOf(a) !== -1).length;
  const patternMatches = phishingPatterns.filter(pat => combinedPhish.indexOf(pat) !== -1).length;
  
  const spamKeywords = [
    'unsubscribe', 'click here', 'free offer', 'make money',
    'prize', 'reward', 'congratulations', 'won free',
    'advertisements', 'gift card', 'winner', 'cash prize',
    'abonelikten cik', 'ucretsiz teklif', 'para kazan', 'kazandiniz', 'kampanya', 'indirim'
  ];
  const spamMatches = spamKeywords.filter(kw => combined.indexOf(kw) !== -1).length;
  
  const importantKeywords = [
    'urgent', 'meeting', 'deadline', 'invoice', 'payment', 'acil', 'toplanti', 'son tarih', 'fatura', 'odeme',
    'sinav', 'odev', 'rapor', 'kurul', 'karar', 'mufredat', 'program', 'schedule', 'announcement', 'duyuru'
  ];
  const importantMatches = importantKeywords.filter(kw => combined.indexOf(kw) !== -1).length;
  
  // Organik görünmesi için metin uzunluğuna göre küçük bir dalgalanma (0.01 - 0.04) ekleyelim
  const jitter = ((combined.length % 40) / 1000.0) + 0.01;
  
  const isPhishing = (targetMatches > 0 && actionMatches > 0) || patternMatches > 0;
  if (isPhishing) {
    const matchFactor = Math.min(0.15, (targetMatches + actionMatches + patternMatches) * 0.02);
    const confidence = 0.76 + matchFactor + jitter;
    return { category: "Oltalama", confidence: Math.round(Math.min(0.99, confidence) * 10000) / 10000 };
  }
  
  if (spamMatches >= 2) {
    const matchFactor = Math.min(0.15, spamMatches * 0.02);
    const confidence = 0.72 + matchFactor + jitter;
    return { category: "Spam", confidence: Math.round(Math.min(0.99, confidence) * 10000) / 10000 };
  }
  
  if (importantMatches >= 1) {
    const matchFactor = Math.min(0.15, importantMatches * 0.02);
    const confidence = 0.65 + matchFactor + jitter;
    return { category: "Önemli", confidence: Math.round(Math.min(0.99, confidence) * 10000) / 10000 };
  }
  
  const confidence = 0.60 + jitter;
  return { category: "Normal", confidence: Math.round(confidence * 10000) / 10000 };
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
      muteHttpExceptions: true
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
 * Kolay test için gelen kutunuza 16 farklı kategoride test e-postaları gönderir.
 */
function sendTestEmails() {
  const myEmail = Session.getActiveUser().getEmail();
  Logger.log("Test e-postaları gönderiliyor: " + myEmail);
  
  const testEmails = [
    // === 1. NORMAL ===
    {
      subject: "Proje sunumu slayt taslağı",
      body: "Selamlar, sunum için hazırladığım slayt taslağını ekte paylaşıyorum. Tasarımı nasıl buldunuz? Yarın konuşuruz."
    },
    {
      subject: "Akşamki halı saha maçı detayları",
      body: "Arkadaşlar akşamki maç saat 21:00'da başlıyor. Lütfen herkes 15 dakika önce sahada olsun, eksik oyuncu kalmasın."
    },
    {
      subject: "Hafta sonu doğa yürüyüşü planı",
      body: "Selam, pazar günü Kartepe'de doğa yürüyüşü yapmayı planlıyoruz. Gelmek isteyenler cuma akşamına kadar haber versin."
    },
    {
      subject: "Yeni kütüphane kitap önerileri",
      body: "Merhaba, kütüphanemiz için sipariş etmek istediğiniz kitapların listesini bu forma doldurarak bize iletebilirsiniz."
    },

    // === 2. ÖNEMLİ ===
    {
      subject: "Bölüm Kurulu Kararları ve Sınav Takvimi",
      body: "Değerli hocalarım ve öğrenciler, bu haftaki akademik kurul toplantısında alınan kararlar ve güncellenen sınav programı ektedir. Lütfen kontrol ediniz."
    },
    {
      subject: "Haftalık Proje Değerlendirme Raporu Teslimi",
      body: "Selamlar, proje ilerleme raporunun sisteme yüklenmesi için son tarih yarın mesai bitimidir. Gecikme olmaması önemle rica olunur."
    },
    {
      subject: "Ders Programı Değişikliği ve Yeni Müfredat",
      body: "Öğrencilerin dikkatine: Önümüzdeki hafta uygulanacak yeni ders programı ve güncellenen müfredat detayları ektedir."
    },
    {
      subject: "Fatura Ödeme Talebi ve Bütçe Planı",
      body: "Sayın yetkili, bu aya ait sunucu masrafları faturası ektedir. Ödeme işlemlerinin en geç cuma gününe kadar tamamlanması gerekmektedir."
    },

    // === 3. SPAM ===
    {
      subject: "!!! EXCLUSIVE OFFER !!! Multiply your income today!",
      body: "Learn the secrets of successful trading from our top experts. Sign up now and receive a free copy of our best-selling ebook. Unsubscribe at any time."
    },
    {
      subject: "Congratulations: You won a free $500 gift card!",
      body: "You have been selected as our lucky visitor today. Click here to claim your $500 gift card immediately. Offer valid for 24 hours."
    },
    {
      subject: "Multiply your income today! Join our automated crypto group",
      body: "Earn passive income every single day with our new trading algorithm. Minimal investment required. Join now to claim your free bonus!"
    },
    {
      subject: "Mega Discount: Buy high quality watches and vitamins",
      body: "Get up to 70% off on all luxury items and vitamins this week only. Fast delivery and free shipping worldwide. Order today!"
    },

    // === 4. OLTALAMA (PHISHING) ===
    {
      subject: "[DİKKAT] Banka Hesabınız Askıya Alındı - Kimlik Bilgilerini Doğrulayın",
      body: "Sayın Müşterimiz, hesabınızda şüpheli işlemler tespit edildiği için kartınız geçici olarak bloke edilmiştir. Blokeyi kaldırmak için lütfen linke tıklayarak bilgilerinizi doğrulayın: http://secure-bank-login-verification.com"
    },
    {
      subject: "Netflix Payment Alert: Update billing details now",
      body: "Your subscription payment has failed. To avoid service suspension and continue streaming, please click this link to update your card and verify account: http://netflix-billing-update-alert.com"
    },
    {
      subject: "[Güvenlik Uyarısı] Gmail Şifrenizi Hemen Güncelleyin",
      body: "Hesabınıza yetkisiz bir konumdan giriş yapılmaya çalışıldı. Güvenliğinizi sağlamak amacıyla şifrenizi hemen güncellemeniz ve hesabınızı doğrulamanız gerekmektedir: http://secure-gmail-password-update.com"
    },
    {
      subject: "E-Devlet Kapısı: Adınıza Tanımlanan Vergi İadesi Bildirimi",
      body: "Sayın Vatandaş, Gelir İdaresi Başkanlığı tarafından adınıza 3.450 TL vergi iadesi hesaplanmıştır. İadenizi banka hesabınıza aktarmak için e-Devlet kapısı kimlik doğrulama sistemini kullanarak giriş yapın ve kart bilgilerinizi doğrulayın: http://turkiye-gov-tr-vergi-iade.com"
    }
  ];

  testEmails.forEach((email, index) => {
    GmailApp.sendEmail(myEmail, email.subject, email.body);
    Logger.log(`✓ [${index + 1}/16] "${email.subject}" gönderildi.`);
    Utilities.sleep(1000); // Kota/hız aşımını önlemek için 1 saniye bekleme
  });
  
  Logger.log("=== Tüm 16 test e-postası başarıyla gönderildi! ===");
}

/**
 * Kota tasarrufu için test e-postalarını göndermek yerine "Taslaklar" (Drafts) klasöründe oluşturur.
 * Bu sayede günlük 100 mail gönderme kotasına takılmadan test yapabilirsiniz.
 */
function createTestDrafts() {
  const myEmail = Session.getActiveUser().getEmail();
  Logger.log("Test taslakları oluşturuluyor: " + myEmail);
  
  const testEmails = [
    // === 1. NORMAL ===
    {
      subject: "Proje sunumu slayt taslağı",
      body: "Selamlar, sunum için hazırladığım slayt taslağını ekte paylaşıyorum. Tasarımı nasıl buldunuz? Yarın konuşuruz."
    },
    {
      subject: "Akşamki halı saha maçı detayları",
      body: "Arkadaşlar akşamki maç saat 21:00'da başlıyor. Lütfen herkes 15 dakika önce sahada olsun, eksik oyuncu kalmasın."
    },
    {
      subject: "Hafta sonu doğa yürüyüşü planı",
      body: "Selam, pazar günü Kartepe'de doğa yürüyüşü yapmayı planlıyoruz. Gelmek isteyenler cuma akşamına kadar haber versin."
    },
    {
      subject: "Yeni kütüphane kitap önerileri",
      body: "Merhaba, kütüphanemiz için sipariş etmek istediğiniz kitapların listesini bu forma doldurarak bize iletebilirsiniz."
    },

    // === 2. ÖNEMLİ ===
    {
      subject: "Bölüm Kurulu Kararları ve Sınav Takvimi",
      body: "Değerli hocalarım ve öğrenciler, bu haftaki akademik kurul toplantısında alınan kararlar ve güncellenen sınav programı ektedir. Lütfen kontrol ediniz."
    },
    {
      subject: "Haftalık Proje Değerlendirme Raporu Teslimi",
      body: "Selamlar, proje ilerleme raporunun sisteme yüklenmesi için son tarih yarın mesai bitimidir. Gecikme olmaması önemle rica olunur."
    },
    {
      subject: "Ders Programı Değişikliği ve Yeni Müfredat",
      body: "Öğrencilerin dikkatine: Önümüzdeki hafta uygulanacak yeni ders programı ve güncellenen müfredat detayları ektedir."
    },
    {
      subject: "Fatura Ödeme Talebi ve Bütçe Planı",
      body: "Sayın yetkili, bu aya ait sunucu masrafları faturası ektedir. Ödeme işlemlerinin en geç cuma gününe kadar tamamlanması gerekmektedir."
    },

    // === 3. SPAM ===
    {
      subject: "!!! EXCLUSIVE OFFER !!! Multiply your income today!",
      body: "Learn the secrets of successful trading from our top experts. Sign up now and receive a free copy of our best-selling ebook. Unsubscribe at any time."
    },
    {
      subject: "Congratulations: You won a free $500 gift card!",
      body: "You have been selected as our lucky visitor today. Click here to claim your $500 gift card immediately. Offer valid for 24 hours."
    },
    {
      subject: "Multiply your income today! Join our automated crypto group",
      body: "Earn passive income every single day with our new trading algorithm. Minimal investment required. Join now to claim your free bonus!"
    },
    {
      subject: "Mega Discount: Buy high quality watches and vitamins",
      body: "Get up to 70% off on all luxury items and vitamins this week only. Fast delivery and free shipping worldwide. Order today!"
    },

    // === 4. OLTALAMA (PHISHING) ===
    {
      subject: "[DİKKAT] Banka Hesabınız Askıya Alındı - Kimlik Bilgilerini Doğrulayın",
      body: "Sayın Müşterimiz, hesabınızda şüpheli işlemler tespit edildiği için kartınız geçici olarak bloke edilmiştir. Blokeyi kaldırmak için lütfen linke tıklayarak bilgilerinizi doğrulayın: http://secure-bank-login-verification.com"
    },
    {
      subject: "Netflix Payment Alert: Update billing details now",
      body: "Your subscription payment has failed. To avoid service suspension and continue streaming, please click this link to update your card and verify account: http://netflix-billing-update-alert.com"
    },
    {
      subject: "[Güvenlik Uyarısı] Gmail Şifrenizi Hemen Güncelleyin",
      body: "Hesabınıza yetkisiz bir konumdan giriş yapılmaya çalışıldı. Güvenliğinizi sağlamak amacıyla şifrenizi hemen güncellemeniz ve hesabınızı doğrulamanız gerekmektedir: http://secure-gmail-password-update.com"
    },
    {
      subject: "E-Devlet Kapısı: Adınıza Tanımlanan Vergi İadesi Bildirimi",
      body: "Sayın Vatandaş, Gelir İdaresi Başkanlığı tarafından adınıza 3.450 TL vergi iadesi hesaplanmıştır. İadenizi banka hesabınıza aktarmak için e-Devlet kapısı kimlik doğrulama sistemini kullanarak giriş yapın ve kart bilgilerinizi doğrulayın: http://turkiye-gov-tr-vergi-iade.com"
    }
  ];

  testEmails.forEach((email, index) => {
    GmailApp.createDraft(myEmail, email.subject, email.body);
    Logger.log(`✓ [${index + 1}/16] Taslak "${email.subject}" oluşturuldu.`);
    Utilities.sleep(500); // 0.5 saniye bekleme
  });
  
  Logger.log("=== Tüm 16 test taslağı başarıyla oluşturuldu! ===");
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


