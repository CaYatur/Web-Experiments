const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;


// Yükleme klasörü ve dosya ismi formatı
const uploadDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir)); // Yüklenen dosyaları statik olarak sunma
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Kullanıcı verilerini oku
function readUsers() {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'users.json'));
    return JSON.parse(data);
}

// Kullanıcı verilerini yaz
function writeUsers(users) {
    fs.writeFileSync(path.join(__dirname, 'data', 'users.json'), JSON.stringify(users, null, 2));
}

// Mesaj verilerini oku
function readMessages() {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'messages.json'));
    return JSON.parse(data);
}

// Mesaj verilerini yaz
function writeMessages(messages) {
    fs.writeFileSync(path.join(__dirname, 'data', 'messages.json'), JSON.stringify(messages, null, 2));
}

// Kullanıcı ekleme örneği (e-posta ile)
app.post('/register', (req, res) => {
    const { username, password, profilePic, email } = req.body;
    const users = readUsers();

    // E-posta veya kullanıcı adı kontrolü (var mı?)
    const existingUser = users.find(user => user.username === username || user.email === email);
    if (existingUser) {
        return res.status(400).json({ message: 'Bu e-posta veya kullanıcı adı ile kayıtlı bir kullanıcı mevcut.' });
    }

    // Yeni kullanıcıyı ekle
    const newUser = { username, password, profilePic, email };
    users.push(newUser);
    saveUsers(users);

    res.status(201).json({ message: 'Kullanıcı başarıyla kaydedildi.' });
});


// Giriş yapma isteği
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();

    // Kullanıcı adı ve şifre kontrolü
    const user = users.find(user => user.username === username && user.password === password);
    if (!user) {
        return res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı.' });
    }

    // Profil fotoğrafı yolunu döndür
    res.json({ message: 'Giriş başarılı!', profilePic: user.profilePic });
});




// Kullanıcıyı kaydetme işlevi
const saveUsers = (users) => {
    fs.writeFileSync('data/users.json', JSON.stringify(users, null, 2));
};

// Şifre sıfırlama isteği
app.post('/reset-password', (req, res) => {
    const { email } = req.body;
    const users = readUsers();

    // Kullanıcıyı bul
    const user = users.find(user => user.email === email);
    if (!user) {
        return res.status(404).json({ message: 'E-posta adresi bulunamadı.' });
    }

    // SMTP ayarları
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // 465 için true, 587 için false
        auth: {
            user: 'YOUR_EMAIL@gmail.com', // Gönderici mail adresi
            pass: 'CHANGE_ME' // Gönderici şifresi
        },
        tls: {
            rejectUnauthorized: false // Sertifika doğrulamasını atla (geliştirme için)
        }
    });
    

    // E-posta gönderimi
    const mailOptions = {
        from: 'CaYaSystem <YOUR_EMAIL@gmail.com>',
        to: email,
        subject: 'Şifremi Unuttum',
        html: `
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f4f4f4;
                        padding: 20px;
                    }
                    .container {
                        background-color: #ffffff;
                        border-radius: 8px;
                        padding: 20px;
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                    }
                    h1 {
                        color: #333;
                    }
                    p {
                        color: #666;
                    }
                    .button {
                        display: inline-block;
                        padding: 10px 20px;
                        font-size: 16px;
                        color: white;
                        background-color: #28a745;
                        text-decoration: none;
                        border-radius: 5px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Şifre Unuttum Talebi</h1>
                    <p>Merhaba ${user.username},</p>
                    <p>Mevcut şifreniz: <strong>${user.password}</strong></p>
                    <p>Lütfen şifrenizi güvenli bir şekilde saklayın.</p>
                    <p>Saygılarımızla,<br>CaYaSystem</p>
                </div>
            </body>
            </html>
        `
    };
    

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.status(500).json({ message: 'E-posta gönderilemedi.' + error });
        }
        res.status(200).json({ message: 'Şifre sıfırlama e-postası gönderildi.' });
    });
});


// Profil fotoğrafı yükleme
app.post('/uploadProfilePic', upload.single('profilePic'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Dosya yüklenemedi.' });
    }

    const users = readUsers();
    const username = req.body.username; // Kullanıcı adını isteyin
    const user = users.find(user => user.username === username);

    if (user) {
        user.profilePic = `/uploads/${req.file.filename}`; // Kullanıcıya profil fotoğrafı yolunu ata
        writeUsers(users); // Güncellenmiş kullanıcıları yaz
        res.status(200).json({ message: 'Profil fotoğrafı yüklendi!', profilePic: user.profilePic });
    } else {
        res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
    }
});


// Mesajları gönderme
app.get('/messages', (req, res) => {
    const messages = readMessages();
    res.json(messages);
});

// Dosya yükleme
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Dosya yüklenemedi.' });
    }
    const fileData = {
        filename: req.file.filename,
        path: `/uploads/${req.file.filename}`,
        type: req.file.mimetype
    };
    res.status(200).json(fileData);
});

// Socket.IO ile mesaj gönderme
io.on('connection', (socket) => {
    console.log('Yeni bir kullanıcı bağlandı.');

    socket.on('send_message', (data) => {
        const messages = readMessages();
        messages.push(data);
        writeMessages(messages);
        io.emit('receive_message', data); // Tüm kullanıcılara gönder
    });
});


// Sunucuyu başlat
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde başlatıldı.`);
});
