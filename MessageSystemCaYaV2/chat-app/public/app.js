const socket = io();
let autoScrollEnabled = true;
let username;

document.getElementById('show-register').addEventListener('click', function() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
});

document.getElementById('show-login').addEventListener('click', function() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
});

document.getElementById('show-reset').addEventListener('click', function() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('reset-form').style.display = 'block';
});

document.getElementById('show-login-from-reset').addEventListener('click', function() {
    document.getElementById('reset-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
});

// Şifre sıfırlama butonuna tıklandığında
document.getElementById('reset-form').addEventListener('submit', function(event) {
    event.preventDefault(); // Sayfanın yenilenmesini önle
    const email = document.getElementById('reset-email').value;

    // Konsola log yazma
    console.log('Şifre sıfırlama talebi gönderildi: ' + email);

    // E-posta adresi kontrolü
    if (email) {
        // Şifre sıfırlama isteği gönderme
        fetch('/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        })
        .then(response => response.json())
        .then(data => {
            if (data.message) {
                alert(data.message); // Sunucudan gelen mesajı göster
            }
        })
        .catch(error => {
            console.error('Hata:', error);
            alert('Bir hata oluştu, lütfen tekrar deneyin.');
        });
    } else {
        alert('Lütfen e-posta adresinizi girin!');
    }
});

// Automatically login if cookie exists
window.onload = function() {
    const usernameCookie = document.cookie.split('; ').find(row => row.startsWith('username='));
    const passwordCookie = document.cookie.split('; ').find(row => row.startsWith('password='));

    if (usernameCookie && passwordCookie) {
        const usernameFromCookie = usernameCookie.split('=')[1];
        const passwordFromCookie = passwordCookie.split('=')[1];

        document.getElementById('login-username').value = usernameFromCookie; // Fill the username field
        document.getElementById('login-password').value = passwordFromCookie; // Optionally clear the password field for security

        // Optionally, show a message or alert to enter the password
        //alert("Please enter your password to continue.");

        // Simulate a login event
        const simulatedLoginEvent = new Event('submit', { bubbles: true });
        document.getElementById('login-form').dispatchEvent(simulatedLoginEvent);

        console.log(`Username: ${usernameFromCookie}, Password: ${passwordFromCookie}`); // Use this for debugging only
    }
};



// Kayıt formu
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const profilePic = "/uploads/cayadata/user.png";
    const email = document.getElementById('register-email').value;

    const response = await fetch('/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password, profilePic, email })
    });

    const data = await response.json();
    alert(data.message);
});


// Giriş formu
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    username = document.getElementById('login-username').value; // Username'i al
    const password = document.getElementById('login-password').value;

    const response = await fetch('/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
        // Set cookies for the logged-in user
        document.cookie = `username=${username}; path=/; max-age=2592000`; // 30 gün süresince geçerli
        document.cookie = `password=${password}; path=/; max-age=2592000`; // 30 gün süresince geçerli
        console.log(`Username: ${username}, Password: ${password}`);

        localStorage.setItem('profilePic', data.profilePic); // Profil fotoğrafını sakla
        //alert(data.message);
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('chat-container').style.display = 'block';
        loadMessages();
    } else {
        alert(data.message);
    }
});

document.getElementById('logout-button').addEventListener('click', function() {
    // Clear the cookies
    document.cookie = "username=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "password=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

    // Hide chat container and show auth container
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('auth-container').style.display = 'block';
});



// Profile picture upload button
document.getElementById('profile-pic-btn').addEventListener('click', () => {
    promptProfilePicUpload(username); // Username'i ilet
});

// Kullanıcıdan profil fotoğrafı yüklemesini istemek için fonksiyon
function promptProfilePicUpload(username) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('profilePic', file);
            formData.append('username', username); // Kullanıcı adını da ekle

            const response = await fetch('/uploadProfilePic', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (response.ok) {
                localStorage.setItem('profilePic', data.profilePic); // Profil fotoğrafını sakla
                alert(data.message);
            } else {
                alert('Profil fotoğrafı yüklenemedi.');
            }
        }
    });

    fileInput.click(); // Dosya yükleme penceresini aç
}




// Mesaj gönderme
const messageInput = document.getElementById('message-input');
document.getElementById('send-button').onclick = () => {
    sendMessage(); 
};

messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendMessage();
    }
});

let uploadedFileData = null; // Yüklenen dosya verisini saklamak için bir değişken

// Dosya yükleme işlemi
document.getElementById('file-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    const progressBar = document.getElementById('upload-progress');
    const statusText = document.getElementById('upload-status');

    if (file) {
        const formData = new FormData();
        formData.append('file', file);

        progressBar.style.display = 'block'; // İlerleme çubuğunu göster
        statusText.style.display = 'block'; // Yükleniyor mesajını göster
        statusText.textContent = "Yükleniyor...";

        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                progressBar.value = percentComplete; // İlerleme çubuğunu güncelle
            }
        });

        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                progressBar.style.display = 'none'; // İlerleme çubuğunu gizle
                statusText.style.display = 'none'; // Yükleniyor mesajını gizle
                
                if (xhr.status === 200) {
                    const fileData = JSON.parse(xhr.responseText);
                    uploadedFileData = fileData; // Yüklenen dosya verisini sakla
                    //alert('Dosya başarıyla yüklendi!');
                } else {
                    alert('Dosya yükleme başarısız.');
                }
            }
        };

        xhr.open("POST", "/upload", true);
        xhr.send(formData);
    }
});


