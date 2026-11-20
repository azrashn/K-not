/** Opt-in real local-model regression on the user's reported, existing PDF.
 * Does not modify the document or video progress. Private outputs stay ignored. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "data/context-tests");
const fixture = JSON.parse(
    fs.readFileSync(path.join(root, "data/video-tests/last-run.json")),
  ),
  account = JSON.parse(fs.readFileSync(fixture.credentials_file)).accounts[0],
  source = JSON.parse(fs.readFileSync(path.join(out, "graph-reference.json")));
async function main() {
  let token;
  async function request(route, body) {
    const r = await fetch("http://127.0.0.1:3100" + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    return d;
  }
  token = (
    await request("/auth/login", {
      email: account.email,
      password: account.password,
    })
  ).access_token;
  const question = "Alttaki örnekte BFS ve DFS sırası ne olur?";
  const result = await request(
    `/courses/${source.course_id}/knowledge/answers`,
    {
      question,
      active_material_id: source.material_id,
      viewport: {
        kind: "page",
        page: 4,
        region: { x: 0.15, y: 0.6, width: 0.67, height: 0.39 },
      },
      scope: { mode: "active" },
      analyze_visual: true,
    },
  );
  fs.writeFileSync(
    path.join(out, "reported-graph-answer.json"),
    JSON.stringify(result, null, 2),
  );
  assert.equal(result.resolved_context.viewport.page, 4);
  assert.ok(
    result.evidence.some(
      (e) => e.material_id === source.material_id && e.location.page === 4,
    ),
  );
  // Correct transport is not proof of correct graph reasoning. On this fixture,
  // unresolved ordering conditions must never be a single confident sequence.
  assert.equal(result.visual_analysis.status, "IMAGE_PROVIDED");
  assert.equal(
    result.status,
    "CLARIFICATION",
    "Graph reasoning needs manual review before accepting an unverified sequence",
  );
  assert.match(result.answer, /\?/);
  assert.doesNotMatch(result.answer, /optional question|actual question/);
  console.log(
    JSON.stringify(
      {
        test_status: "PARTIAL_VISUAL_REASONING",
        status: result.status,
        visual: result.visual_analysis,
        answer: result.answer,
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
