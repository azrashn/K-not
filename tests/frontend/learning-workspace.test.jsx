import { voicePrefs } from "../../src/lib/speech";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LearningWorkspace from "../../src/pages/LearningWorkspace";
import { api } from "../../src/api/endpoints";
vi.mock("../../src/api/endpoints");
const nav = vi.hoisted(() => vi.fn());
const pendingIntent = vi.hoisted(() => ({ value: null }));
vi.mock("../../src/app/store", () => ({
  useApp: () => ({ navigate: nav, takeIntent: () => { const v = pendingIntent.value; pendingIntent.value = null; return v; } }),
}));
vi.mock("../../src/hooks/useVideoProgress", () => ({
  useVideoProgress: () => ({
    flushForQuestion: vi.fn().mockResolvedValue(true),
  }),
}));
const m = {
  id: "file_slides",
  kind: "PPTX",
  source_id: "slides",
  title: "Water cycle",
  status: "READY",
};
const evidence = {
  id: "a".repeat(64),
  material_id: m.id,
  kind: "PPTX",
  n: 1,
  title: m.title,
  text: "Water evaporates.",
  location: { kind: "slide", slide: 2 },
};
const answer = {
  question: "Water?",
  answer: "[1] Water evaporates.",
  status: "SOURCE_EXCERPTS",
  evidence: [evidence],
  video_learning: [],
  conflicts: [],
  associations: [],
  llm_used: false,
  conversation_id: "receipt",
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  api.conversations.mockResolvedValue([]);
  api.activity.mockResolvedValue({});
  api.knowledgeVisual.mockResolvedValue(new Blob(["png"]));
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    }),
  );
  api.course.mockResolvedValue({ name: "Physics" });
  api.knowledgeMaterials.mockResolvedValue({ materials: [m] });
  api.knowledgeAnswer.mockResolvedValue(answer);
  api.knowledgeSource.mockResolvedValue({ ...evidence, source_id: "slides" });
  api.knowledgePreview.mockResolvedValue({ material: m, segments: [evidence] });
});
test("one course workspace searches without limiting to selected file and opens actual slide", async () => {
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await screen.findByText("Gerçek kaynak alıntıları · model üretimi değil");
  expect(api.knowledgeAnswer.mock.calls[0][1]).toMatchObject({
    question: "Water?",
    scope: { mode: "course" },
    response_mode: "default",
  });
  await user.click(screen.getByRole("button", { name: /\[1\] PPTX/ }));
  await screen.findByRole("img", { name: "Water cycle · Slayt 2" });
  expect(api.knowledgeVisual).toHaveBeenLastCalledWith(
    "course",
    m.id,
    2,
    expect.any(AbortSignal),
  );
  expect(api.knowledgeSource).toHaveBeenCalledWith("course", m.id, evidence.id);
});
test("follow-up uses server conversation identity; new conversation clears it", async () => {
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  const input = screen.getByLabelText("Ders kaynaklarına sorun");
  await user.type(input, "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await screen.findByLabelText("Ders yanıtı 1");
  await user.type(input, "Next?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await waitFor(() => expect(api.knowledgeAnswer).toHaveBeenCalledTimes(2));
  expect(api.knowledgeAnswer.mock.calls[1][1].conversation_id).toBe("receipt");
  await user.click(screen.getByRole("button", { name: "+ Yeni konuşma" }));
  expect(screen.queryByLabelText("Ders yanıtı 1")).toBeNull();
});
test("source gone shows honest error, no made-up slide", async () => {
  api.knowledgeSource.mockRejectedValue(new Error("404"));
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await user.click(await screen.findByRole("button", { name: /\[1\] PPTX/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "kaldırılmış veya güncellenmiş",
  );
});
test("source-only video guidance exposes explicit explanation without faking audio", async () => {
  api.knowledgeAnswer.mockResolvedValueOnce({
    ...answer,
    status: "GUIDANCE",
    video_learning: [{ source_id: "x", state: "UNWATCHED" }],
  });
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await user.click(await screen.findByRole("button", { name: "Şimdi açıkla" }));
  await waitFor(() => expect(api.knowledgeAnswer).toHaveBeenCalledTimes(2));
  expect(api.knowledgeAnswer.mock.calls[1][1]).toMatchObject({
    question: "Water?",
    explain_now: true,
    conversation_id: "receipt",
  });
});
test("source-linked quiz navigation retains the actual question topic", async () => {
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await screen.findByLabelText("Ders yanıtı 1");
  await user.click(
    screen.getAllByRole("button", { name: "Alıştırma yap ↗" }).at(-1),
  );
  expect(nav).toHaveBeenCalledWith("/dersler/course/quiz", { topic: "Water?" });
});

function stubSpeech(voices = [{ localService: true, lang: "tr-TR", name: "Yerel", voiceURI: "yerel" }]) {
  const speech = {
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  vi.stubGlobal("speechSynthesis", speech);
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(text) {
        this.text = text;
      }
    },
  );
  return speech;
}

async function askWater(user) {
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
}

test("a new answer is read aloud on its own while sound is on; a missing start callback times out and the text stays usable", async () => {
  localStorage.clear();
  voicePrefs.reload();
  // Capture the 12 s start watchdog instead of faking all timers (React and user-event keep real ones).
  const watchdogs = [];
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, ms, ...rest) =>
    ms === 12000 ? (watchdogs.push(fn), 0) : realSetTimeout(fn, ms, ...rest),
  );
  const speech = stubSpeech();
  api.knowledgeAnswer.mockResolvedValue({ ...answer, status: "GENERATED_UNVERIFIED", llm_used: true });
  const user = userEvent.setup();
  await askWater(user);
  await screen.findByRole("button", { name: "Açıklamayı seslendir" });
  expect(speech.speak).toHaveBeenCalledTimes(1);
  expect(watchdogs).toHaveLength(1);
  act(() => watchdogs[0]());
  expect(screen.getByText("Seslendirme başarısız. Metni okuyabilirsin.")).toBeVisible();
  expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "[1] Water evaporates.")).toBeVisible();
});

