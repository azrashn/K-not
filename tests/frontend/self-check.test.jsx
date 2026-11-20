import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SelfCheck from "../../src/components/SelfCheck";
import LearningWorkspace from "../../src/pages/LearningWorkspace";
import { api } from "../../src/api/endpoints";

vi.mock("../../src/api/endpoints");
vi.mock("../../src/app/store", () => ({ useApp: () => ({ navigate: vi.fn() }) }));
vi.mock("../../src/hooks/useVideoProgress", () => ({
  useVideoProgress: () => ({ flushForQuestion: vi.fn().mockResolvedValue(true) }),
}));

const sid = "c".repeat(64);
const material = { id: "pdf_net", kind: "PDF", source_id: "net", title: "Chapter_3", status: "READY", version: "v1" };
const segment = { id: sid, text: "TCP uses a three-way handshake.", location: { kind: "page", page: 4 } };
const source = (over = {}) => ({
  source_id: sid,
  material_id: material.id,
  title: "Chapter_3",
  kind: "PDF",
  location: { page: 4 },
  quote: "TCP bağlantı kurulumu üç yollu el sıkışma ile yapılır.",
  ...over,
});
const result = {
  claims: [
    { text: "TCP üç yollu el sıkışma kullanır.", label: "IN_SOURCE", sources: [source()], missing_terms: [], unmatched_numbers: [], conflict: null },
    { text: "Ethernet çerçevesi en az 128 bayttır.", label: "CONFLICTS", sources: [source({ quote: "En küçük boyut 64 bayttır." })], missing_terms: [], unmatched_numbers: [], conflict: { kind: "NUMBER", claim: ["128"], source: ["64"] } },
    { text: "Kuantum ağlar fotonla çalışır.", label: "NOT_IN_SOURCE", sources: [], missing_terms: [], unmatched_numbers: [], conflict: null },
    { text: "TCP şifreleme anahtarı değişimi sağlar.", label: "PARTIAL", sources: [source()], missing_terms: ["şifreleme"], unmatched_numbers: [], conflict: null },
  ],
  skipped: [{ text: "Bu nasıl çalışır?", reason: "QUESTION" }],
  summary: { IN_SOURCE: 1, NOT_IN_SOURCE: 1, CONFLICTS: 1, PARTIAL: 1, UNCHECKED: 0, total: 4 },
  truncated: false,
  method: "lexical",
  verified: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  api.conversations.mockResolvedValue([]);
  api.activity.mockResolvedValue({});
  api.course.mockResolvedValue({ name: "Ağlar" });
  api.knowledgeMaterials.mockResolvedValue({ materials: [material] });
  api.knowledgePreview.mockResolvedValue({ material, segments: [segment] });
  api.knowledgeSource.mockResolvedValue({ ...segment, material_id: material.id, source_id: "net" });
  api.knowledgeVisual.mockResolvedValue(new Blob(["png"]));
});
afterEach(() => vi.restoreAllMocks());

