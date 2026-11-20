/** Real local AI and persisted own fixture course; no mock answers or data reset. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "data/context-tests");
const seed = JSON.parse(
    fs.readFileSync(path.join(root, "data/video-tests/last-run.json")),
  ),
  account = JSON.parse(fs.readFileSync(seed.credentials_file)).accounts[0];
const report = { checks: [], status: "RUNNING" };
let token;
async function request(method, route, body) {
  for (let n = 0; n < 6; n++) {
    const r = await fetch("http://127.0.0.1:3100" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(200000),
    });
    const data = await r.json();
    if (r.status === 429) {
      await new Promise((r) => setTimeout(r, 12000));
      continue;
    }
    return { status: r.status, data };
  }
  throw new Error("Rate limit remained active");
}
function record(name, status, detail = {}) {
  report.checks.push({ name, status, ...detail });
  console.log(name, status, JSON.stringify(detail));
}
async function main() {
  try {
    token = (
      await request("POST", "/auth/login", {
        email: account.email,
        password: account.password,
      })
    ).data.access_token;
    const courses = (await request("GET", "/courses")).data;
    let fixture = courses.find(
      (c) => c.name === "Demo • Model kalite kontrolü" && c.can_manage,
    );
    if (!fixture) {
      const r = await request("POST", "/courses", {
        name: "Demo • Model kalite kontrolü",
        description: "Own source-grounded real local model fixture.",
      });
      assert.equal(r.status, 201);
      fixture = r.data;
    }
    const course = fixture.id,
      base = "/courses/" + course,
      k = base + "/knowledge";
    report.course_id = course;
    let materials = (await request("GET", k + "/materials")).data.materials;
    if (!materials.length) {
      const form = new FormData();
      form.set(
        "file",
        new Blob([
          "Variable substitution in integration\nVariable substitution rewrites a composite integral using a new variable. Choose u = g(x) for a differentiable inner function. Compute du = g\u2032(x) dx. Rewrite both the integrand and the differential in terms of u; do not leave a mixture of x and u. Integrate with respect to u. Finally substitute g(x) back for u and add an arbitrary constant C for an indefinite integral.\nWorked example: for the integral of 2x cos(x squared) dx, choose u = x squared and du = 2x dx. The transformed integral is the integral of cos(u) du. Its antiderivative is sin(u) + C. Substitution back gives sin(x squared) + C. Differentiate the result to check it: the chain rule gives 2x cos(x squared), matching the original integrand.\nThe derivative factor must be accounted for when transforming the differential. Merely replacing the inner expression without transforming dx does not complete the substitution. The constant C represents the family of antiderivatives and disappears when differentiated.",
        ]),
        "substitution-quality.txt",
      );
      const r = await fetch("http://127.0.0.1:3100" + k + "/materials", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: form,
      });
      assert.equal(r.status, 201);
      materials = (await request("GET", k + "/materials")).data.materials;
    }
    const source = materials[0];
    assert.ok(source);
    report.fixture =
      "Original coherent English integration note; no model-generated answer fixture.";
    const question =
        "How is variable substitution applied in integration? Explain the method and the worked example.",
      scope = { mode: "selected", material_ids: [source.id] };
    const first = await request("POST", k + "/answers", { question, scope });
    assert.equal(first.status, 200);
    assert.ok(first.data.evidence.length);
    report.baseline = first.data;
    for (const mode of ["short", "step_by_step", "detailed", "example"]) {
      const r = await request("POST", k + "/answers", {
        question,
        scope,
        response_mode: mode,
        reference_mode: "conversation",
        chat_id: first.data.chat_id,
        parent_message_id: first.data.message_id,
      });
      assert.equal(r.status, 200);
      const d = r.data;
      report[mode] = d;
      const valid =
        d.status === "GENERATED_UNVERIFIED" &&
        d.answer !== first.data.answer &&
        (mode !== "short" || d.answer.split(/\s+/).length <= 70) &&
        (mode !== "step_by_step" || /^1\. /m.test(d.answer));
      record("real-mode-" + mode, valid ? "PASS" : "PARTIAL", {
        generation_status: d.status,
        words: d.answer.split(/\s+/).length,
      });
    }
    for (const topic of [
      "Variable substitution: transforming the differential",
      "Variable substitution: checking the antiderivative",
    ]) {
      const r = await request("POST", base + "/quizzes", {
        topic,
        kind: "MULTIPLE_CHOICE",
        scope,
      });
      if (r.status !== 201) {
        assert.equal(r.status, 422);
        record("real-mcq-quality-gate", "REJECTED", {
          topic,
          message: r.data.error?.message,
        });
        continue;
      }
      const q = r.data;
      assert.equal(q.expected, undefined);
      assert.equal(q.quote, undefined);
      assert.equal(q.source?.text, undefined);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4);
      const grade = await request(
        "POST",
        base + "/quizzes/" + q.id + "/answers",
        { response: "0" },
      );
      assert.equal(grade.status, 200);
      assert.ok(grade.data.explanation);
      assert.ok(grade.data.selected_option_feedback);
      assert.ok(q.options.includes(grade.data.expected));
      report.quiz = { question: q, feedback: grade.data };
      record("real-reviewed-mcq", "PASS", {
        question: q.question,
        options: q.options,
        objective: q.objective,
      });
      break;
    }
    const excluded = await request("POST", base + "/quizzes", {
      topic: "Integral",
      kind: "MULTIPLE_CHOICE",
      scope,
      watched_only: true,
    });
    assert.equal(excluded.status, 422);
    record("watched-scope-does-not-use-pdf-or-skipped-video", "PASS");
    report.status =
      report.checks.some((x) => x.status === "PARTIAL") || !report.quiz
        ? "PARTIAL"
        : "PASS";
  } catch (e) {
    report.status = "FAIL";
    report.error = e.message;
    throw e;
  } finally {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "modes-quiz-run.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
