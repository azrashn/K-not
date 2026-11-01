import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LearningWorkspace from "../../src/pages/LearningWorkspace";
import { api } from "../../src/api/endpoints";
vi.mock("../../src/api/endpoints");
const nav = vi.hoisted(() => vi.fn());
vi.mock("../../src/app/store", () => ({ useApp: () => ({ navigate: nav }) }));
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
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
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
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
  );
  await screen.findByLabelText("Ders yanıtı 1");
  await user.type(input, "Next?");
  await user.click(
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
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
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
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
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
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
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
  );
  await screen.findByLabelText("Ders yanıtı 1");
  await user.click(
    screen.getAllByRole("button", { name: "Alıştırma yap ↗" }).at(-1),
  );
  expect(nav).toHaveBeenCalledWith("/dersler/course/quiz", { topic: "Water?" });
});

test("missing voice start callback times out while written explanation remains usable", async () => {
  const speech = {
    getVoices: () => [{ localService: true, lang: "tr-TR" }],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    speak: vi.fn(),
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
  api.knowledgeAnswer.mockResolvedValue({
    ...answer,
    status: "GENERATED_UNVERIFIED",
    llm_used: true,
  });
  const user = userEvent.setup();
  render(<LearningWorkspace courseId="course" />);
  await screen.findByRole("heading", { name: "Physics" });
  await user.type(screen.getByLabelText("Ders kaynaklarına sorun"), "Water?");
  await user.click(
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
  );
  const speak = await screen.findByRole("button", {
    name: "Açıklamayı seslendir",
  });
  vi.useFakeTimers();
  fireEvent.click(speak);
  act(() => vi.advanceTimersByTime(12001));
  expect(
    screen.getByText("Seslendirme başarısız. Metni okuyabilirsin."),
  ).toBeVisible();
  expect(screen.getByText("[1] Water evaporates.")).toBeVisible();
  expect(speech.speak).toHaveBeenCalledTimes(1);
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
  await user.click(screen.getByRole("button", { name: "Gönder ↑" }));
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
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
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
    screen.getByRole("button", { name: "Gönder ↑", exact: true }),
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
