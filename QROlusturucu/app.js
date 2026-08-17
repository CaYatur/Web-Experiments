// DOM Elements
const qrType = document.getElementById('qrType');
const generateSingleBtn = document.getElementById('generateSingle');
const generateBulkBtn = document.getElementById('generateBulk');
const previewSection = document.getElementById('previewSection');
const qrPreview = document.getElementById('qrPreview');
const bulkResults = document.getElementById('bulkResults');
const bulkQRContainer = document.getElementById('bulkQRContainer');
const bulkCount = document.getElementById('bulkCount');

// Customization elements
const qrSizeInput = document.getElementById('qrSize');
const sizeValue = document.getElementById('sizeValue');
const errorCorrection = document.getElementById('errorCorrection');
const fgColor = document.getElementById('fgColor');
const bgColor = document.getElementById('bgColor');
const logoUpload = document.getElementById('logoUpload');
const logoSizeInput = document.getElementById('logoSize');
const logoSizeValue = document.getElementById('logoSizeValue');
const logoSizeGroup = document.getElementById('logoSizeGroup');
const logoBgGroup = document.getElementById('logoBgGroup');
const logoBgEnabled = document.getElementById('logoBgEnabled');
const logoBgColorGroup = document.getElementById('logoBgColorGroup');
const logoBgColor = document.getElementById('logoBgColor');
const logoBgPadding = document.getElementById('logoBgPadding');
const logoBgPaddingValue = document.getElementById('logoBgPaddingValue');
const logoBgRounded = document.getElementById('logoBgRounded');
const removeLogoBtn = document.getElementById('removeLogo');

// Bulk elements
const excelFile = document.getElementById('excelFile');
const dropZone = document.getElementById('dropZone');
const fileLoadedInfo = document.getElementById('fileLoadedInfo');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const clearFileBtn = document.getElementById('clearFileBtn');
const bulkStatsInfo = document.getElementById('bulkStatsInfo');
const downloadExcelTemplateBtn = document.getElementById('downloadExcelTemplate');
const downloadCsvTemplateBtn = document.getElementById('downloadCsvTemplate');
const bulkText = document.getElementById('bulkText');

// State
let currentLogo = null;
let generatedQRCodes = [];

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// QR Type switching
qrType.addEventListener('change', () => {
    document.querySelectorAll('.type-input').forEach(input => input.classList.remove('active'));
    document.getElementById(`${qrType.value}Input`).classList.add('active');
});

// Size slider
qrSizeInput.addEventListener('input', () => {
    sizeValue.textContent = qrSizeInput.value;
});

// Logo size slider
logoSizeInput.addEventListener('input', () => {
    logoSizeValue.textContent = logoSizeInput.value;
});

// Logo background padding slider
logoBgPadding.addEventListener('input', () => {
    logoBgPaddingValue.textContent = logoBgPadding.value;
});

// Logo background toggle
logoBgEnabled.addEventListener('change', () => {
    logoBgColorGroup.style.display = logoBgEnabled.checked ? 'block' : 'none';
});

// Logo upload
logoUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentLogo = event.target.result;
            logoSizeGroup.style.display = 'block';
            logoBgGroup.style.display = 'block';
            removeLogoBtn.style.display = 'block';
            // Auto-set high error correction for logo
            errorCorrection.value = 'H';
            // Show logo preview
            showLogoPreview(currentLogo);
        };
        reader.readAsDataURL(file);
    }
});

// Show logo preview
function showLogoPreview(logoSrc) {
    const previewContainer = document.getElementById('logoPreviewContainer');
    const logoPreviewImg = document.getElementById('logoPreviewImg');
    logoPreviewImg.src = logoSrc;
    previewContainer.style.display = 'block';
}

// Hide logo preview
function hideLogoPreview() {
    const previewContainer = document.getElementById('logoPreviewContainer');
    previewContainer.style.display = 'none';
}

// Remove logo
removeLogoBtn.addEventListener('click', () => {
    currentLogo = null;
    logoUpload.value = '';
    logoSizeGroup.style.display = 'none';
    logoBgGroup.style.display = 'none';
    logoBgEnabled.checked = false;
    logoBgColorGroup.style.display = 'none';
    removeLogoBtn.style.display = 'none';
    hideLogoPreview();
});