test("after the user turns sound off, answers are no longer read aloud and the choice is remembered", async () => {
  localStorage.clear();
  voicePrefs.reload();
  const speech = stubSpeech();
  api.knowledgeAnswer.mockResolvedValue({ ...answer, status: "GENERATED_UNVERIFIED", llm_used: true });
  const user = userEvent.setup();
  await askWater(user);
  await user.click(await screen.findByRole("button", { name: "Otomatik okumayı kapat" }));
  expect(screen.getByRole("button", { name: "Otomatik okumayı aç" })).toBeVisible();
  expect(JSON.parse(localStorage.getItem("knot.voice.prefs")).auto).toBe(false);
  speech.speak.mockClear();
  api.knowledgeAnswer.mockResolvedValue({ ...answer, answer: "Another answer.", status: "GENERATED_UNVERIFIED", llm_used: true });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Again?");
  await user.click(screen.getByRole("button", { name: "Gönder", exact: true }));
  await screen.findByLabelText("Ders yanıtı 2");
  expect(speech.speak).not.toHaveBeenCalled();
  await user.click(await screen.findByRole("button", { name: "Açıklamayı seslendir" }));
  expect(speech.speak).toHaveBeenCalled();
});

test("a new answer scrolls to its own beginning instead of jumping to the bottom", async () => {
  localStorage.clear();
  voicePrefs.reload();
  stubSpeech([]);
  api.knowledgeAnswer.mockResolvedValue({ ...answer, status: "GENERATED_UNVERIFIED", llm_used: true });
  const scrollTo = vi.fn();
  Element.prototype.scrollTo = scrollTo;
  const user = userEvent.setup();
  await askWater(user);
  await screen.findByLabelText("Ders yanıtı 1");
  const calls = scrollTo.mock.calls.map((c) => c[0]);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((c) => c.top !== Infinity)).toBe(true);
  // jsdom has no layout: the target is the turn's own top (0 - 0 + 0 - 8), never scrollHeight.
  expect(calls.at(-1).top).toBe(-8);
});

