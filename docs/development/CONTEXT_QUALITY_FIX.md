# Bağlam, video ilerlemesi ve quiz kalite düzeltmesi

Başlangıç: cfb4a81 / feature/video-integration. Kullanıcının 80b47abd eki.
Bu dosya aktif geliştirme kaydıdır; eski geçen testler yeni gereksinimlerin
tamamlandığı anlamına gelmez. Kullanıcı verileri ve çalışan viewer korunur.

## Kaynak kodunda doğrulanan kök nedenler

- DocumentCanvas yalnız kaynak segmenti geri çağırır. Boş/metinsiz sayfada
  source=null; görünür sayfa/slayt ve bölge için bağımsız sözleşme yoktur.
- Search yalnız dar bir deiktik ifade kümesinde active_source_id kullanır;
  diğer adaylarda zorunlu sözcük kesişimi vardır. Render edilmiş görüntü,
  metin-only OpenAICompatibleProvider isteğine girmez.
- Ders manifest'i gerçekten PDF/video/PPTX/TXT'yi kapsar, fakat30aday/6kanıt
  seçiminin yalnız ilk3'ü üretime girer; dışlananların raporu yoktur.
- onlyVideo şartı, herhangi bir nonvideo kanıtıyla izlenmemiş video
  yönlendirmesini bütünüyle atlar. Açık açıklama izni mesaj düzeyinde olmalı.
- Açıklama düğmeleri yalnız soru alanına metin koyar; response_mode yoktur.
- İlerleme sunucuda gerçek aralık birleşimidir. Ana ortak player'da görünür
  resume, zaman/benzersiz süre/timeline ve kayıt durumu eksiktir. İstemcide
  play/pause/seek/ağ olaylarının sınırları ayrıca regresyona alınmalı.
- Quiz yalnız ilk kanıttan hazırlanır. Kalitesiz model çıktısı literal MCQ'ya
  çevrilebilir. PublicQuiz kaynak metnini de döndürür; cevap anahtarı/quote ve
  doğrulama gerekçeleri sunumdan önce tamamen ayrılmalı.

## Sıra ve devam noktası

P0: tipli viewport + erişimi doğrulanmış scope/explicit references → video
yanıt politikası → progress/resume. P1: gerçek yerel görüntü girişi ve bölge,
yanıt modları, sıralama/debug raporu, reddeden quiz kalite kapısı. P2: kaynak
ve durum göstergeleri. Yeni büyük model/ücretliAPI yok; mevcut özel2B kullanılır.
Bu aşama kod/test/gerçek servis düzeyinde uygulandı; aşağıdaki PARTIAL/MISSING
sınırları korunur. Ayrıntılı son rapor: CONTEXT_QUALITY_TEST_REPORT.md.

## Uygulanan aşamalar — güncel çalışma kaydı

- P0 kodu uygulandı: bağımsız viewport, course/active/selected scope,
  yetkili açık kaynak referansları, önceki kayıtlı mesaj üzerinden yeniden
  biçimlendirme, mesaj başına açıklama izni ve video öncelikli yönlendirme.
- Gerçek Edge testleri: iki PDF / PDF+video / PDF+PPTX / üç materyal /
  tüm ders / tek materyal retrieval ve ders izolasyonu geçti. PDF sayfa4,
  gerçek fareyle bölge seçimi, çoklu checkbox ve hatalı istekten retry geçti.
- Ortak video player: gerçek play/pause, ileri/geri seek,2x hız, replay union,
  ağ hatası/retry, refresh/resume, gerçek transkript düğmesinden timestamp,
  video geçişi, ended ve dar ekran geçti. Sona seek %100 yapmadı (%0,6).
  Önceki kaynak videolarının SQL ilerleme kayıtları değişmedi.
- Görsel katman gerçek özgün PNG/kareyi mevcut özel Qwen3-VL2B'ye gönderir.
  OCR veya mock vision değildir. Grafik doğru çözülemedi; belirsizlik kapısı
  CLARIFICATION döndürdü. Vision doğruluğu PARTIAL, güvenilir algoritma
  hesaplayıcısı değildir. Büyük model indirilmedi.
- Açıklama modları gerçek ayrı sözleşme ve JSON şeması kullanır. Son gerçek
  tutarlı kaynak testinde kısa36 / adım225 / ayrıntı193 / örnek157 kelime;
  hepsi ayrı GENERATED_UNVERIFIED cevabı verdi. Bu pedagojik doğruluk kanıtı
  değildir. Önceki başarısız mod turları private test raporunda korunur.
- Quizde otomatik literal MCQ fallback kaldırıldı; kaynak alıntısı, tek cevap,
  seçenek örtüşmesi, kaynak seçimi ve kör ikinci üretim kontrolü var. İlk
  gerçek sorularda kısmen doğru seçeneklerin belirsizliği görüldü: seçenek
  başına bağımsız gerekçe/işaretleme içeren v2 audit eklendi. Eski sorular
  silinmez, LEGACY_NOT_REVIEWED olarak sunulur. Son v2 turda ilk aday reddedildi,
  ikinci gerçek MCQ kabul edildi; gerçek Edge feedback/source/kalıcılık geçti.
- Tam regresyon: frontend92, Nest unit94, API121, Python447 ve gerçek
  Python/MySQL1 =755 geçti. Son değişikliklerden sonra ilgili23API/15frontend/
  45Python ayrıca geçti (tekrar toplama eklenmez).
- Gerçek player396800–405800ms span'ını kapsadı; watched-only adaylığı doğru,
  fakat video MCQ kalitesi reddedildi. O aralıktaki frame400433ms gerçek
  modele ulaştı, CLARIFICATION. Vision ve video-quiz semantiği PARTIAL.
- Son canlı context testi: PDF4/PPTX3/seçili metin/eksik viewport PASS;
  izlenmemiş video önce GUIDANCE, Şimdi açıkla GENERATED_UNVERIFIED, yeni
  konu tekrar GUIDANCE. PDF-first yardımcı kaynak sırası ayrıca API testinde.

Sonraki aşama: küçük model vision doğruluğu ve farklı alanlarda quiz eval;
gerçek background desktop testi, offline outbox, PDF text layer. Bu çalışma
yerel feature branch'te tutulur; push yapılmaz. Başka uygulamaya müdahale yok.

## İlk gerçek görsel test — kalite hatası yakalandı

Bildirilen Graphs Part - 2 (1), sayfa4 gerçekten bulundu ve kendi test
hesabının yetkili kaynağı olduğu doğrulandı. Özgün alt bölge mevcut Qwen3-VL2B
Instruct'a gönderildi (1206x395 gerçek pixel girişi). Model ilk turda yanlış
BFS sırası verdi ve DFS'i atladı. Bu sonuç başarılı sayılmadı. Görsel yeniden
kurulum ve ikinci model denetimi kapısı eklendi; kesin algoritma cevabı
uydurulmadı. Son gerçek test CLARIFICATION. Küçük model doğruluğu PARTIAL.
İlk API16/17 turundaki nonvideo istisnası düzeltildi; son API121/121 ve
ilgili23/23 geçti. İlk başarısız denemeler başarı sayısına eklenmedi.