// ----------------------------------------------------
// Helper Functions for Bulk & Filenames
// ----------------------------------------------------

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeFilename(name, fallback = 'qrcode') {
    if (!name || typeof name !== 'string' || !name.trim()) return fallback;
    
    // Remove extension if user wrote one
    let clean = name.trim().replace(/\.(png|svg|jpg|jpeg|webp)$/i, '');
    
    // Replace characters invalid in Windows/Mac/Linux filenames: \ / : * ? " < > |
    clean = clean.replace(/[\\/:*?"<>|]/g, '_');
    
    // Replace multiple spaces or dashes with a clean delimiter
    clean = clean.replace(/\s+/g, '_');
    
    // Remove leading/trailing dots and underscores
    clean = clean.replace(/^[_.]+|[_.]+$/g, '');
    
    if (!clean) return fallback;
    return clean.substring(0, 80);
}

function parseBulkLine(line) {
    if (!line) return null;
    line = line.trim();
    if (!line) return null;

    // 1. Pipe format: Metin | Dosya Adı
    if (line.includes('|')) {
        const idx = line.indexOf('|');
        const data = line.substring(0, idx).trim();
        const filename = line.substring(idx + 1).trim();
        if (data) return { data, filename };
    }

    // 2. Tab separated
    if (line.includes('\t')) {
        const parts = line.split('\t');
        const data = parts[0].trim();
        const filename = parts.slice(1).join(' ').trim();
        if (data) return { data, filename };
    }

    // 3. Semicolon separated (except for WIFI/VCARD data)
    if (line.includes(';') && !line.startsWith('WIFI:') && !line.startsWith('BEGIN:VCARD')) {
        const parts = line.split(';');
        if (parts.length >= 2) {
            const data = parts[0].trim();
            const filename = parts.slice(1).join('_').trim();
            if (data) return { data, filename };
        }
    }

    return { data: line, filename: '' };
}

// ----------------------------------------------------
// Sample Template Downloads (Excel & CSV)
// ----------------------------------------------------

// Excel Template (.xlsx)
downloadExcelTemplateBtn.addEventListener('click', () => {
    if (typeof XLSX === 'undefined') {
        alert('Excel kütüphanesi yüklenemedi. Lütfen internet bağlantınızı kontrol edin.');
        return;
    }

    const templateData = [
        ['Metin / URL', 'Dosya Adı'],
        ['https://example.com/urun-1', 'urun_karekod_1'],
        ['https://example.com/urun-2', 'urun_karekod_2'],
        ['Masa 5 Sipariş Menüsü', 'masa_5_menu'],
        ['WIFI:T:WPA;S:MisafirAg;P:12345678;;', 'wifi_misafir'],
        ['Örnek Metin (Dosya adı boş bırakılırsa otomatik adlandırılır)', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    ws['!cols'] = [
        { wch: 45 },
        { wch: 25 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'QR Listesi');
    XLSX.writeFile(wb, 'ornek_qr_sablonu.xlsx');
});

// CSV Template (.csv)
downloadCsvTemplateBtn.addEventListener('click', () => {
    const csvRows = [
        'Metin / URL;Dosya Adı',
        'https://example.com/urun-1;urun_karekod_1',
        'https://example.com/urun-2;urun_karekod_2',
        'Masa 5 Sipariş Menüsü;masa_5_menu',
        'WIFI:T:WPA;S:MisafirAg;P:12345678;;;wifi_misafir',
        'Örnek Metin (Dosya adı boş bırakılırsa otomatik adlandırılır);'
    ];

    // UTF-8 with BOM for Excel compatibility with Turkish characters
    const csvContent = '\uFEFF' + csvRows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'ornek_qr_sablonu.csv');
});

// ----------------------------------------------------
// File Upload & Drag-and-Drop Processing
// ----------------------------------------------------

function handleUploadedFile(file) {
    if (!file) return;

    const extension = file.name.split('.').pop().toLowerCase();

    if (extension === 'xlsx' || extension === 'xls') {
        if (typeof XLSX === 'undefined') {
            alert('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                processImportedRows(rows, file.name);
            } catch (err) {
                console.error(err);
                alert('Excel dosyası okunurken hata oluştu: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    } else if (extension === 'csv' || extension === 'txt') {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const rows = parseCSVText(text);
                processImportedRows(rows, file.name);
            } catch (err) {
                console.error(err);
                alert('Dosya okunurken hata oluştu: ' + err.message);
            }
        };
        reader.readAsText(file);
    } else {
        alert('Lütfen geçerli bir .xlsx, .xls, .csv veya .txt dosyası seçin.');
    }
}

// Simple CSV text parser supporting both comma and semicolon
function parseCSVText(text) {
    const lines = text.split(/\r?\n/);
    const rows = [];

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        let delimiter = ';';
        if (!line.includes(';') && line.includes(',')) {
            delimiter = ',';
        } else if (line.includes('\t')) {
            delimiter = '\t';
        }

        // Basic CSV split
        const parts = line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
        rows.push(parts);
    }

    return rows;
}

// Process 2D rows from Excel/CSV
function processImportedRows(rows, fileName) {
    if (!rows || rows.length === 0) {
        alert('Dosyada veri bulunamadı.');
        return;
    }

    // Check if first row is header
    let startIndex = 0;
    const firstRowStr = (rows[0] || []).join(' ').toLowerCase();
    if (firstRowStr.includes('metin') || firstRowStr.includes('url') || 
        firstRowStr.includes('text') || firstRowStr.includes('qr') || 
        firstRowStr.includes('dosya') || firstRowStr.includes('name') || firstRowStr.includes('ad')) {
        startIndex = 1;
    }

    const formattedLines = [];
    let customNameCount = 0;

    for (let i = startIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        let qrData = '';
        let filename = '';

        if (Array.isArray(row)) {
            qrData = row[0] != null ? String(row[0]).trim() : '';
            filename = row[1] != null ? String(row[1]).trim() : '';
        }

        if (qrData) {
            if (filename) {
                formattedLines.push(`${qrData} | ${filename}`);
                customNameCount++;
            } else {
                formattedLines.push(qrData);
            }
        }
    }

    if (formattedLines.length === 0) {
        alert('Dosyada geçerli QR kod verisi bulunamadı.');
        return;
    }

    bulkText.value = formattedLines.join('\n');

    // Show file info
    fileNameDisplay.textContent = `📄 ${fileName} (${formattedLines.length} satır)`;
    fileLoadedInfo.style.display = 'inline-flex';

    // Show stats info
    bulkStatsInfo.textContent = `✅ ${formattedLines.length} adet QR kod içeri aktarıldı` +
        (customNameCount > 0 ? ` (${customNameCount} adedinde özel dosya adı tanımlı)` : '');
    bulkStatsInfo.style.display = 'flex';
}

// Clear loaded file
clearFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    excelFile.value = '';
    fileLoadedInfo.style.display = 'none';
    bulkStatsInfo.style.display = 'none';
});

// File input change
excelFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        handleUploadedFile(file);
    }
});