test("stored conversation is restored without relying on in-memory answer receipts", async () => {
  sessionStorage.setItem("knot.chat.course", "saved");
  api.conversations.mockResolvedValue([{ id: "saved", title: "Water?" }]);
  api.conversation.mockResolvedValue({
    messages: [
      { role: "user", content: "Water?" },
      { role: "assistant", content: answer.answer, payload: answer },
    ],
  });
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByText(answer.answer);
  await user.type(
    screen.getByLabelText("Ders kaynaklarına sorun"),
    "Bir örnek göster",
  );
  await user.click(screen.getByRole("button", { name: "Gönder" }));
  await waitFor(() => expect(api.knowledgeAnswer).toHaveBeenCalled());
  expect(api.knowledgeAnswer.mock.calls[0][1].chat_id).toBe("saved");
});

test("retry preserves the failed request and source scope", async () => {
  api.knowledgeAnswer
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(answer);
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Son soruyu yeniden dene" }),
  );
  await screen.findByLabelText("Ders yanıtı 1");
  expect(api.knowledgeAnswer.mock.calls[1][1]).toEqual(
    api.knowledgeAnswer.mock.calls[0][1],
  );
});

test("response buttons send a real mode and the saved parent message", async () => {
  api.knowledgeAnswer.mockResolvedValue({
    ...answer,
    message_id: "saved-message",
    chat_id: "saved-chat",
  });
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Kısaca açıkla" }),
  );
  await waitFor(() => expect(api.knowledgeAnswer).toHaveBeenCalledTimes(2));
  expect(api.knowledgeAnswer.mock.calls[1][1]).toMatchObject({
    response_mode: "short",
    reference_mode: "conversation",
    parent_message_id: "saved-message",
    question: "Water?",
  });
  expect(api.knowledgeAnswer.mock.calls[1][1].explain_now).toBeUndefined();
});


test("Enter sends the question, Shift+Enter only adds a new line", async () => {
  api.knowledgeAnswer.mockResolvedValue({ ...answer, status: "GENERATED_UNVERIFIED", llm_used: true });
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  const box = screen.getByLabelText("Ders kaynaklarına sorun");
  await user.type(box, "Water?{Shift>}{Enter}{/Shift}Second line");
  expect(box.value).toBe("Water?\nSecond line");
  expect(api.knowledgeAnswer).not.toHaveBeenCalled();
  await user.type(box, "{Enter}");
  await screen.findByLabelText("Ders yanıtı 1");
  expect(api.knowledgeAnswer).toHaveBeenCalledTimes(1);
  expect(api.knowledgeAnswer.mock.calls[0][1].question).toBe("Water?\nSecond line");
  expect(box.value).toBe("");
});

test("Enter on an empty question does nothing", async () => {
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "{Enter}");
  expect(api.knowledgeAnswer).not.toHaveBeenCalled();
});


test("the answer says which style it was written in", async () => {
  api.knowledgeAnswer.mockResolvedValue({ ...answer, status: "GENERATED_UNVERIFIED", llm_used: true, response_mode: "detailed" });
  const user = userEvent.setup();
  await askWater(user);
  const turn = await screen.findByLabelText("Ders yanıtı 1");
  expect(within(turn).getByText("Ayrıntılı yanıt")).toBeInTheDocument();
});

test("a failed model says why and that source sentences are shown instead", async () => {
  api.knowledgeAnswer.mockResolvedValue({ ...answer, status: "GENERATION_FAILED_SOURCE_EXCERPTS", llm_used: false, generation_failure: "UNAVAILABLE", generation_detail: "provider error 500: model requires more system memory" });
  const user = userEvent.setup();
  await askWater(user);
  const turn = await screen.findByLabelText("Ders yanıtı 1");
  expect(within(turn).getByText(/Ollama açık mı/)).toBeVisible();
  expect(within(turn).getByText(/model yorumu değil/)).toBeVisible();
  expect(within(turn).getByText(/more system memory/)).toBeVisible();
});
const askWaterExcerpts = async () => {
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(screen.getByRole("button", { name: "Gönder", exact: true }));
  await screen.findByText("Gerçek kaynak alıntıları · model üretimi değil");
  return user;
};

