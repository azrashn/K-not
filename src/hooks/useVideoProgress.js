import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/endpoints";
import { videoErrorText } from "../lib/video";
import { createWatchTracker, mergeObserved } from "../lib/watch-tracker";
import * as auth from "../api/session";
import { isTransient, outbox } from "../lib/progress-outbox";
import { drainProgressOutbox } from "../lib/outbox-sync";

export function useVideoProgress(courseId, videoId, ready, player) {
  const [state, setState] = useState({
    progress: null,
    error: "",
    saving: false,
    pending: false,
  });
  const session = useRef(null);
  useEffect(() => {
    if (!ready || !videoId) {
      session.current = null;
      setState({ progress: null, error: "", saving: false });
      return;
    }
    const current = {
      tracker: createWatchTracker(),
      pending: [],
      dirty: false,
      position: 0,
      progress: null,
      active: true,
      sending: false,
      failed: false,
      touched: false,
    };
    session.current = current;
    setState({ progress: null, error: "", saving: false });
    const load = new AbortController();
    function update(patch) {
      if (current.active) setState((old) => ({ ...old, ...patch }));
    }
    function sample(forcePosition = false, closing = false) {
      const video = player.current;
      if (!video || !current.progress) return;
      const next = Math.min(
        current.progress.duration_ms,
        Math.max(0, Math.round(video.currentTime * 1000)),
      );
      current.touched ||= forcePosition || (!video.paused && !video.seeking);
      if (current.touched && next !== current.position) {
        current.position = next;
        current.dirty = true;
        update({ pending: true });
      }
      current.tracker.sample({
        seconds: video.currentTime,
        wallMs: performance.now(),
        rate: video.playbackRate,
        playing: !video.paused && !video.ended,
        seeking: video.seeking,
        visible: !document.hidden,
        closing,
      });
    }
    async function flush(keepalive = false) {
      current.pending = mergeObserved([
        ...current.pending,
        ...current.tracker.drain(),
      ])
        .map((i) => ({
          start_ms: i.start_ms,
          end_ms: Math.min(i.end_ms, current.progress?.duration_ms ?? i.end_ms),
        }))
        .filter((i) => i.end_ms > i.start_ms);
      if (
        current.sending ||
        !current.progress ||
        (!current.dirty && !current.pending.length)
      )
        return;
      // Long uninterrupted intervals are split into bounded API observations.
      const batch = [];
      const remaining = [];
      for (const range of current.pending) {
        for (
          let start = range.start_ms;
          start < range.end_ms;
          start += 120000
        ) {
          const item = {
            start_ms: start,
            end_ms: Math.min(start + 120000, range.end_ms),
          };
          if (batch.length < 60) batch.push(item);
          else remaining.push(item);
        }
      }
      current.pending = remaining;
      const position = current.position;
      current.dirty = false;
      current.sending = true;
      update({ saving: true });
      try {
        const request = api.saveVideoProgress(
          courseId,
          videoId,
          { position_ms: position, intervals: batch },
          keepalive ? undefined : AbortSignal.timeout(15000),
          keepalive,
        );
        current.flight = request;
        const result = await request;
        current.progress = result;
        current.failed = false;
        update({ progress: result, error: "" });
      } catch (error) {
        // No connection or server trouble: keep the observations on this device so they survive a
        // closed tab, and send them when the network is back. Anything else stays in memory as before.
        const userId = auth.get()?.user?.id;
        const stored =
          isTransient(error) && userId
            ? await outbox.enqueue({ userId, courseId, videoId, position_ms: position, intervals: batch })
            : false;
        if (stored) {
          current.queued = true;
          current.failed = true;
          update({
            error:
              "Bağlantı yok: izleme kaydı bu cihazda saklandı, bağlantı gelince gönderilecek.",
          });
        } else {
          current.pending = mergeObserved([...batch, ...current.pending]);
          current.dirty = true;
          current.failed = true;
          update({ error: videoErrorText(error) });
        }
      } finally {
        current.sending = false;
        current.flight = null;
        update({
          saving: false,
          pending: current.dirty || current.pending.length > 0,
        });
        // Flush the final event if unmounted during an in-flight write. Avoid a
        // retry loop on failure; the visible tab retries on its next tick.
        if (
          !current.active &&
          !current.failed &&
          (current.dirty || current.pending.length)
        )
          void flush(true);
      }
    }
    current.sample = sample;
    current.flush = flush;
    // Send what an earlier offline session left behind. For the open video the position that the
    // server already holds is kept, so an old queued position never moves the resume point back.
    async function drainOutbox() {
      if (current.draining || !auth.get()?.user?.id) return;
      current.draining = true;
      try {
        const result = await drainProgressOutbox({
          positionFor: (c, v) => (c === courseId && v === videoId && current.progress ? current.progress.position_ms : null),
        });
        if (!result) return;
        current.queued = result.waiting > 0;
        if (result.sent && current.active) {
          await loadProgress();
          if (!current.queued) update({ error: "" });
        }
      } finally {
        current.draining = false;
      }
    }
    current.drain = drainOutbox;
    function loadProgress() {
      return api
        .videoProgress(courseId, videoId, load.signal)
        .then((progress) => {
          if (!current.active) return;
          current.progress = progress;
          current.position = progress.position_ms;
          update({ progress, error: "" });
        })
        .catch((error) => {
          if (error.name !== "AbortError")
            update({ error: videoErrorText(error) });
        });
    }
    current.retry = () => (current.progress ? flush() : loadProgress());
    void loadProgress().then(() => drainOutbox());
    const timer = setInterval(() => {
      sample();
      void flush();
      if (current.queued) void drainOutbox();
    }, 5000);
    const online = () => void drainOutbox();
    window.addEventListener("online", online);
    const leaving = () => {
      sample();
      current.tracker.reset();
      void flush(true);
    };
    const hidden = () => {
      if (document.hidden) leaving();
      else current.tracker.reset();
    };
    window.addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      // Sample while the selected media still belongs to this effect.
      // timeupdate/pause already captured its last position; do not read a new player.
      current.active = false;
      load.abort();
      clearInterval(timer);
      window.removeEventListener("pagehide", leaving);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("online", online);
      current.tracker.reset();
      void flush(true);
      if (session.current === current) session.current = null;
    };
  }, [courseId, videoId, ready, player]);
  const observe = useCallback(() => session.current?.sample(), []);
  const reset = useCallback(() => session.current?.tracker.reset(), []);
  const flush = useCallback(() => {
    session.current?.sample(false, true);
    return session.current?.flush();
  }, []);
  const seeked = useCallback(() => {
    session.current?.tracker.reset();
    session.current?.sample(true);
    void session.current?.flush();
  }, []);
  const retry = useCallback(() => session.current?.retry(), []);
  const flushForQuestion = useCallback(async () => {
    const current = session.current;
    if (!current?.progress) return false;
    current.sample();
    if (current.flight) await current.flight.catch(() => {});
    if (!current.active) return false;
    // Establish an explicit empty observation when a never-played video is
    // queried. A missing/unreadable progress record remains UNKNOWN server-side.
    if (current.progress.revision === 0) current.dirty = true;
    await current.flush();
    return !current.failed;
  }, []);
  return { ...state, observe, reset, flush, seeked, retry, flushForQuestion };
}
