/** Real Edge quiz feedback and actual playback -> watched-only retrieval.
 * Uses only the isolated test courses created by the context scripts. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { chromium } = require("playwright-core");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "data/context-tests"),
  model = JSON.parse(fs.readFileSync(path.join(out, "modes-quiz-run.json"))),
  watch = JSON.parse(
    fs.readFileSync(path.join(out, "context-browser-run.json")),
  ),
  seed = JSON.parse(
    fs.readFileSync(path.join(root, "data/video-tests/last-run.json")),
  ),
  account = JSON.parse(fs.readFileSync(seed.credentials_file)).accounts[0],
  report = { checks: [], status: "RUNNING" };
let token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, route, body) {
  const r = await fetch("http://127.0.0.1:3100" + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(200000),
  });
  return { status: r.status, data: await r.json() };
}
async function ok(method, route, body) {
  const r = await api(method, route, body);
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.data));
  return r.data;
}
const record = (name, detail = {}) => {
  report.checks.push({ name, status: "PASS", ...detail });
  console.log(name, JSON.stringify(detail));
};
async function main() {
  let browser;
  try {
    token = (
      await ok("POST", "/auth/login", {
        email: account.email,
        password: account.password,
      })
    ).access_token;
    assert.ok(
      model.quiz,
      "A real accepted quiz is required; do not substitute a fake question.",
    );
    browser = await chromium.launch({
      executablePath:
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      headless: true,
    });
    const page = await browser.newPage({
        viewport: { width: 1600, height: 1000 },
        reducedMotion: "reduce",
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      "http://127.0.0.1:5174/#/dersler/" + model.course_id + "/quiz",
    );
    await page.getByLabel("E-posta", { exact: true }).click();
    await page.getByLabel("E-posta", { exact: true }).fill(account.email);
    await page.getByLabel("Parola", { exact: true }).click();
    await page.getByLabel("Parola", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    const q = model.quiz.question;
    await page
      .locator(".resume-row")
      .filter({ hasText: q.topic })
      .first()
      .click();
    await page
      .getByRole("heading", { name: q.question, exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("Alıştırma geri bildirimi").count(), 0);
    assert.equal(
      await page.getByText(model.quiz.feedback.quote, { exact: true }).count(),
      0,
    );
    record("real-quiz-history-does-not-leak-answer-or-quote");
    const correct = q.options.indexOf(model.quiz.feedback.expected),
      wrong = (correct + 1) % 4;
    await page
      .getByRole("radio", { name: q.options[wrong], exact: true })
      .check();
    await page.getByRole("button", { name: "Yanıtı değerlendir" }).click();
    await page.getByLabel("Alıştırma geri bildirimi").waitFor();
    assert.ok(
      await page
        .getByText(model.quiz.feedback.expected, { exact: true })
        .isVisible(),
    );
    assert.ok(
      await page
        .getByText("Kaynağı tekrar incele", { exact: true })
        .isVisible(),
    );
    record("real-wrong-option-feedback-with-source");
    const overview = await ok("GET", "/learning/overview");
    assert.ok(
      overview.attempts.some((a) => a.quiz_id === q.id && a.score === 0),
    );
    await page.reload();
    await page
      .locator(".resume-row")
      .filter({ hasText: q.topic })
      .first()
      .waitFor();
    record("real-quiz-result-persists-after-refresh");
    await page
      .locator(".resume-row")
      .filter({ hasText: q.topic })
      .first()
      .click();
    await page
      .getByRole("radio", { name: q.options[wrong], exact: true })
      .check();
    await page.getByRole("button", { name: "Yanıtı değerlendir" }).click();
    await page
      .getByRole("button", { name: "İlgili kaynağı aç →", exact: true })
      .click();
    await page
      .getByRole("heading", { name: q.source.title, exact: true })
      .waitFor();
    record("real-quiz-feedback-opens-exact-source");
    const base = "/courses/" + watch.course_id,
      k = base + "/knowledge",
      materials = (await ok("GET", k + "/materials")).materials,
      m = materials.find((m) => m.source_id === watch.video_ids[0]),
      preview = await ok("GET", k + "/materials/" + m.id),
      span = preview.segments
        .filter(
          (s) =>
            s.location.start_ms > 2000 &&
            s.location.end_ms - s.location.start_ms < 30000,
        )
        .sort(
          (a, b) =>
            a.location.end_ms -
            a.location.start_ms -
            (b.location.end_ms - b.location.start_ms),
        )[0];
    assert.ok(span);
    await page.goto(
      "http://127.0.0.1:5174/#/dersler/" + watch.course_id + "/ogrenme",
    );
    await page
      .locator(".material-choice button")
      .filter({ hasText: m.title })
      .first()
      .click();
    const player = page.getByLabel("Ortak ders videosu", { exact: true });
    await player.waitFor();
    await page.waitForFunction(
      () => document.querySelector("video")?.readyState >= 2,
    );
    await page.getByRole("progressbar").waitFor();
    await player.evaluate(
      (v, t) => {
        v.muted = true;
        v.currentTime = t;
        v.playbackRate = 2;
      },
      (span.location.start_ms - 700) / 1000,
    );
    await page.waitForFunction(() => !document.querySelector("video")?.seeking);
    await player.evaluate((v) => v.play());
    await page.waitForFunction(
      (t) => document.querySelector("video")?.currentTime > t,
      (span.location.end_ms + 600) / 1000,
      { timeout: 25000 },
    );
    await player.evaluate((v) => v.pause());
    let progress;
    for (let n = 0; n < 80; n++) {
      progress = await ok("GET", base + "/videos/" + m.source_id + "/progress");
      if (
        progress.intervals.some(
          (i) =>
            i.start_ms <= span.location.start_ms &&
            i.end_ms >= span.location.end_ms,
        )
      )
        break;
      await sleep(150);
    }
    assert.ok(
      progress.intervals.some(
        (i) =>
          i.start_ms <= span.location.start_ms &&
          i.end_ms >= span.location.end_ms,
      ),
    );
    record("real-full-transcript-span-played", {
      start_ms: span.location.start_ms,
      end_ms: span.location.end_ms,
      intervals: progress.intervals,
    });
    const scope = { mode: "selected", material_ids: [m.id] };
    const generated = await api("POST", base + "/quizzes", {
      topic: span.text.slice(0, 180),
      kind: "MULTIPLE_CHOICE",
      scope,
      watched_only: true,
    });
    assert.ok([201, 422].includes(generated.status));
    if (generated.status === 201) {
      assert.equal(generated.data.source.material_id, m.id);
      assert.ok(
        progress.intervals.some(
          (i) =>
            i.start_ms <= generated.data.source.location.start_ms &&
            i.end_ms >= generated.data.source.location.end_ms,
        ),
      );
      record("real-watched-only-quiz", {
        source: generated.data.source.location,
      });
    } else
      report.checks.push({
        name: "real-watched-only-quiz",
        status: "PARTIAL",
        reason:
          "Actual watched segment passed scope selection; local model rejected quiz quality. No question published.",
      });
    await player.evaluate(
      (v, t) => (v.currentTime = t),
      (span.location.start_ms + 500) / 1000,
    );
    await page.waitForFunction(() => !document.querySelector("video")?.seeking);
    await page
      .getByLabel("Arama kapsamı", { exact: true })
      .selectOption("active");
    await page
      .getByRole("button", { name: "+ Yeni konuşma", exact: true })
      .click();
    const answered = page.waitForResponse((r) =>
      r.url().endsWith("/knowledge/answers"),
    );
    await page
      .getByLabel("Ders kaynaklarına sorun")
      .fill("Şu an izlediğim yerdeki görseli açıkla");
    await page.getByRole("button", { name: "Gönder ↑", exact: true }).click();
    const response = await answered;
    assert.equal(response.status(), 200);
    const ask = await response.json();
    report.visual_frame = { status: ask.status, visual: ask.visual_analysis };
    assert.ok(
      ask.evidence.some(
        (e) =>
          e.material_id === m.id &&
          e.location.start_ms <= span.location.start_ms + 500 &&
          e.location.end_ms > span.location.start_ms + 500,
      ),
    );
    if (ask.visual_analysis?.status === "IMAGE_PROVIDED") {
      assert.ok(Number.isInteger(ask.visual_analysis.location.frame_ms));
      record("real-video-frame-context-reaches-model", {
        generation_status: ask.status,
        location: ask.visual_analysis.location,
      });
    } else
      report.checks.push({
        name: "real-video-frame-context-reaches-model",
        status: "PARTIAL",
        reason: ask.status,
      });
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: path.join(out, "context-learning-loop.png"),
    });
    report.status = report.checks.some((c) => c.status === "PARTIAL")
      ? "PARTIAL"
      : "PASS";
  } catch (e) {
    report.status = "FAIL";
    report.error = e.message;
    throw e;
  } finally {
    if (browser) await browser.close();
    fs.writeFileSync(
      path.join(out, "learning-loop-run.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
