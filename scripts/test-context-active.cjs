/** Real current viewport and ambiguity handling on isolated own course sources. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "data/context-tests"),
  fixture = JSON.parse(
    fs.readFileSync(path.join(out, "context-browser-run.json")),
  ),
  seed = JSON.parse(
    fs.readFileSync(path.join(root, "data/video-tests/last-run.json")),
  ),
  account = JSON.parse(fs.readFileSync(seed.credentials_file)).accounts[0],
  report = { checks: [], status: "RUNNING" };
let token;
async function call(method, route, body) {
  const r = await fetch("http://127.0.0.1:3100" + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(200000),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
function record(name, detail = {}) {
  report.checks.push({ name, status: "PASS", ...detail });
  console.log(name, JSON.stringify(detail));
}
async function main() {
  try {
    token = (
      await call("POST", "/auth/login", {
        email: account.email,
        password: account.password,
      })
    ).access_token;
    const k = "/courses/" + fixture.course_id + "/knowledge",
      materials = (await call("GET", k + "/materials")).materials;
    for (const [kind, viewport, location] of [
      ["PDF", { kind: "page", page: 4 }, "page"],
      ["PPTX", { kind: "slide", slide: 3 }, "slide"],
    ]) {
      const m = materials.find((m) => m.kind === kind),
        r = await call("POST", k + "/answers", {
          question:
            "Bu " +
            (kind === "PDF" ? "sayfada" : "slaytta") +
            " ne anlatılıyor?",
          scope: { mode: "course" },
          active_material_id: m.id,
          viewport,
        });
      assert.equal(r.resolved_context.viewport[location], viewport[location]);
      assert.ok(
        r.evidence.some(
          (e) =>
            e.material_id === m.id &&
            e.location[location] === viewport[location],
        ),
      );
      assert.equal(r.retrieval.searched.length, 5);
      record("real-active-" + kind.toLowerCase(), {
        location: viewport,
        generation_status: r.status,
      });
    }
    const ambiguous = await call("POST", k + "/answers", {
      question: "Alttaki örneği açıkla",
      scope: { mode: "course" },
    });
    assert.equal(ambiguous.status, "CLARIFICATION");
    assert.equal(ambiguous.evidence.length, 0);
    assert.match(ambiguous.answer, /\?/);
    record("real-missing-viewport-clarifies");
    const pdf = materials.find((m) => m.kind === "PDF"),
      preview = await call("GET", k + "/materials/" + pdf.id),
      s = preview.segments.find((s) => s.location.page === 4),
      selected = s.text.slice(0, Math.min(100, s.text.length));
    const answer = await call("POST", k + "/answers", {
      question: "İşaretlediğim metni açıkla",
      active_material_id: pdf.id,
      viewport: { kind: "page", page: 4, selected_text: selected },
    });
    assert.equal(answer.resolved_context.viewport.selected_text, selected);
    assert.ok(answer.evidence.some((e) => e.id === s.id));
    record("real-verified-selected-text");
    const video = materials.find((m) => m.source_id === fixture.video_ids[0]);
    const request = {
      question: "Şu an izlediğim yerdeki konuyu açıkla",
      active_material_id: video.id,
      viewport: { kind: "video", timestamp_ms: 30000 },
      scope: { mode: "course" },
    };
    const guidance = await call("POST", k + "/answers", request);
    assert.equal(guidance.status, "GUIDANCE");
    assert.equal(guidance.llm_used, false);
    assert.ok(guidance.video_learning.some((l) => l.state === "UNWATCHED"));
    record("real-unwatched-topic-guides-before-explanation", {
      supplementary_kinds: [...new Set(guidance.evidence.map((e) => e.kind))],
    });
    const explained = await call("POST", k + "/answers", {
      ...request,
      chat_id: guidance.chat_id,
      parent_message_id: guidance.message_id,
      explain_now: true,
    });
    assert.notEqual(explained.status, "GUIDANCE");
    assert.equal(explained.learning_policy.explanation_authorized, true);
    record("real-explicit-explanation-per-message", {
      generation_status: explained.status,
    });
    const next = await call("POST", k + "/answers", {
      ...request,
      viewport: { kind: "video", timestamp_ms: 60000 },
      chat_id: guidance.chat_id,
    });
    assert.equal(next.status, "GUIDANCE");
    assert.equal(next.learning_policy.explanation_authorized, false);
    record("real-new-topic-does-not-inherit-permission");
    report.status = "PASS";
  } catch (e) {
    report.status = "FAIL";
    report.error = e.message;
    throw e;
  } finally {
    fs.writeFileSync(
      path.join(out, "active-context-run.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
