const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// Dosyaların saklanacağı klasör
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer ile dosya yükleme yapılandırması
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); // Dosya adı orijinal adıyla kaydedilir
    }
});

const upload = multer({ storage: storage });

// Dosya meta verilerini saklamak için JSON dosyası
const metaFilePath = 'file-metadata.json';

// JSON dosyasını oluşturup okuma/yazma işlemleri
function readMetaFile() {
    if (!fs.existsSync(metaFilePath)) {
        fs.writeFileSync(metaFilePath, JSON.stringify([]));
    }
    const data = fs.readFileSync(metaFilePath);
    return JSON.parse(data);
}

function writeMetaFile(data) {
    fs.writeFileSync(metaFilePath, JSON.stringify(data, null, 2));
}

// Dosya yükleme API'si
app.post('/upload', upload.single('file'), (req, res) => {
    const { title } = req.body;
    if (!title) {
        return res.status(400).json({ message: 'Başlık zorunludur!' });
    }
    
    const fileData = {
        title,
        filePath: req.file.path,
        fileName: req.file.originalname,
        createdAt: new Date().toISOString()
    };

    const metadata = readMetaFile();
    metadata.unshift(fileData); // Yeni dosya en üstte olacak şekilde ekle
    writeMetaFile(metadata);

    res.json({ message: 'Dosya başarıyla yüklendi!', file: fileData });
});

// Dosya indirme API'si
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ message: 'Dosya bulunamadı' });
    }
});

// Dosya detaylarını JSON olarak döndüren API
app.get('/downloadfiledataget/:filename', (req, res) => {
    const fileName = req.params.filename;
    const metadata = readMetaFile().find(file => file.fileName === fileName);

    if (metadata) {
        fs.promises.stat(metadata.filePath).then(stats => {
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2); // MB cinsinden hesapla
            res.json({
                title: metadata.title,
                fileName: metadata.fileName,
                fileSizeMB: fileSizeMB
            });
        }).catch(error => {
            console.error('Dosya bilgileri alınırken bir hata oluştu:', error);
            res.status(500).json({ message: 'Bir hata oluştu' });
        });
    } else {
        res.status(404).json({ message: 'Dosya bilgileri bulunamadı' });
    }
});

// Dosya detaylarını içeren HTML sayfasına yönlendirme API'si
app.get('/downloadmenu/:filename', (req, res) => {
    const fileName = req.params.filename;
    const filePath = path.join(uploadDir, fileName);
    if (fs.existsSync(filePath)) {
        fs.promises.stat(filePath).then(stats => {
            const fileSize = stats.size;
            const fileFormat = path.extname(fileName).substring(1);
            res.redirect(`/download.html?fileName=${encodeURIComponent(fileName)}&fileFormat=${encodeURIComponent(fileFormat)}&fileSize=${fileSize}`);
        }).catch(error => {
            console.error('Dosya bilgileri alınırken bir hata oluştu:', error);
            res.status(500).json({ message: 'Bir hata oluştu' });
        });
    } else {
        res.status(404).json({ message: 'Dosya bilgileri bulunamadı' });
    }
});

// Dosya listeleme API'si
app.get('/files', (req, res) => {
    const metadata = readMetaFile();
    res.json(metadata); // Dosya bilgilerini JSON olarak döndür
});

// Static dosyaları sunma (HTML, CSS, JS)
app.use(express.static('public'));





// Sunucuyu başlatma
app.listen(port, () => {
    console.log(`Sunucu ${port} portunda çalışıyor`);
});