// Mesaj gönderme fonksiyonu
function sendMessage() {
    const messageInput = document.getElementById('message-input'); // Mesaj giriş alanı
    const message = messageInput.value.trim();

    const data = {
        username: document.getElementById('login-username').value,
        file: uploadedFileData, // Yüklenen dosya verisi
        message,
        profilePic: localStorage.getItem('profilePic') // Kullanıcının profil fotoğrafı
    };

    // Sadece mesaj veya dosya verisi var mı kontrol et
    if (uploadedFileData || message) {
        socket.emit('send_message', data);
        messageInput.value = ''; // Mesaj giriş alanını temizle
        uploadedFileData = null; // Yüklenen dosya verisini sıfırla
    } else {
        //alert('Gönderilecek bir mesaj veya dosya yok.');
    }
};


// Mesaj gönderme butonuna tıklama olayını dinle
document.getElementById('send-button').addEventListener('click', sendMessage);

// Mesajları yükle
function loadMessages() {
    fetch('/messages')
        .then(response => response.json())
        .then(messages => {
            messages.forEach(message => {
                addMessageToDOM(message);
            });
            scrollToBottom();
        });
}

// Yeni mesaj geldiğinde
socket.on('receive_message', (data) => {
    addMessageToDOM(data);
});



function addMessageToDOM(data) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message'); // Mesaj için stil ekle

    // Kullanıcı profil fotoğrafını ve adı içeren bir kapsayıcı oluştur
    const userContainer = document.createElement('div');
    userContainer.classList.add('user-container'); // Kullanıcı bilgileri için stil ekle

    // Kullanıcı adı "CaYatur" ise özel resim ekle
    if (data.username === 'CaYatur') {
        const specialImage = document.createElement('img');
        specialImage.src = '/uploads/cayadata/crown.png'; // Özel resim yolu
        specialImage.alt = 'CaYatur profil resmi';
        specialImage.style.maxWidth = '20px';
        specialImage.style.display = 'block'; // Resmin altında boşluk kalmaması için

        // Resmin üzerine gelindiğinde "kurucu" yazısını göster
        specialImage.title = 'Kurucu'; // Resmin üzerine gelindiğinde görünen yazı
        messageElement.appendChild(specialImage);
    }

    // Kullanıcı profil fotoğrafını göster
    if (data.profilePic) {
        const img = document.createElement('img');
        img.src = data.profilePic; // Profil fotoğrafı yolunu al
        img.alt = `${data.username} profil fotoğrafı`;
        img.classList.add('profile-pic'); // Profil fotoğrafına stil ekle
        img.title = `${data.username}`;
        userContainer.appendChild(img);
    }

    // Kullanıcı adı ekle
    const usernameElement = document.createElement('span');
    usernameElement.textContent = `${data.username}: `;
    usernameElement.classList.add('username'); // Kullanıcı adı için stil ekle

    // Kullanıcı adı "CaYatur" ise gold sınıfını ekle
    if (data.username === 'CaYatur') {
        usernameElement.classList.add('gold'); // gold sınıfını ekle
    }

    userContainer.appendChild(usernameElement);

    // Mesajı ekle
    const messageText = document.createElement('span');
    messageText.textContent = data.message;
    userContainer.appendChild(messageText);

    messageElement.appendChild(userContainer);

    // Dosya varsa dosya türüne göre önizleme göster
    if (data.file) {
        let fileElement; // Dosya önizlemesi için bir değişken

        if (data.file.type.startsWith('image/')) {
            fileElement = document.createElement('img');
            fileElement.src = data.file.path; // Sunucudan gelen yolu kullanıyoruz
            fileElement.alt = data.file.filename;
            fileElement.style.maxWidth = '200px';
            fileElement.style.display = 'block'; // Resmin altında boşluk kalmaması için
        } else if (data.file.type.startsWith('video/')) {
            fileElement = document.createElement('video');
            fileElement.src = data.file.path; // Sunucudan gelen yolu kullanıyoruz
            fileElement.controls = true;
            fileElement.style.maxWidth = '200px';
        } else {
            const fileLink = document.createElement('a');
            fileLink.href = data.file.path; // Sunucudan gelen yolu kullanıyoruz
            fileLink.textContent = `Dosya: ${data.file.filename}`;
            fileElement = fileLink; // Dosya bağlantısını kullan
        }

        // Dosya önizlemesini mesaj elementine ekle
        messageElement.appendChild(fileElement);
    }

    document.getElementById('messages').appendChild(messageElement);

    // Resimlerin yüklenmesini bekleyip kaydırmayı gerçekleştir
    if (data.file && data.file.type.startsWith('image/')) {
        const img = messageElement.querySelector('img');
        img.onload = () => {
            if (autoScrollEnabled) scrollToBottom();
        };
    } else {
        if (autoScrollEnabled) scrollToBottom();
    }
}






// En alta kaydırma
function scrollToBottom() {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Kullanıcı yukarıda mesajları okurken otomatik kaydırmayı devre dışı bırakma
const messagesContainer = document.getElementById('messages');
messagesContainer.addEventListener('scroll', () => {
    const isAtBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 1;
    autoScrollEnabled = isAtBottom; // Kullanıcı yukarıda mı kontrol et
});


// Modal elementi ve imaj
const modal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const closeModal = document.querySelector('.close');

// Modal açma ve kapama
function openModal(imageSrc) {
    modal.style.display = "block";
    modalImage.src = imageSrc;
}

function closeModalFunction() {
    modal.style.display = "none";
}

// Resim üzerine tıklama olayı
document.addEventListener('click', (event) => {
    const target = event.target;
    if (target.tagName === 'IMG' && target.closest('#messages')) {
        openModal(target.src);
    }
});

// Modal kapama butonuna tıklama
closeModal.addEventListener('click', closeModalFunction);

// Modal dışına tıklama ile kapama
window.addEventListener('click', (event) => {
    if (event.target === modal) {
        closeModalFunction();
    }
});

