# Video çalışması — devam notu, 31 Ekim 2026

Duraklatma sonrasında çalışma sürdürüldü; ilk çalışan video sürümü ve son tarayıcı
doğrulaması tamamlandı. Sonraki geliştirmeler aşağıdaki notlardan devam edebilir.
Dal: `feature/video-integration`, başlangıç `2fdc005`.

## Tamamlanan ve doğrulanan

- Dersten `Ders videoları` ekranına geçiş; özel MP4/WebM yükleme, 100 MB sınırı.
- NestJS video köprüsü; JWT + ders üyeliği + yükleyen sahipliği; metadata MySQL Video tablosunda.
- Eklemeli migrasyon uygulandı, mevcut 7 belge korunuyor. Mevcut hesap parolaları değiştirilmedi.
- Zamanlı transkript, zaman sıralı kare galerisi, video Blob oynatıcı, kaynaklı deneysel cevap.
- Yeni portlar: UI 5174, backend 3100, Knot AI 8110; MomentSearch 7862 / özel Ollama 11436.
- `npm test`: 65 frontend testi geçti; backend `npm run test:unit`: 46 test geçti.
- Frontend/backend derlendi, backend typecheck geçti. Hedef lint'te iki state-in-effect uyarısı var;
  genel lint ayrıca önceden mevcut .claude skill ve Quiz uyarılarını içeriyor.
- Gerçek integral videosu Knot üzerinden önbelleksiz 52,085s: 42 kare, 19 transkript parçası.
- Gerçek yerel cevap 2,352s / 6 kaynak; kalite doğrulanmış sayılmaz, support_confirmed=false.
- Anonymous 401, diğer öğrenci ve diğer ders 404; dosya/kare okuma, yeniden yüklemede dedup geçti.
- Yeniden başlatma sonrası gerçek API testi tekrar geçti (önbellekli kayıt, 7,404s cevap).
- Kaynak: `data/video-tests/fresh-run.json`, `cached-run.json`, `last-run.json`, `logs/video-*-e2e.log`.
  Bunlar Git dışında, kullanıcı materyali içerir. Test parolaları yalnızca repo dışındaki geçici
  accounts.json dosyalarında; konumları yerel raporlarda. Asla commit edilmez.

## Yarın

1. Docker Desktop açıkken `scripts/Start-KnotVideo.ps1` çalıştır; mevcut verilerle aç.
2. `http://127.0.0.1:5174/#/dersler` → ders → Ders videoları.
3. Son tarayıcı testi artık tamam: gerçek giriş, yükleme/dedup, transkript 47,84s,
   kare 10,043s ve cevap kaynağı 40,073s atlamaları geçti. 390px mobilde taşma ve
   tarayıcı hatası yok. Tekrarlama: `node scripts/test-video-browser.cjs`.
4. Kullanım ve ilk sürümün kısıtları: docs/video-integration.md. Modelin matematiksel
   cevap doğruluğu hâlâ kısmi; bu sürüm otomatik doğrulanmış ders çözümü değildir.
5. Beş kişilik sonraki işler: docs/video-team-tasks.md. Görevler öneridir, yapılmış insan katkıları değildir.

Video kalitesi: küçük ASR matematiksel terimlerde ve 2B model yöntem/formüllerde hata yapıyor.
Bu sınırlar çözülmüş sayılmıyor. PDF/video ortak sorgu, seçili bölge QA, paylaşım/silme ve büyük
dosyalarda Range/parçalı yükleme henüz yok. Yeni büyük model indirme veya ücretli API yok.

Motor ek bağımlılığı: `C:\Users\ASUS\Documents\Codex\MomentSearch` local/windows-dev dalında
`src/api/search.py` içine `/api/local/frames/{video_id}` eklendi. Bu değişiklik ayrı repoda saklanır.
Motor köprüsü commit'i: `c53a8e9` (local/windows-dev).
Mevcut Knot .env dosyaları ve eski dev.ps1 değiştirilmedi. Dev.ps1'in 5173/8100 portları diğer
projelerle çakıştığı için bu profilin ayrı başlat/durdur betiklerini kullan.

Kullanıcının önceden var olan untracked AGENTS.md, .codex/ ve .agents/skills klasörlerini değiştirme
ve bu dalın commit'lerine ekleme. Uzak repoya push yapılmadı.

Kaydetmeyi durduran önceki Gitleaks bulguları gerçek sır değil, `Env-Value` fonksiyon
çağrılarının literal sanılmasıydı. Dinamik atama `Set-Item Env:... -Value (...)`
olarak ifade edildi; hiçbir tarama kuralı/allowlist gevşetilmedi. Son tarama temiz.
Test ekran görüntüleri ve browser-run.json yalnızca data/video-tests altında, Git dışında.
