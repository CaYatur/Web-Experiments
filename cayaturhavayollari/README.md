# CaYatur Havayolları - Static Site

Basit ve hoş görünümlü bir statik site. GrandRP sunucunuzdaki CaYatur Havayolları için hazırlandı.

İçerik
- `index.html` — ana sayfa
- `css/styles.css` — stiller
- `js/script.js` — basit interaktivite (carousel, mobil menü)
- Görseller — workspace kökünde olan iki PNG görüntüsü kullanıldı

Yerel olarak çalıştırmak
PowerShell kullanarak basit bir dosya sunucusu ile çalıştırabilirsiniz:

```powershell
# Eğer Python yüklüyse
python -m http.server 8000
# Sonra tarayıcıda açın: http://localhost:8000/
```

Notlar
- Görselleriniz zaten projede yer alıyor: `Ekran görüntüsü 2025-09-21 134138.png` ve `Ekran görüntüsü 2025-09-21 134721.png`.
- İsterseniz logo, metinler, rota listesi veya rezervasyon formu ekleyebilirim.
- Projede artık interaktif bir GTA5 haritası (SVG), origin/destination seçimi, rota çizimi ve yerel rezervasyon sistemi vardır.

Yeni özellikler
- Harita: Markerlara tıklayarak kalkış ve varış noktalarını seçin. "Rezervasyon Yap" ile modal açılır.
- Rezervasyon: Modal üzerindeki formu doldurup onayladığınızda rezervasyonlar `localStorage`'a kaydedilir ve `Rezervasyonlarım` bölümünde listelenir.
- Hızlı Rezervasyon: Hazır rotalardaki "Hızlı Rezervasyon" düğmeleri harita seçimlerini yapıp rezervasyon modalını açar.

Yeni içerik eklendi
 - `Hakkımızda`, `Nasıl Çalışır?`, `Neden CaYatur?` ve `Sıkça Sorulan Sorular` bölümleri eklendi.
 - Galeri genişletildi; yeni görseller gösteriliyor.

Kısa kullanım
1. Tarayıcıda siteyi açın.
2. `Harita` sekmesine gidip kalkış ve varış noktalarını seçin.
3. `Rezervasyon Yap` butonuna basın, formu doldurun.
4. `Rezervasyonlarım` bölümünden rezervasyonları görüntüleyin, isterseniz `Dışa Aktar` ile JSON olarak indirin.

Test önerileri
 - Bir rezervasyon oluşturup `Rezervasyonlarım`'da göründüğünü doğrulayın.
 - `Dışa Aktar` ile JSON indirin, sonra `İçe Aktar` ile aynı dosyayı tekrar yükleyin.

Port notu
- Sunucu port 70'te çalıştırılabilir; düşük numaralı portlar bazı makinelerde yönetici izni gerektirebilir. Yönetici izni yoksa `python -m http.server 8000` ile 8000 portunu kullanabilirsiniz.

İyileştirme önerileri
- Logo ve marka renklerini netleştirip, gerçek bir harita arka planı (raster veya vektor) ekleyebilirim.
- Rezervasyon verilerini sunucuda depolamak isterseniz basit bir Express/Flask backend ekleyebilirim.

İsterseniz şimdi:
- Logo/renk güncellemesi yapayım,
- Haritaya gerçek bir harita görseli ekleyeyim,
- Veya rezervasyon verilerini sunucu tabanlı hale getirip oyuncuların görebileceği bir API ekleyeyim.
