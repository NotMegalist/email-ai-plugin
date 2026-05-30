const API_URL = "https://email-ai-plugin.onrender.com";

// Yeni mail alindiginda tetiklenen olay dinleyicisi
browser.messages.onNewMailReceived.addListener(async (folder, messages) => {
  for (let message of messages.messages) {
    try {
      // Mailin detaylarini ve govdesini cek
      let fullMessage = await browser.messages.getFull(message.id);
      let subject = message.subject || "(Konu Yok)";
      let bodyText = "";
      
      if (fullMessage.parts) {
        // En basit metin parçasını bul
        for (let part of fullMessage.parts) {
          if (part.contentType === "text/plain" && part.body) {
            bodyText = part.body;
            break;
          }
        }
      }
      
      if (!bodyText && message.body) {
        bodyText = message.body;
      }
      
      // API'ye POST istegi gonder
      let response = await fetch(API_URL + "/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          subject: subject,
          body: bodyText.substring(0, 2000),
          sender: message.author
        })
      });
      
      if (response.ok) {
        let result = await response.json();
        let category = result.category; // Normal, Önemli, Spam, Oltalama
        
        console.log(`Thunderbird Sınıflandırma: "${subject}" -> ${category}`);
        
        // Thunderbird'de maile uygun tag (etiket) ekle
        // Not: Etiketlerin Thunderbird ayarlarinda tanimli olmasi gerekir.
        await browser.messages.update(message.id, {
          tags: ["AI-" + category]
        });
      }
    } catch (e) {
      console.error("Thunderbird eklenti hatasi: ", e);
    }
  }
});
