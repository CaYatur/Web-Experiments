const express = require('express');
const path = require('path');
const fs = require('fs'); // Dosya işlemleri için ekleniyor
const bodyParser = require('body-parser'); // Form verilerini almak için ekleniyor
const { v4: uuidv4 } = require('uuid'); // Rasgele ID oluşturmak için ekleniyor

const app = express();
const PORT = 80;

// Statik dosyaları servis et (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Body parser middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// API endpoint - projects.json dosyasını JSON verisi olarak sun
app.get('/api/projects', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'projects.json'));
});

// İletişim formu verilerini işleme
app.post('/feedback', (req, res) => {
    const { email, title, subject, content } = req.body;

    // Rasgele bir ID oluştur
    const feedbackId = uuidv4(); // UUID kullanarak benzersiz ID oluştur

    // Feedback verisini oluştur
    const feedbackData = `
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #121212; /* Koyu arka plan */
                color: #ffffff; /* Açık yazı rengi */
                margin: 0;
                padding: 20px;
            }
            
            .feedback-container {
                background-color: #1e1e1e; /* Koyu gri arka plan */
                border-radius: 8px;
                padding: 20px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3); /* Gölge efekti */
                margin-bottom: 20px;
            }

            h3 {
                color: #ff4081; /* Vurgulayıcı renk */
            }

            p {
                margin: 10px 0;
                line-height: 1.6; /* Satır aralığı */
            }

            strong {
                color: #ff4081; /* Vurgulayıcı renk */
            }

            hr {
                border: 1px solid #444; /* Koyu renkli ayrım çizgisi */
                margin: 20px 0; /* Çizgi üstü ve altı boşluk */
            }
        </style>

        <div class="feedback-container">
            <h3>ID: ${feedbackId}</h3>
            <p><strong>E-posta:</strong> ${email}</p>
            <p><strong>Başlık:</strong> ${title}</p>
            <p><strong>Konu:</strong> ${subject}</p>
            <p><strong>İçerik:</strong> ${content}</p>
        </div>
        <hr />
    `;

    // Feedback klasörünü kontrol et, yoksa oluştur
    const feedbackDir = path.join(__dirname, 'feedback');
    if (!fs.existsSync(feedbackDir)) {
        fs.mkdirSync(feedbackDir); // Klasörü oluştur
    }

    // Verileri ID ile bir dosyaya yaz
    fs.writeFile(path.join(feedbackDir, `${feedbackId}.html`), feedbackData, (err) => {
        if (err) {
            console.error('Dosya yazma hatası:', err);
            return res.status(500).send('Bir hata oluştu.');
        }
        res.status(200).send('Mesajınız başarıyla gönderildi.');
    });
});

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});
