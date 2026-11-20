import { videoTime } from "../lib/video";
export default function VideoProgressPanel({
  progress,
  currentMs = 0,
  saving,
  error,
  onRetry,
  onResume,
}) {
  if (!progress)
    return (
      <p role="status" className="viewer-note">
        İzleme kaydı yükleniyor…{" "}
        {error && <button onClick={onRetry}>Kaydı yeniden yükle</button>}
      </p>
    );
  const p = progress,
    duration = p.duration_ms || 1;
  return (
    <section className="video-progress-panel" aria-label="Video ilerlemesi">
      <div className="section-heading">
        <h3>Video ilerlemesi</h3>
        <span role="status">
          {error
            ? "Kaydedilemedi"
            : saving
              ? "Kaydediliyor…"
              : "İlerleme kayıtlı"}
        </span>
      </div>
      <div className="video-progress-metrics">
        <div>
          <span>İzlenen bölüm</span>
          <strong>%{p.watched_percent}</strong>
          <small>{videoTime(p.watched_ms / 1000)} benzersiz süre</small>
        </div>
        <div>
          <span>Şu an / toplam</span>
          <strong>
            {videoTime(currentMs / 1000)} / {videoTime(p.duration_ms / 1000)}
          </strong>
          <small>Son kayıt: {videoTime(p.position_ms / 1000)}</small>
        </div>
      </div>
      <div
        className="watched-timeline"
        role="progressbar"
        aria-label="İzlenen video oranı"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.watched_percent}
      >
        {p.intervals.map((i) => (
          <span
            key={i.start_ms}
            className="watched-range"
            style={{
              left: `${(100 * i.start_ms) / duration}%`,
              width: `${(100 * (i.end_ms - i.start_ms)) / duration}%`,
            }}
          />
        ))}
        <span
          className="playback-marker"
          style={{ left: `${Math.min(100, (100 * currentMs) / duration)}%` }}
        />
      </div>
      <div className="timeline-labels">
        <span>00:00</span>
        <span>{videoTime(p.duration_ms / 1000)}</span>
      </div>
      <button className="resume-video" onClick={() => onResume(p.position_ms)}>
        ▷ Kaldığın yerden devam et · {videoTime(p.position_ms / 1000)}
      </button>
      <p className="viewer-note">
        Mavi aralıklar benzersiz oynatmayı gösterir. İleri sarma izleme
        sayılmaz; izleme, öğrenme başarısı değildir.
      </p>
      {error && (
        <p role="alert" className="product-error">
          {error} <button onClick={onRetry}>Tekrar kaydet</button>
        </p>
      )}
    </section>
  );
}
