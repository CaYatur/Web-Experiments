document.addEventListener("DOMContentLoaded", function() {
    // Başlangıçta yalnızca Hakkımda bölümünü göster
    document.getElementById("about").style.display = "block";
    document.getElementById("projects").style.display = "none"; // Projeler bölümünü gizle

    // Hakkımda ve Projelerim butonlarına tıklama olayları
    const aboutButton = document.getElementById("about-button");
    const projectsButton = document.getElementById("projects-button");

    aboutButton.addEventListener("click", function() {
        document.getElementById("about").style.display = "block";
        document.getElementById("projects").style.display = "none";
        aboutButton.classList.add("active"); // Aktif buton
        projectsButton.classList.remove("active");
    });

    projectsButton.addEventListener("click", function() {
        document.getElementById("about").style.display = "none";
        document.getElementById("projects").style.display = "block";
        projectsButton.classList.add("active"); // Aktif buton
        aboutButton.classList.remove("active");
    });

    
});



function submitContactForm(event) {
    event.preventDefault(); // Formun varsayılan davranışını engelle

    const email = document.getElementById('email').value;
    const title = document.getElementById('title').value;
    const subject = document.getElementById('subject').value;
    const content = document.getElementById('content').value;

    fetch('/feedback', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, title, subject, content }),
    })
    .then(response => {
        if (response.ok) {
            alert('Mesajınız başarıyla gönderildi!');
            document.getElementById('contact-form').reset(); // Formu sıfırla
        } else {
            alert('Bir hata oluştu, lütfen tekrar deneyin.');
        }
    })
    .catch(error => {
        console.error('İletişim hatası:', error);
        alert('Bir hata oluştu, lütfen tekrar deneyin.');
    });
}



// Projeleri yükle
fetch('projects.json')
    .then(response => response.json())
    .then(data => {
        const projectList = document.getElementById('project-list');
        data.projects.forEach(project => {
            const projectDiv = document.createElement('div');
            projectDiv.className = 'project';
            projectDiv.innerHTML = `
                <img src="${project.coverImage}" alt="${project.title} Kapak">
                <h3>${project.title}</h3>
                <p>${project.shortDescription}</p>
                <a href="#" onclick="openModal('${project.id}')">Daha Fazla Bilgi</a>
            `;
            projectList.appendChild(projectDiv);
        });
    });

// Sekme geçiş fonksiyonu
function openTab(evt, tabName) {
    var i, tabcontent, tablinks;

    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    tablinks = document.getElementsByClassName("tablinks");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

// Modal fonksiyonları
function openModal(projectId) {
    const modal = document.getElementById("modal");
    modal.style.display = "block";

    // Modal içeriğini ayarla
    fetch('projects.json')
        .then(response => response.json())
        .then(data => {
            const project = data.projects.find(p => p.id === projectId);
            document.getElementById("modal-title").innerText = project.title;
            document.getElementById("modal-description").innerText = project.description;
            document.getElementById("modal-download").href = project.downloadLink;

            const modalImages = document.getElementById("modal-images");
            modalImages.innerHTML = project.images.map(img => `<img src="${img}" alt="${project.title} Görsel">`).join('');
        });
}

function closeModal() {
    var modal = document.getElementById("modal");
    modal.style.display = "none";
}

