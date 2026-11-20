import { useEffect } from "react";
import { api } from "../api/endpoints";
import { useResource } from "../hooks/useApi";
import { useApp } from "../app/store";
import { PageFrame } from "../components/ui";
import { MobileBar } from "../components/PageBits";
import { PageTitle, EmptyState } from "../components/ProductUI";

// "Sınav" menüsünün girişi: sınavlar derse bağlıdır. Tek ders varsa doğrudan onun sınav sayfası açılır,
// birden fazlaysa önce ders seçilir.
export default function ExamsHome() {
  const { navigate } = useApp();
  const courses = useResource((signal) => api.courses(signal), []);
  const list = courses.data || [];
  const only = list.length === 1 ? list[0].id : null;
  useEffect(() => {
    if (only) navigate(`/dersler/${only}/sinavlar`);
  }, [only, navigate]);
  return (
    <PageFrame>
      <MobileBar title="Sınav" />
      <PageTitle eyebrow="Geçmiş sınavdan yeni sınav" title="Sınavlar" tone="red">
        Geçmiş bir sınavı yükle; sorularının biçimi öğrenilir ve ders kaynaklarından benzer yeni bir sınav hazırlanır.
      </PageTitle>
      {courses.error && (
        <div className="product-error" role="alert">
          Dersler yüklenemedi.{" "}
          <button className="product-link" onClick={courses.reload}>Yeniden dene</button>
        </div>
      )}
      {courses.loading && <p role="status" className="product-note">Dersler yükleniyor…</p>}
      {!courses.loading && !courses.error && !list.length && (
        <EmptyState title="Henüz ders yok">Sınav hazırlamak için önce bir derse kayıtlı olmalısın.</EmptyState>
      )}
      {list.length > 1 && (
        <section aria-label="Sınav için ders seç" className="exam-course-list">
          <h2 className="section-title">Hangi ders için?</h2>
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className="exam-course" onClick={() => navigate(`/dersler/${c.id}/sinavlar`)}>
                  {!/^P-[0-9a-f]{8}-/.test(c.code || "") && <span className="source-badge">{c.code}</span>}
                  <strong>{c.name}</strong>
                  <span className="product-note">{c.term}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageFrame>
  );
}
