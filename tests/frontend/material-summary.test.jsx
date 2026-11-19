import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MaterialSummary from "../../src/components/MaterialSummary";
import LearningWorkspace from "../../src/pages/LearningWorkspace";
import { api } from "../../src/api/endpoints";

vi.mock("../../src/api/endpoints");
vi.mock("../../src/app/store", () => ({ useApp: () => ({ navigate: vi.fn() }) }));
vi.mock("../../src/hooks/useVideoProgress", () => ({
  useVideoProgress: () => ({ flushForQuestion: vi.fn().mockResolvedValue(true) }),
}));

const segment = {
  id: "b".repeat(64),
  text: "A queue removes items in first-in-first-out order.",
  location: { kind: "page", page: 3 },
};
const material = { id: "pdf_notes", kind: "PDF", source_id: "notes", title: "Veri yapıları", status: "READY", version: "v1" };
const summary = {
  focus: "summary",
  status: "SOURCE_VERIFIED",
  material,
  items: [{ text: "Kuyruk FIFO çalışır.", quote: "removes items in first-in-first-out order", source: { id: segment.id, location: segment.location } }],
};

beforeEach(() => {
  vi.resetAllMocks();
  api.conversations.mockResolvedValue([]);
  api.activity.mockResolvedValue({});
  api.course.mockResolvedValue({ name: "Algoritma" });
  api.knowledgeMaterials.mockResolvedValue({ materials: [material] });
  api.knowledgePreview.mockResolvedValue({ material, segments: [segment] });
  api.knowledgeSource.mockResolvedValue({ ...segment, material_id: material.id, source_id: "notes" });
  api.knowledgeVisual.mockResolvedValue(new Blob(["png"]));
});
afterEach(() => vi.restoreAllMocks());

test("summary panel shows only verified items with their quote and a source link", async () => {
  const user = userEvent.setup();
  api.materialSummary.mockResolvedValue(summary);
  const onOpenSource = vi.fn();
  render(<MaterialSummary courseId="course" material={material} labelOf={() => "Sayfa 3"} onOpenSource={onOpenSource} />);

  await user.click(screen.getByRole("button", { name: "Özet hazırla" }));
  expect(api.materialSummary).toHaveBeenCalledWith("course", material.id, "summary");
  const item = await screen.findByRole("listitem");
  expect(within(item).getByText("Kuyruk FIFO çalışır.")).toBeInTheDocument();
  expect(within(item).getByText(/removes items in first-in-first-out order/)).toBeInTheDocument();
  await user.click(within(item).getByRole("button", { name: /Kaynağa git/ }));
  expect(onOpenSource).toHaveBeenCalledWith({ id: segment.id, location: segment.location });
});

test("unverifiable summary shows the server reason and no items", async () => {
  const user = userEvent.setup();
  api.materialSummary.mockRejectedValue(Object.assign(new Error("Kaynaklı özet çıkarılamadı."), { code: "VALIDATION_ERROR" }));
  render(<MaterialSummary courseId="course" material={material} onOpenSource={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Anahtar kavramlar hazırla" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Kaynaklı özet çıkarılamadı.");
  expect(screen.queryByRole("listitem")).toBeNull();
});

test("workspace scenario: open a material, request a summary, and jump to its cited source", async () => {
  const user = userEvent.setup();
  api.materialSummary.mockResolvedValue(summary);
  render(<LearningWorkspace courseId="course" />);
  await user.click(await screen.findByRole("button", { name: /Veri yapıları/ }));
  // The workspace keeps the summary behind its own "Özet" tab.
  await user.click(await screen.findByRole("tab", { name: "Özet" }));
  const panel = await screen.findByRole("region", { name: "Kaynaklı özet" });
  await user.click(within(panel).getByRole("button", { name: "Özet hazırla" }));
  await within(panel).findByText("Kuyruk FIFO çalışır.");
  await user.click(within(panel).getByRole("button", { name: /Kaynağa git/ }));
  expect(api.knowledgeSource).toHaveBeenCalledWith("course", material.id, segment.id);
});
