CaYa Gösterim Paneli

Kısa açıklama

- Bu proje, sunucuya ses dosyası yüklemeden çalışan bir web ses panelidir.
- Sesler tarayıcıda IndexedDB içinde saklanır. Sunucu sadece statik dosya sunar ve erişimi kolaylaştırmak için bir çerez (cookie) ayarlar.
- HTML dosyasını indirip yerel olarak açarsanız (file://), sayfa çalışmaz çünkü fonksiyonellik sunucu tarafından set edilen çerez ile etkinleştirilir.

Özellikler

- "Ekle" butonu: Bir sesi diğer çalan sesleri durdurmadan başlatır (aynı anda birden fazla "ekli" ses çalabilir). Buton tekrar tıklanınca o sesi durdurur.
- Adı gösteren buton: Bu butona tıklanınca sadece o ses çalınır ve varsa diğer çalınan (ekli veya özel) sesler durdurulur. Aynı butona tekrar tıklanırsa durur.
- Sesler listelenir, silinebilir ve çalma sırasına eklenebilir. Çalma sırası localStorage'da saklanır.

Nasıl çalıştırılır (Windows, PowerShell)

1) Bağımlılıkları yükleyin:

```powershell
cd 'C:\Users\cagan\Desktop\CaYaSoundPanelWeb'
npm install
```

2) Sunucuyu başlatın:

```powershell
npm start
```

Sunucu varsayılan olarak http://localhost:3000 adresinde çalışır.

3) Tarayıcıda http://localhost:3000 adresini açın. İlk erişimde sunucu bir çerez (_caya_session) atar; bu çerez sayfanın ses yükleme/çalma özelliklerini etkinleştirir.

Test ve doğrulama

- Tarayıcı geliştirici araçlarından Application -> Cookies bölümünde `_caya_session` çerezini görebilirsiniz.
- `Ekle` butonuna tıklayarak bir sesi diğerleri ile birlikte çalabilirsiniz.
- Adı (dosya adı) gösteren mavi butona tıklayarak o sesi tekil olarak çalabilirsiniz; bu işlem diğerlerini durdurur.

Gizlilik ve güvenlik

- Ses dosyaları sunucuya gönderilmez; tüm veriler kullanıcı tarayıcısında saklanır.
- Sunucu sadece statik dosya sunar ve küçük bir açık çerez atar; bu çerez kritik bir güvenlik bilgisi içermez.

Geliştirme notları

- Kod ana dosyalar: `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`.
- Daha fazla özellik (zamanlama/düğmeler, sessız mod, sabit sıra senkronizasyonu) eklenebilir.
