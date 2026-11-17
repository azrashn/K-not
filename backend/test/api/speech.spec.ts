/** Real HTTP/auth; the AI service is the fake boundary (no voice model is simulated as audio quality). */
import { Harness } from "../support/harness";

const h = new Harness();
beforeAll(async () => { await h.start(); });
afterAll(async () => { await h.stop(); });
beforeEach(async () => { await h.reset(); });

test("status needs a login and reports whether the local voice exists", async () => {
  await h.http().get("/tts/status").expect(401);
  h.ai.on("GET", "/api/v1/knowledge/tts/status", () => ({ status: 200, body: { available: true, reason: null, voice: "tr_TR-dfki-medium" } }));
  const ok = await h.http().get("/tts/status").set(await h.as("ayse")).expect(200);
  expect(ok.body).toEqual({ available: true, voice: "tr_TR-dfki-medium" });
});

test("an unreachable or confused AI service reads as 'no local voice', never an error page", async () => {
  h.ai.on("GET", "/api/v1/knowledge/tts/status", () => ({ status: 500, body: { oops: true } }));
  const r = await h.http().get("/tts/status").set(await h.as("ayse")).expect(200);
  expect(r.body).toEqual({ available: false, voice: null });
});

test("speech returns the audio, validates the text and hides a missing voice behind a clear message", async () => {
  await h.http().post("/tts").send({ text: "Merhaba" }).expect(401);
  h.ai.on("POST", "/api/v1/knowledge/tts", (req: any) => ({ status: 200, body: { mime: "audio/wav", voice: "v", audio_base64: Buffer.from(String(req.body.text)).toString("base64") } }));
  const ok = await h.http().post("/tts").set(await h.as("ayse")).send({ text: "Merhaba dünya." }).expect(200);
  expect(ok.body).toMatchObject({ mime: "audio/wav", voice: "v" });
  expect(Buffer.from(ok.body.audio_base64, "base64").toString()).toBe("Merhaba dünya.");
  await h.http().post("/tts").set(await h.as("ayse")).send({ text: "   " }).expect(422);
  await h.http().post("/tts").set(await h.as("ayse")).send({ text: "x".repeat(1201) }).expect(422);
  h.ai.on("POST", "/api/v1/knowledge/tts", () => ({ status: 503, body: { detail: "Local voice unavailable" } }));
  const down = await h.http().post("/tts").set(await h.as("ayse")).send({ text: "Merhaba" }).expect(503);
  expect(JSON.stringify(down.body)).toContain("Yerel ses");
});
