/** Real Edge/native media, API, renderer and MySQL. Adds isolated own fixtures.
 * Does not synthesize playback events or modify original videos/progress. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "data/context-tests");
const seed = JSON.parse(
    fs.readFileSync(path.join(root, "data/video-tests/last-run.json")),
  ),
  accounts = JSON.parse(fs.readFileSync(seed.credentials_file)).accounts;
process.loadEnvFile(path.join(root, "backend/.env"));
const { PrismaService } = require("../backend/dist/prisma/prisma.service"),
  { loadConfig } = require("../backend/dist/config/config"),
  { newId } = require("../backend/dist/common/ids");
const report = { checks: [], status: "RUNNING" };
let token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function record(name, detail = {}) {
  report.checks.push({ name, status: "PASS", ...detail });
  console.log(name, JSON.stringify(detail));
}
async function api(method, route, body) {
  for (let n = 0; n < 6; n++) {
    const r = await fetch("http://127.0.0.1:3100" + route, {
        method,
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body && !(body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
        signal: AbortSignal.timeout(200000),
      }),
      data = await r.json();
    if (r.status === 429) {
      await sleep(12000);
      continue;
    }
    return { status: r.status, data };
  }
  throw Error("Rate limit remained active");
}
async function ok(method, route, body) {
  const r = await api(method, route, body);
  assert.ok(
    r.status >= 200 && r.status < 300,
    route + ": " + r.status + " " + JSON.stringify(r.data),
  );
  return r.data;
}
async function until(fn, accept, label) {
  for (let n = 0; n < 100; n++) {
    const x = await fn();
    if (accept(x)) return x;
    await sleep(200);
  }
  throw Error(label);
}
async function main() {
  let browser, prisma;
  try {
    fs.mkdirSync(out, { recursive: true });
    prisma = new PrismaService(loadConfig());
    token = (
      await ok("POST", "/auth/login", {
        email: accounts[0].email,
        password: accounts[0].password,
      })
    ).access_token;
    const originals = await prisma.video.findMany({
        where: { ownerId: accounts[0].id },
        orderBy: { createdAt: "asc" },
      }),
      integral = originals.find((v) => /integral/i.test(v.originalFilename)),
      other = originals.find(
        (v) => v.engineVideoId !== integral?.engineVideoId,
      );
    assert.ok(integral && other);
    const ids = [integral.id, other.id],
      before = await prisma.videoProgress.findMany({
        where: { videoId: { in: ids } },
      });
    const prior = fs.existsSync(path.join(out, "context-browser-run.json"))
      ? JSON.parse(fs.readFileSync(path.join(out, "context-browser-run.json")))
      : null;
    const course =
      (prior?.course_id &&
        !prior.checks.some((c) => c.name === "real-play-pause") &&
        (await prisma.course.findFirst({
          where: {
            id: prior.course_id,
            code: { startsWith: "CTX-" },
            memberships: { some: { userId: accounts[0].id } },
          },
        }))) ||
      (await prisma.course.create({
        data: {
          code: "CTX-" + Date.now().toString(36),
          name: "Demo • Bağlam ve gerçek ilerleme testi",
          term: "2026-test",
          memberships: { create: { userId: accounts[0].id, role: "STUDENT" } },
        },
      }));
    report.course_id = course.id;
    const videos = [];
    for (const v of [integral, other])
      videos.push(
        (await prisma.video.findFirst({
          where: {
            courseId: course.id,
            ownerId: v.ownerId,
            engineVideoId: v.engineVideoId,
          },
        })) ||
          (await prisma.video.create({
            data: {
              id: newId(),
              ownerId: v.ownerId,
              courseId: course.id,
              title: v.title,
              originalFilename: v.originalFilename,
              contentSha256: v.contentSha256,
              engineVideoId: v.engineVideoId,
              durationMs: v.durationMs,
            },
          })),
      );
    report.video_ids = videos.map((v) => v.id);
    const base = "/courses/" + course.id,
      k = base + "/knowledge",
      fixtureDir = path.join(root, "data/product-tests/fixtures");
    for (const [filename, file, route] of [
      [
        "context-a.pdf",
        path.join(fixtureDir, "integral-10-pages.pdf"),
        "documents",
      ],
      ["context-b.pdf", path.join(out, "companion.pdf"), "documents"],
      [
        "context.pptx",
        path.join(fixtureDir, "integral-5-slides.pptx"),
        "knowledge/materials",
      ],
    ]) {
      if (
        (await ok("GET", k + "/materials")).materials.some(
          (m) =>
            m.title === filename || m.title === filename.replace(".pdf", ""),
        )
      )
        continue;
      const f = new FormData();
      f.set("file", new Blob([fs.readFileSync(file)]), filename);
      if (route === "documents") f.set("document_type", "notes");
      await ok("POST", base + "/" + route, f);
    }
    const materials = await until(
      async () => (await ok("GET", k + "/materials")).materials,
      (m) => m.length === 5 && m.every((x) => x.status === "READY"),
      "Own materials not ready",
    );
    const pdfs = materials.filter((m) => m.kind === "PDF"),
      ppt = materials.find((m) => m.kind === "PPTX"),
      vm = materials.find(
        (m) => m.kind === "VIDEO" && m.source_id === videos[0].id,
      ),
      vm2 = materials.find(
        (m) => m.kind === "VIDEO" && m.source_id === videos[1].id,
      );
    const question = "İntegralde değişken değiştirme yöntemi nasıl uygulanır?";
    for (const [name, chosen] of [
      ["two-pdfs", pdfs],
      ["pdf-pptx", [pdfs[0], ppt]],
      ["pdf-video", [pdfs[0], vm]],
      ["three-materials", [pdfs[0], ppt, vm]],
      ["all-course", null],
      ["active-only", [pdfs[0]]],
    ]) {
      const scope = !chosen
        ? { mode: "course" }
        : name === "active-only"
          ? { mode: "active" }
          : { mode: "selected", material_ids: chosen.map((m) => m.id) };
      const r = await ok("POST", k + "/answers", {
          question,
          scope,
          active_material_id: pdfs[0].id,
          viewport: { kind: "page", page: 2 },
        }),
        allowed = (chosen || materials).map((m) => m.id);
      assert.deepEqual(
        r.retrieval.searched.map((m) => m.id).sort(),
        allowed.sort(),
      );
      assert.ok(r.evidence.length);
      assert.ok(r.evidence.every((e) => allowed.includes(e.material_id)));
      const found = new Set(r.evidence.map((e) => e.material_id));
      assert.ok(
        (chosen || [pdfs[0], ppt, vm]).every((m) => found.has(m.id)),
        "Relevant chosen material missing: " + name,
      );
      record("real-retrieval-" + name, {
        kinds: [...new Set(r.evidence.map((e) => e.kind))],
        sources: r.evidence.length,
        generation_status: r.status,
      });
    }
    const foreign = JSON.parse(
      fs.readFileSync(path.join(root, "data/product-tests/product-run.json")),
    ).materials[0];
    assert.equal(
      (
        await api("POST", k + "/answers", {
          question,
          scope: { mode: "selected", material_ids: [foreign.id] },
        })
      ).status,
      404,
    );
    record("real-cross-course-scope-isolation");
    browser = await chromium.launch({
      executablePath:
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      headless: true,
    });
    const page = await browser.newPage({
        viewport: { width: 1600, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      "http://127.0.0.1:5174/#/dersler/" + course.id + "/ogrenme",
    );
    await page.getByLabel("E-posta", { exact: true }).fill(accounts[0].email);
    await page.getByLabel("Parola", { exact: true }).fill(accounts[0].password);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    const choose = async (m) => {
      await page
        .locator(".material-choice button")
        .filter({ hasText: m.title })
        .first()
        .click();
      await page.getByRole("heading", { name: m.title, exact: true }).waitFor();
    };
    await choose(pdfs[0]);
    await page.getByRole("spinbutton", { name: "Sayfa numarası" }).fill("4");
    const image = page.getByRole("img", { name: pdfs[0].title + " · Sayfa 4" });
    await image.waitFor();
    await image.evaluate((i) => i.decode());
    await page.getByRole("button", { name: "Bölge seç", exact: true }).click();
    const box = await image.boundingBox();
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, {
      steps: 8,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: "Bölgeyi temizle" }).waitFor();
    for (const m of pdfs)
      await page
        .getByRole("checkbox", {
          name: m.title + " kaynağını seç",
          exact: true,
        })
        .check();
    // Abort one actual request to exercise recovery; the retry goes to real services.
    await page.route("**/knowledge/answers", async (route) => {
      await route.abort("failed");
      await page.unroute("**/knowledge/answers");
    });
    await page.getByLabel("Ders kaynaklarına sorun").fill(question);
    await page.getByRole("button", { name: "Gönder ↑", exact: true }).click();
    await page
      .getByRole("button", { name: "Son soruyu yeniden dene" })
      .waitFor();
    const sent = page.waitForRequest((r) =>
      r.url().endsWith("/knowledge/answers"),
    );
    await page.getByRole("button", { name: "Son soruyu yeniden dene" }).click();
    const body = (await sent).postDataJSON();
    assert.equal(body.viewport.page, 4);
    assert.ok(Math.abs(body.viewport.region.width - 0.5) < 0.03);
    assert.deepEqual(
      body.scope.material_ids.sort(),
      pdfs.map((m) => m.id).sort(),
    );
    await page
      .getByLabel("Ders yanıtı 1", { exact: true })
      .waitFor({ timeout: 200000 });
    record("real-browser-page-region-scope-retry", {
      page: body.viewport.page,
      region: body.viewport.region,
    });
    await page.getByRole("button", { name: "Bölgeyi temizle" }).click();
    await page.getByRole("button", { name: "Seçimi temizle" }).click();
    assert.equal(
      await page.getByLabel("Arama kapsamı", { exact: true }).inputValue(),
      "course",
    );
    await choose(ppt);
    await page.getByRole("spinbutton", { name: "Slayt numarası" }).fill("3");
    await page.getByRole("img", { name: ppt.title + " · Slayt 3" }).waitFor();
    record("real-pptx-viewer-slide-3");
    await choose(vm);
    const player = page.getByLabel("Ortak ders videosu", { exact: true });
    await player.waitFor();
    await page.waitForFunction(
      () => document.querySelector("video")?.readyState >= 2,
    );
    await page.getByRole("progressbar").waitFor();
    const progressRoute = base + "/videos/" + videos[0].id + "/progress",
      get = () => ok("GET", progressRoute);
    assert.equal((await get()).watched_ms, 0);
    await player.evaluate(async (v) => {
      v.muted = true;
      await v.play();
    });
    await page.waitForTimeout(2100);
    await player.evaluate((v) => v.pause());
    let p = await until(
      get,
      (p) => p.watched_ms >= 1200,
      "Playback tail missing",
    );
    const first = p.watched_ms;
    record("real-play-pause", {
      watched_ms: first,
      position_ms: p.position_ms,
    });
    const seek = async (t) => {
      await player.evaluate((v, t) => (v.currentTime = t), t);
      await page.waitForFunction((t) => {
        const v = document.querySelector("video");
        return v && !v.seeking && Math.abs(v.currentTime - t) < 0.2;
      }, t);
      return until(
        get,
        (p) => Math.abs(p.position_ms - t * 1000) < 200,
        "Seek not persisted",
      );
    };
    p = await seek(100);
    assert.equal(p.watched_ms, first);
    p = await seek(0);
    assert.equal(p.watched_ms, first);
    record("real-paused-forward-backward-seek-no-credit");
    await player.evaluate(async (v) => {
      v.playbackRate = 2;
      await v.play();
    });
    await page.waitForTimeout(650);
    await player.evaluate((v) => v.pause());
    p = await until(get, (p) => p.revision > 2, "Replay not persisted");
    assert.ok(p.watched_ms < first + 700);
    record("real-rate-change-overlap-union", {
      before: first,
      after: p.watched_ms,
    });
    // Real failed network write is retained and retried, without invented intervals.
    await page.route("**/videos/*/progress", async (route) => {
      if (route.request().method() === "PUT") {
        await route.abort("failed");
      } else await route.continue();
    });
    await player.evaluate((v) => (v.currentTime = 120));
    await page
      .getByRole("button", { name: "Tekrar kaydet", exact: true })
      .waitFor();
    await page.unroute("**/videos/*/progress");
    await page
      .getByRole("button", { name: "Tekrar kaydet", exact: true })
      .click();
    p = await until(
      get,
      (p) => p.position_ms === 120000,
      "Network retry did not persist",
    );
    assert.ok(p.watched_ms < first + 700);
    record("real-network-interruption-recovery");
    await page.reload();
    await choose(vm);
    await player.waitFor();
    await page.waitForFunction(
      () => Math.abs(document.querySelector("video")?.currentTime - 120) < 0.2,
    );
    await page.waitForTimeout(5200);
    assert.equal((await get()).position_ms, 120000);
    await page
      .getByRole("button", { name: /Kaldığın yerden devam et/ })
      .click();
    assert.ok(
      Math.abs((await player.evaluate((v) => v.currentTime)) - 120) < 0.2,
    );
    record("real-refresh-resume-saved-position");
    const beforeNav = (await get()).watched_ms;
    const preview = await ok("GET", k + "/materials/" + vm.id);
    const target = preview.segments.find((s) => s.location.start_ms > 2000);
    assert.ok(target);
    await page.locator(".source-sections summary").click();
    const segmentButton = page
      .locator(".source-sections button")
      .filter({ hasText: target.text.slice(0, 25) });
    assert.ok(
      await segmentButton.count(),
      "Actual transcript navigation button missing",
    );
    await segmentButton.first().click();
    await until(
      get,
      (p) => Math.abs(p.position_ms - target.location.start_ms) < 200,
      "Citation seek missing",
    );
    assert.equal((await get()).watched_ms, beforeNav);
    record("real-timestamp-navigation-no-fake-credit", {
      timestamp_ms: target.location.start_ms,
    });
    const saved = (await get()).position_ms;
    await choose(vm2);
    await page.getByRole("progressbar").waitFor();
    assert.equal(
      (await ok("GET", base + "/videos/" + videos[1].id + "/progress"))
        .watched_ms,
      0,
    );
    await choose(vm);
    await player.waitFor();
    await page.waitForFunction(
      (t) =>
        Math.abs(document.querySelector("video")?.currentTime - t / 1000) < 0.2,
      saved,
    );
    record("real-video-switch-isolates-progress");
    await player.evaluate((v) => {
      v.currentTime = v.duration - 0.8;
      v.playbackRate = 1;
    });
    await page.waitForFunction(() => !document.querySelector("video")?.seeking);
    await player.evaluate((v) => v.play());
    await page.waitForFunction(() => document.querySelector("video")?.ended);
    p = await until(
      get,
      (p) => p.position_ms >= p.duration_ms - 100,
      "Ended not persisted",
    );
    assert.ok(p.watched_percent < 5);
    record("real-ended-does-not-mean-fully-watched", {
      percent: p.watched_percent,
      position_ms: p.position_ms,
    });
    report.checks.push({
      name: "real-background-tab",
      status: "PARTIAL",
      reason:
        "Headless Edge visibility switching is not equivalent to foreground desktop tabs; hidden policy separately unit-tested.",
    });
    await page.screenshot({
      path: path.join(out, "context-progress-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
    record("real-responsive-no-runtime-errors");
    assert.deepEqual(
      await prisma.videoProgress.findMany({ where: { videoId: { in: ids } } }),
      before,
    );
    record("original-video-progress-unchanged");
    report.status = "PARTIAL";
  } catch (e) {
    report.status = "FAIL";
    report.error = e.message;
    throw e;
  } finally {
    if (browser) await browser.close();
    if (prisma) await prisma.$disconnect();
    fs.writeFileSync(
      path.join(out, "context-browser-run.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