// Drag and drop support
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
    });
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
    });
});

dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    if (file) {
        excelFile.files = dt.files;
        handleUploadedFile(file);
    }
});

// ----------------------------------------------------
// Single QR Generation
// ----------------------------------------------------

function getQRData() {
    const type = qrType.value;
    
    switch (type) {
        case 'text':
            return document.getElementById('qrText').value;
        
        case 'wifi':
            const ssid = document.getElementById('wifiSSID').value;
            const password = document.getElementById('wifiPassword').value;
            const wifiType = document.getElementById('wifiType').value;
            return `WIFI:T:${wifiType};S:${ssid};P:${password};;`;
        
        case 'vcard':
            const name = document.getElementById('vcardName').value;
            const org = document.getElementById('vcardOrg').value;
            const phone = document.getElementById('vcardPhone').value;
            const email = document.getElementById('vcardEmail').value;
            const url = document.getElementById('vcardUrl').value;
            const address = document.getElementById('vcardAddress').value;
            return `BEGIN:VCARD\nVERSION:3.0\nN:${name}\nFN:${name}\nORG:${org}\nTEL:${phone}\nEMAIL:${email}\nURL:${url}\nADR:${address}\nEND:VCARD`;
        
        case 'email':
            const emailTo = document.getElementById('emailTo').value;
            const subject = encodeURIComponent(document.getElementById('emailSubject').value);
            const body = encodeURIComponent(document.getElementById('emailBody').value);
            return `mailto:${emailTo}?subject=${subject}&body=${body}`;
        
        case 'phone':
            return `tel:${document.getElementById('phoneNumber').value}`;
        
        case 'sms':
            const smsNumber = document.getElementById('smsNumber').value;
            const smsBody = encodeURIComponent(document.getElementById('smsBody').value);
            return `sms:${smsNumber}?body=${smsBody}`;
        
        default:
            return '';
    }
}

