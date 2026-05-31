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
  
  // Phishing keywords combinations
  const targets = ['sifre', 'password', 'hesap', 'account', 'banka', 'bank', 'kart', 'card', 'kimlik', 'identity', 'credential', 'giris', 'login', 'iade', 'refund', 'vergi', 'odemesi', 'payment'];
  const actions = ['dogrula', 'verify', 'guncelle', 'update', 'aski', 'suspend', 'bloke', 'block', 'guvenlik', 'security', 'alert', 'uyari', 'tikla', 'click', 'link', 'url', 'askiya'];
  
  const hasTarget = targets.some(t => combined.indexOf(t) !== -1);
  const hasAction = actions.some(a => combined.indexOf(a) !== -1);
  
  const phishingPatterns = [
    'click here', 'hemen tiklayin', 'confirm your', 'verify your', 
    'security alert', 'guvenlik uyarisi', 'suspicious activity', 'supheli etkinlik'
  ];
  const hasPattern = phishingPatterns.some(pat => combined.indexOf(pat) !== -1);
  
  if ((hasTarget && hasAction) || hasPattern) {
    return { category: "Oltalama", confidence: 0.80 };
  }
  
  // Spam keywords
  const spamKeywords = [
    'unsubscribe', 'click here', 'free offer', 'make money',
    'prize', 'reward', 'congratulations', 'won free',
    'advertisements', 'gift card', 'winner', 'cash prize',
    'abonelikten cik', 'ucretsiz teklif', 'para kazan', 'kazandiniz', 'kampanya', 'indirim'
  ];
  const spamMatches = spamKeywords.filter(kw => combined.indexOf(kw) !== -1).length;
  if (spamMatches >= 2) return { category: "Spam", confidence: 0.75 };
  
  // Important keywords
  const importantKeywords = [
    'urgent', 'meeting', 'deadline', 'invoice', 'payment', 'acil', 'toplanti', 'son tarih', 'fatura', 'odeme',
    'sinav', 'odev', 'proje', 'rapor', 'kurul', 'karar', 'mufredat', 'ders', 'program', 'schedule', 'announcement', 'duyuru'
  ];
  const importantMatches = importantKeywords.filter(kw => combined.indexOf(kw) !== -1).length;
  if (importantMatches >= 1) return { category: "Önemli", confidence: 0.70 };
  
  return { category: "Normal", confidence: 0.65 };
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
      subject: "Yarın akşamki halı saha maçı kadrosu",
      body: "Selam arkadaşlar, yarın akşam saat 20:00'da halı saha maçı yapıyoruz. Eksikler var, gelmek isteyenler gruba yazsın."
    },
    {
      subject: "Hafta sonu piknik ve kahvaltı planı",
      body: "Selam dostum, bu hafta sonu Belgrad Ormanı'nda piknik ve kahvaltı yapıyoruz. Cumartesi sabahı saat 9:00'da buluşacağız. Katılabilecek misin?"
    },
    {
      subject: "Yeni kütüphane kitapları listesi",
      body: "Merhaba, kütüphanemize bu hafta yeni romanlar ve araştırma kitapları eklendi. Listeyi web sitemizden inceleyebilirsiniz."
    },
    {
      subject: "Akşam yemeği için rezervasyon yapıldı",
      body: "Selam, cuma akşamı için restoranda yerimizi ayırttım. Saat 19:30'da orada buluşuruz, gecikmeyin."
    },

    // === 2. ÖNEMLİ ===
    {
      subject: "Proje Final Raporu Teslimi ve Fatura Ödeme Planı",
      body: "Selamlar,\n\nE-posta asistanı projesi için hazırladığımız final raporunun son teslim tarihi bu Cuma günüdür. Ayrıca sunucu masrafları için hazırlanan fatura ekte yer almaktadır. Ödeme işlemlerini en kısa sürede tamamlamamız gerekiyor. Yarın sabah saat 10:00'da son durum değerlendirmesi için bir online toplantı yapacağız.\n\nİyi çalışmalar."
    },
    {
      subject: "Haftalık Proje Değerlendirme Toplantısı",
      body: "Merhaba arkadaşlar, yarın sabah saat 10:00'da haftalık ilerleme ve durum değerlendirme toplantısı yapılacaktır. Herkesin hazırladığı son slaytları yanında getirmesini rica ederim. Katılım zorunludur."
    },
    {
      subject: "Bölüm Kurulu Kararları ve Yeni Müfredat",
      body: "Sayın hocalarım, bu haftaki kurulda alınan kararlar ve önümüzdeki dönem uygulanacak olan ders programı ektedir. Lütfen değişiklikleri inceleyip geri bildirimlerinizi iletiniz."
    },
    {
      subject: "Akademik Takvim Güncellemesi ve Sınav Tarihleri",
      body: "Değerli öğrenciler, bahar dönemi bütünleme ve mazeret sınavlarının güncellenmiş takvimi bölüm web sayfasında ilan edilmiştir. Sınav çakışması olanların en geç yarın mesai bitimine kadar dilekçe vermesi gerekmektedir."
    },

    // === 3. SPAM ===
    {
      subject: "!!! URGENT !!! Claim Your Free $1000 Gift Card Now!",
      body: "Congratulations! You have been selected as the lucky winner of a free $1000 Walmart Gift Card. Click here to claim your reward immediately. Unsubscribe if you do not wish to receive more promotional offers from us."
    },
    {
      subject: "Earn $500 Daily Working From Home - No Experience Required",
      body: "Get rich quick with our new automated investment system. You can start earning passive income today from the comfort of your own home. Spaces are limited, register now!"
    },
    {
      subject: "Super Discount: Buy Cheap Pills and Supplements",
      body: "Get the best quality supplements at the lowest prices online. Order today and get an extra 50% discount on your first purchase. Fast shipping worldwide."
    },
    {
      subject: "Special Promo: Exclusive Webinar and Trading Courses",
      body: "Join our exclusive trading course today and learn how to double your income in a week. Sign up now to get a free ebook and access to our premium signal group."
    },

    // === 4. OLTALAMA (PHISHING) ===
    {
      subject: "[Security Alert] Confirm your password and verify your bank account details",
      body: "Dear Customer,\n\nWe detected suspicious activity on your online banking account. For your safety, your account has been temporarily suspended. Please click the link below to confirm your password and verify your identity immediately:\nhttp://secure-banking-alert-identity.com/login\n\nUrgent action is required within 24 hours to prevent permanent account closure."
    },
    {
      subject: "[DİKKAT] E-Posta Şifrenizin Süresi Doluyor - Hemen Güncelleyin",
      body: "Sayın Kullanıcı,\n\nE-posta hesabınızın şifre kullanım süresi bugün dolacaktır. Hesabınızın askıya alınmasını önlemek amacıyla aşağıdaki doğrulama bağlantısına tıklayarak şifrenizi güncelleyin ve hesabınızı doğrulayın:\nhttp://secure-mail-update.com/verify"
    },
    {
      subject: "Netflix Billing Issue: Update your payment details immediately",
      body: "We were unable to process your monthly subscription payment. To keep your membership active and avoid interruption, please update your billing information and verify your card now: http://netflix-billing-update.com"
    },
    {
      subject: "E-Devlet Kapısı: Adınıza Tanımlanan Vergi İadesi Bildirimi",
      body: "Sayın Vatandaş,\n\nGelir İdaresi Başkanlığı tarafından adınıza 3.450 TL vergi iadesi hesaplanmıştır. İadenizi banka hesabınıza aktarmak için e-Devlet kapısı kimlik doğrulama sistemini kullanarak giriş yapın ve kart bilgilerinizi doğrulayın: http://turkiye-gov-tr-vergi-iade.com"
    }
  ];

  testEmails.forEach((email, index) => {
    GmailApp.sendEmail(myEmail, email.subject, email.body);
    Logger.log(`✓ [${index + 1}/16] "${email.subject}" gönderildi.`);
    Utilities.sleep(1000); // Kota/hız aşımını önlemek için 1 saniye bekleme
  });
  
  Logger.log("=== Tüm 16 test e-postası başarıyla gönderildi! ===");
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


