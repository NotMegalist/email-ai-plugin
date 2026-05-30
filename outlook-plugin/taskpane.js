const API_URL = "https://email-ai-plugin.onrender.com";

Office.onReady((info) => {
  if (info.host === Office.HostType.Outlook) {
    classifyCurrentEmail();
  }
});

function classifyCurrentEmail() {
  const item = Office.context.mailbox.item;
  
  // Mailin govdesini çek
  item.body.getAsync(Office.CoercionType.Text, function (result) {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      const emailBody = result.value;
      const emailSubject = item.subject || "(Konu Yok)";
      const sender = item.from ? item.from.emailAddress : "(Bilinmiyor)";
      
      // REST API'ye gonder
      fetch(API_URL + "/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          subject: emailSubject,
          body: emailBody.substring(0, 2000),
          sender: sender
        })
      })
      .then(res => res.json())
      .then(data => {
        // Sonucu ekranda goster ve Outlook kategorilerine ata
        document.getElementById("category").innerText = data.category;
        document.getElementById("confidence").innerText = "%" + (data.confidence * 100).toFixed(1);
        
        // Outlook kategorisi ekle
        item.categories.addAsync(["AI-" + data.category], function (catResult) {
          if (catResult.status === Office.AsyncResultStatus.Succeeded) {
            console.log("Outlook kategorisi başarıyla eklendi.");
          }
        });
      })
      .catch(err => {
        console.error("API Baglanti Hatasi:", err);
      });
    }
  });
}