// Generate QR code canvas
function generateQRCode(data, size = 256) {
    if (!data) {
        alert('Lütfen QR kod için veri girin!');
        return null;
    }

    const ecLevel = errorCorrection.value;
    const typeNumber = 0; // Auto

    const qr = qrcode(typeNumber, ecLevel);
    qr.addData(data);
    qr.make();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const moduleCount = qr.getModuleCount();
    const cellSize = size / moduleCount;

    canvas.width = size;
    canvas.height = size;

    // Background
    ctx.fillStyle = bgColor.value;
    ctx.fillRect(0, 0, size, size);

    // QR modules
    ctx.fillStyle = fgColor.value;
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
                ctx.fillRect(
                    col * cellSize,
                    row * cellSize,
                    cellSize,
                    cellSize
                );
            }
        }
    }

    return canvas;
}

// Add logo to QR code
function addLogoToCanvas(canvas, logoSrc, logoPercent, options = {}) {
    return new Promise((resolve) => {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
            const logoSize = canvas.width * (logoPercent / 100);
            const x = (canvas.width - logoSize) / 2;
            const y = (canvas.height - logoSize) / 2;

            // Draw background if enabled
            if (options.bgEnabled) {
                const padding = logoSize * (options.bgPadding / 100);
                const bgX = x - padding;
                const bgY = y - padding;
                const bgSize = logoSize + padding * 2;
                
                ctx.fillStyle = options.bgColor || '#ffffff';
                
                if (options.bgRounded) {
                    // Draw rounded rectangle
                    const radius = bgSize * 0.15;
                    ctx.beginPath();
                    ctx.moveTo(bgX + radius, bgY);
                    ctx.lineTo(bgX + bgSize - radius, bgY);
                    ctx.quadraticCurveTo(bgX + bgSize, bgY, bgX + bgSize, bgY + radius);
                    ctx.lineTo(bgX + bgSize, bgY + bgSize - radius);
                    ctx.quadraticCurveTo(bgX + bgSize, bgY + bgSize - radius, bgX + bgSize);
                    ctx.lineTo(bgX + radius, bgY + bgSize);
                    ctx.quadraticCurveTo(bgX, bgY + bgSize, bgX, bgY + bgSize - radius);
                    ctx.lineTo(bgX, bgY + radius);
                    ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
                    ctx.closePath();
                    ctx.fill();
                } else {
                    ctx.fillRect(bgX, bgY, bgSize, bgSize);
                }
            }

            // Draw logo
            ctx.drawImage(img, x, y, logoSize, logoSize);
            resolve(canvas);
        };
        
        img.src = logoSrc;
    });
}

function getLogoOptions() {
    return {
        bgEnabled: logoBgEnabled.checked,
        bgColor: logoBgColor.value,
        bgPadding: parseInt(logoBgPadding.value),
        bgRounded: logoBgRounded.checked
    };
}

// Generate single QR
generateSingleBtn.addEventListener('click', async () => {
    const data = getQRData();
    const size = parseInt(qrSizeInput.value);
    
    let canvas = generateQRCode(data, size);
    if (!canvas) return;

    if (currentLogo) {
        const logoOptions = getLogoOptions();
        canvas = await addLogoToCanvas(canvas, currentLogo, parseInt(logoSizeInput.value), logoOptions);
    }

    // Display preview
    qrPreview.innerHTML = '';
    qrPreview.appendChild(canvas);
    previewSection.style.display = 'block';
    bulkResults.style.display = 'none';

    // Scroll to preview
    previewSection.scrollIntoView({ behavior: 'smooth' });

    // Setup download buttons
    setupDownloadButtons(canvas, data);
});

// Setup download buttons
function setupDownloadButtons(canvas, filename) {
    const downloadPNG = document.getElementById('downloadPNG');
    const downloadSVG = document.getElementById('downloadSVG');

    const cleanFilename = sanitizeFilename(filename, 'qrcode');

    // PNG download
    downloadPNG.onclick = () => {
        const link = document.createElement('a');
        link.download = `${cleanFilename}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    // SVG download
    downloadSVG.onclick = () => {
        const svgData = canvasToSVG(canvas);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `${cleanFilename}.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    };
}

// Convert canvas to SVG
function canvasToSVG(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { width, height, data } = imageData;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
    svg += `<rect width="100%" height="100%" fill="${bgColor.value}"/>`;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            if (r < 128 && g < 128 && b < 128) {
                svg += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fgColor.value}"/>`;
            }
        }
    }

    svg += '</svg>';
    return svg;
}