test("an answer with steps opens the board in the workspace; its sources open the material", async () => {
  api.knowledgeAnswer.mockResolvedValue({
    ...answer,
    steps: [{ board: "Su buharlaşır", speech: "Su ısınınca buharlaşır.", formula: null, mark: null, sources: [evidence.id], quote: "Water evaporates." }],
  });
  const user = await askWaterExcerpts();
  const board = screen.getByRole("region", { name: "Tahtada anlatım" });
  expect(board.querySelector(".board-step")).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "[1] Water evaporates.")).toBeInTheDocument();

  await user.click(board.querySelector(".board-sources .board-chip"));
  await waitFor(() => expect(api.knowledgeSource).toHaveBeenCalledWith("course", m.id, evidence.id));

  await user.click(screen.getByRole("button", { name: "Yazılı metne dön" }));
  expect(screen.queryByRole("region", { name: "Tahtada anlatım" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Tahtada göster" }));
  expect(screen.getByRole("region", { name: "Tahtada anlatım" })).toBeInTheDocument();
});

test("an answer without steps (or with an empty list) stays a text answer", async () => {
  api.knowledgeAnswer.mockResolvedValue({ ...answer, steps: [] });
  await askWaterExcerpts();
  expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "[1] Water evaporates.")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Tahtada anlatım" })).not.toBeInTheDocument();
  // The button stays in the header but is disabled: there is nothing to explain on the board.
  const show = screen.getByRole("button", { name: "Tahtada göster" });
  expect(show).toBeDisabled();
  expect(show).toHaveAttribute("title", "Tahtada anlatılabilir bir cevap yok");
});
const video = { id: "video_v", kind: "VIDEO", source_id: "v", title: "Hafta 3 dersi", status: "READY" };
const videoSegment = { id: "b".repeat(64), text: "TCP SYN gönderir.", location: { kind: "video", start_ms: 312000, end_ms: 340000 } };
async function openSlide(user) {
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.click((await screen.findAllByRole("button", { name: /Water cycle/ }))[0]);
  await screen.findByRole("region", { name: "Özgün materyal görünümü" });
}
test("'Videoda anlatılışı' is hidden while the course has no ready video", async () => {
  const user = userEvent.setup();
  await openSlide(user);
  expect(screen.queryByRole("button", { name: "Videoda anlatılışı" })).toBeNull();
});
test("with a ready video the slide's link opens the video at that moment and says what was opened", async () => {
  const user = userEvent.setup();
  api.knowledgeMaterials.mockResolvedValue({ materials: [m, video] });
  api.materialLinks.mockResolvedValue({
    links: [{ source_id: videoSegment.id, material_id: video.id, title: video.title, kind: "VIDEO", location: videoSegment.location, shared_terms: ["TCP"], estimated: true }],
  });
  api.knowledgePreview.mockImplementation(async (_c, id) =>
    id === video.id ? { material: video, segments: [videoSegment] } : { material: m, segments: [evidence] },
  );
  api.videoFile.mockResolvedValue(new Blob(["v"]));
  await openSlide(user);
  await user.click(await screen.findByRole("button", { name: "Videoda anlatılışı" }));
  expect(api.materialLinks).toHaveBeenCalledWith("course", m.id, { page: expect.any(Number) }, expect.any(AbortSignal));
  await user.click(within(await screen.findByRole("region", { name: "Videoda benzer anlatımlar" })).getByRole("button", { name: /Hafta 3 dersi/ }));
  await waitFor(() => expect(api.knowledgePreview).toHaveBeenCalledWith("course", video.id, expect.any(AbortSignal)));
  expect(await screen.findByText("Hafta 3 dersi açıldı")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Belgeye dön" })).toBeInTheDocument();
});
test("çalışma alanından Kapsam haritasına gidilir", async () => {
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.click(screen.getByRole("button", { name: /Kapsam haritası/ }));
  expect(nav).toHaveBeenCalledWith("/dersler/course");
});
test("Kapsam haritasından gelen sayfa çalışma masasında doğrudan açılır", async () => {
  pendingIntent.value = { openPage: { materialId: m.id, page: 2 } };
  render(<LearningWorkspace courseId="course" />);
  await waitFor(() =>
    expect(api.activity).toHaveBeenCalledWith("course", { material_id: m.id, segment_id: evidence.id }),
  );
  expect(screen.queryByText(/Kaynak güncellenmiş/)).not.toBeInTheDocument();
});
