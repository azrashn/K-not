# Önceki Docker Desktop açılış engeli — tarihsel kayıt

**Güncel kontrol: ENGEL KALKTI.** Kullanıcı Docker Desktop'ı açtıktan sonra
Docker29.7.2 yanıt verdi. Start-KnotVideo.ps1 tamamlandı;5174/3100/8110 HTTP200.
Edge giriş ve beş ekran kontrolü, SQL sohbet/quiz ve kaynaklı takip testi PASS.
Kullanıcı verileri veya volume'lar sıfırlanmadı. Aşağıdaki bulgular önceki
açılış hatasının tarihsel kaydıdır.

31 Ekim 2026, son kullanıcı devam mesajından sonraki kontrol.
K-NOT ürün kodu `91e29c8` + `fdbbbe7` commit'lerinde, feature/video-integration
dalında kaydedildi. Önceki gerçek test ve restart kanıtları geçerlidir; bu dosya
daha sonraki mevcut çalışma durumunu ayırır.

## Gözlenen durum

- K-NOT5174/3100/8110 adresleri ECONNREFUSED döndürüyor.
- DockerCLI, `dockerDesktopLinuxEngine` named pipe'ını bulamıyor.
- DockerDesktop başlatma isteği gönderildi; GUI/backend süreçleri görünse de
  motor sağlıklı başlamadı. `wsl --list --verbose`: docker-desktop Stopped, v2.
- `%LOCALAPPDATA%/Docker/log/host/com.docker.backend.exe.log`:
  `starting services: initializing Ingest server ... sailor-ingest.sock ...
  rename ... sailor-ingest.sock.stale: Sistem dosyaya erişemiyor.`
- ErrorReporter, DockerDesktop'un kapanması gerektiğini belirten açılış hatası
  döndürüyor. Bu, K-NOT'un uygulama exception'ı veya geçersiz veritabanı
  migrasyonu olarak tespit edilmedi.

Docker'ın resmi depolarında aynı sınıf için açık raporlar var:
[desktop-feedback666](https://github.com/docker/desktop-feedback/issues/666),
[for-win15064](https://github.com/docker/for-win/issues/15064).
Bu raporlar yerel günlükle uyumludur; bu makinede doğrulanmış bir onarım
gerçekleştirildiği veya belirli bir güncellemenin kesin çözeceği iddia edilmez.

## Verileri koruma ve devam noktası

Docker çalışma dosyaları, ayarları, container/volume'lar ve sanal diskler
silinmedi veya taşınmadı. Fabrika ayarlarına sıfırlama/clean-up uygulanmadı;
otomatik uygulama güncellemesi başlatılmadı. Diğer projelerin kaynaklarına
dokunulmadı. Önceki Up7saat snapshot'ı, bu son açılış hatasından önceydi;
servisler hâlâ açıkmış gibi raporlanmamalı.

[Docker'ın sorun giderme belgesi](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/)
restart ile veri temizleme/sıfırlamayı ayrı işlemler olarak listeler.
Ortak Docker ortamında onarım, diğer projeleri koruma kapsamı göz önünde
bulundurularak ayrıca ele alınmalı. Tanılama raporu dışarı yüklenmedi.

Motor yeniden sağlıklı olduğunda K-NOT kökünde:

```powershell
docker info
.\scripts\Start-KnotVideo.ps1
node scripts/verify-product-restart.cjs
```

Sonrasında http://127.0.0.1:5174/ ve /health uçları doğrulanmalı.
İlk inceleme noktası bu dosya; özellik/kanıt ayrıntıları PRODUCT_TEST_REPORT.md.