// ----------------------------------------------------
// Bulk QR Generation & ZIP Export
// ----------------------------------------------------

generateBulkBtn.addEventListener('click', async () => {
    const textContent = bulkText.value;
    const rawLines = textContent.split('\n');
    const parsedItems = [];

    for (let line of rawLines) {
        const parsed = parseBulkLine(line);
        if (parsed && parsed.data) {
            parsedItems.push(parsed);
        }
    }

    if (parsedItems.length === 0) {
        alert('Lütfen en az bir QR kod verisi girin veya dosya yükleyin!');
        return;
    }

    generatedQRCodes = [];
    bulkQRContainer.innerHTML = '';
    const size = parseInt(qrSizeInput.value);
    const previewSize = 160;
    const logoOptions = getLogoOptions();

    for (let i = 0; i < parsedItems.length; i++) {
        const itemData = parsedItems[i];
        const data = itemData.data;
        const customFilename = itemData.filename;

        // Determine final download filename
        const finalFilename = customFilename 
            ? sanitizeFilename(customFilename) 
            : sanitizeFilename(data.substring(0, 30), `qrcode_${i + 1}`);
        
        // Generate full size QR for downloading
        let fullCanvas = generateQRCode(data, size);
        if (!fullCanvas) continue;
        
        if (currentLogo) {
            fullCanvas = await addLogoToCanvas(fullCanvas, currentLogo, parseInt(logoSizeInput.value), logoOptions);
        }
        
        // Generate small preview QR
        let previewCanvas = generateQRCode(data, previewSize);
        if (currentLogo) {
            previewCanvas = await addLogoToCanvas(previewCanvas, currentLogo, parseInt(logoSizeInput.value), logoOptions);
        }

        const item = document.createElement('div');
        item.className = 'bulk-qr-item';

        let badgeHtml = '';
        if (customFilename) {
            badgeHtml = `<div class="qr-filename-badge" title="Özel Dosya Adı: ${escapeHtml(finalFilename)}.png">📁 <strong>Dosya:</strong> ${escapeHtml(finalFilename)}.png</div>`;
        }

        item.innerHTML = `
            ${badgeHtml}
            <div class="qr-label" title="${escapeHtml(data)}">${escapeHtml(data.substring(0, 50))}${data.length > 50 ? '...' : ''}</div>
        `;
        item.insertBefore(previewCanvas, item.firstChild);

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn-download';
        downloadBtn.textContent = `İndir (${size}px)`;
        downloadBtn.title = `${finalFilename}.png olarak indir`;
        
        ((canvasToDownload, downloadName) => {
            downloadBtn.onclick = () => {
                const link = document.createElement('a');
                link.download = `${downloadName}.png`;
                link.href = canvasToDownload.toDataURL('image/png');
                link.click();
            };
        })(fullCanvas, finalFilename);
        
        item.appendChild(downloadBtn);
        bulkQRContainer.appendChild(item);
        
        generatedQRCodes.push({
            data: data,
            filename: finalFilename,
            canvas: fullCanvas
        });
    }

    bulkCount.textContent = generatedQRCodes.length;
    previewSection.style.display = 'none';
    bulkResults.style.display = 'block';
    bulkResults.scrollIntoView({ behavior: 'smooth' });
});

// Download all as ZIP with custom filenames and duplicate deduplication
document.getElementById('downloadAllZip').addEventListener('click', async () => {
    if (generatedQRCodes.length === 0) {
        alert('İndirilecek QR kod yok!');
        return;
    }

    const zip = new JSZip();
    const filenameCounts = new Map();
    
    generatedQRCodes.forEach((item, index) => {
        let baseName = item.filename || sanitizeFilename(item.data.substring(0, 30), `qrcode_${index + 1}`);
        
        // Prevent ZIP duplicate filename collisions
        let count = filenameCounts.get(baseName) || 0;
        filenameCounts.set(baseName, count + 1);

        let uniqueFilename = count === 0 ? baseName : `${baseName}_(${count})`;

        const dataURL = item.canvas.toDataURL('image/png');
        const base64 = dataURL.split(',')[1];
        zip.file(`${uniqueFilename}.png`, base64, { base64: true });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'qr_kodlari.zip');
});

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab.id === 'single') {
            generateSingleBtn.click();
        } else {
            generateBulkBtn.click();
        }
    }
});