test("empty text cannot be sent; filled text is sent to the course and the result is listed", async () => {
  const user = userEvent.setup();
  api.selfCheck.mockResolvedValue(result);
  render(<SelfCheck courseId="course" onOpenSource={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Kontrol et" });
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText("Konuyu kendi cümlelerinle yaz"), "TCP üç yollu el sıkışma kullanır.");
  await user.click(button);
  expect(api.selfCheck).toHaveBeenCalledWith("course", { text: "TCP üç yollu el sıkışma kullanır." }, expect.any(AbortSignal));
  const summary = await screen.findByText(/4 iddia/);
  expect(summary.closest("p")).toHaveTextContent("4 iddia: 1 kaynakta var, 1 kısmen, 1 kaynakta yok, 1 çelişiyor");
  expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
  // No score, percentage or verdict is ever shown.
  expect(document.body.textContent).not.toMatch(/%|puan|başarı|hazırsın/i);
});

test("each label has its own wording; not-in-source says it does not mean wrong; conflict names the numbers", async () => {
  const user = userEvent.setup();
  api.selfCheck.mockResolvedValue(result);
  render(<SelfCheck courseId="course" onOpenSource={vi.fn()} />);
  await user.type(screen.getByLabelText("Konuyu kendi cümlelerinle yaz"), "x");
  await user.click(screen.getByRole("button", { name: "Kontrol et" }));
  await screen.findByText(/4 iddia/);
  expect(screen.getByText("Bu iddia için materyallerinde kanıt bulunamadı. Yanlış demek değil.")).toBeInTheDocument();
  expect(screen.getByText("Sayı farklı: sen 128 yazdın, kaynakta 64 geçiyor.")).toBeInTheDocument();
  expect(screen.getByText("Kaynakta bulunamayan: şifreleme.")).toBeInTheDocument();
  for (const name of ["Kaynakta var", "Kaynakta yok", "Kaynakla çelişiyor", "Kısmen"])
    expect(screen.getAllByText(name, { selector: ".board-badge" }).length).toBe(1);
  expect(screen.getByText("Kontrol edilmeyen 1 cümle")).toBeInTheDocument();
});

test("clicking the source link opens that material and segment", async () => {
  const user = userEvent.setup();
  api.selfCheck.mockResolvedValue(result);
  const onOpenSource = vi.fn();
  render(<SelfCheck courseId="course" onOpenSource={onOpenSource} />);
  await user.type(screen.getByLabelText("Konuyu kendi cümlelerinle yaz"), "x");
  await user.click(screen.getByRole("button", { name: "Kontrol et" }));
  const first = (await screen.findAllByRole("listitem"))[0];
  await user.click(within(first).getByRole("button", { name: "Kaynağa git · Chapter_3 · Sayfa 4" }));
  expect(onOpenSource).toHaveBeenCalledWith({ material_id: material.id, id: sid });
});

test("a failed check keeps the text and says so in short Turkish", async () => {
  const user = userEvent.setup();
  api.selfCheck.mockRejectedValue(Object.assign(new Error("Kontrol şu anda yapılamadı. Yeniden deneyin."), { code: "AI_SERVICE_UNAVAILABLE" }));
  render(<SelfCheck courseId="course" onOpenSource={vi.fn()} />);
  const area = screen.getByLabelText("Konuyu kendi cümlelerinle yaz");
  await user.type(area, "UDP bağlantısız çalışır.");
  await user.click(screen.getByRole("button", { name: "Kontrol et" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Kontrol şu anda yapılamadı. Yeniden deneyin. Yazdığın metin korundu.");
  expect(area).toHaveValue("UDP bağlantısız çalışır.");
  expect(screen.getByRole("button", { name: "Kontrol et" })).toBeEnabled();
});

test("the text survives while loading; no claims found shows an empty state; edited text marks the result as old", async () => {
  const user = userEvent.setup();
  let resolve;
  api.selfCheck.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<SelfCheck courseId="course" onOpenSource={vi.fn()} />);
  const area = screen.getByLabelText("Konuyu kendi cümlelerinle yaz");
  await user.type(area, "Bence zor.");
  await user.click(screen.getByRole("button", { name: "Kontrol et" }));
  expect(screen.getByRole("button", { name: "Kontrol ediliyor…" })).toBeDisabled();
  expect(area).toHaveValue("Bence zor.");
  resolve({ claims: [], skipped: [{ text: "Bence zor.", reason: "OPINION" }], summary: { IN_SOURCE: 0, NOT_IN_SOURCE: 0, CONFLICTS: 0, PARTIAL: 0, UNCHECKED: 0, total: 0 }, truncated: false });
  expect(await screen.findByText(/Kontrol edilecek bir iddia bulunamadı/)).toBeInTheDocument();
  await user.type(area, " daha");
  expect(screen.getByText(/bu sonuç önceki metne aittir/)).toBeInTheDocument();
});

test("workspace: the button opens the panel with focus in the text box, Escape closes it and keeps the text; a source link opens the page", async () => {
  const user = userEvent.setup();
  api.selfCheck.mockResolvedValue(result);
  render(<LearningWorkspace courseId="course" />);
  const open = await screen.findByRole("button", { name: "Beni kontrol et" });
  expect(open).toHaveAttribute("aria-expanded", "false");
  await user.click(open);
  expect(open).toHaveAttribute("aria-expanded", "true");
  const area = screen.getByLabelText("Konuyu kendi cümlelerinle yaz");
  expect(area).toHaveFocus();
  await user.type(area, "TCP üç yollu el sıkışma kullanır.");
  await user.keyboard("{Escape}");
  expect(open).toHaveAttribute("aria-expanded", "false");
  expect(open).toHaveFocus();
  await user.click(open);
  expect(screen.getByLabelText("Konuyu kendi cümlelerinle yaz")).toHaveValue("TCP üç yollu el sıkışma kullanır.");
  await user.click(screen.getByRole("button", { name: "Kontrol et" }));
  const first = (await screen.findAllByRole("listitem"))[0];
  await user.click(within(first).getByRole("button", { name: /Kaynağa git/ }));
  expect(api.knowledgeSource).toHaveBeenCalledWith("course", material.id, sid);
});
