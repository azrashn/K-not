import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SelfCheck from "../../src/components/SelfCheck";
import { api } from "../../src/api/endpoints";

vi.mock("../../src/api/endpoints");

const row = (text, label) => ({
  text, label, translated: false, matched_terms: [], translation: null, meaning_warning: null, parts: [],
  sources: label === "IN_SOURCE" ? [{ source_id: "c".repeat(64), material_id: "pdf_x", title: "Ders", kind: "PDF", location: { page: 2 }, quote: "q" }] : [],
  missing_terms: [], unmatched_numbers: [], conflict: null,
});
const result = {
  claims: [row("Birinci iddia burada", "IN_SOURCE"), row("Kuantum ağlar fotonla çalışır.", "NOT_IN_SOURCE")],
  skipped: [], summary: { IN_SOURCE: 1, NOT_IN_SOURCE: 1, CONFLICTS: 0, PARTIAL: 0, UNCHECKED: 0, total: 2 }, truncated: false, remaining: 0, next_offset: 2,
};

beforeEach(() => {
  vi.resetAllMocks();
  api.selfCheck.mockResolvedValue(result);
});
afterEach(() => vi.restoreAllMocks());

async function open(user) {
  render(<SelfCheck courseId="course" onOpenSource={vi.fn()} />);
  await user.type(screen.getByLabelText("Konuyu kendi cümlelerinle yaz"), "x");
  await user.click(screen.getByRole("button", { name: "Kontrol et" }));
  return screen.findAllByRole("button", { name: "Web'de ara" });
}

test("web search is a button on a not-in-source row only, sends just that claim, and is shown apart from the sources", async () => {
  const user = userEvent.setup();
  api.selfCheckWeb.mockResolvedValue({ status: "FOUND", sources: [{ title: "Foton", url: "https://tr.wikipedia.org/wiki/Foton", quote: "Foton ışığın parçacığıdır.", site: "tr.wikipedia.org" }] });
  const buttons = await open(user);
  expect(buttons).toHaveLength(1);
  expect(api.selfCheckWeb).not.toHaveBeenCalled(); // never automatic
  await user.click(buttons[0]);
  expect(api.selfCheckWeb).toHaveBeenCalledWith("course", "Kuantum ağlar fotonla çalışır.", expect.any(AbortSignal));
  expect(await screen.findByText("Web'de bulundu")).toBeInTheDocument();
  expect(screen.getByText("Ders kaynağın değil; doğru olduğunu kanıtlamaz.")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /Foton · tr.wikipedia.org/ });
  expect(link).toHaveAttribute("href", "https://tr.wikipedia.org/wiki/Foton");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  // the summary line still counts only the course sources
  expect(screen.getByText(/2 iddia:/).closest("p")).toHaveTextContent("2 iddia: 1 kaynakta var, 1 kaynakta yok");
});

test("web search: not found is a plain statement, unavailable says so", async () => {
  const user = userEvent.setup();
  api.selfCheckWeb.mockResolvedValueOnce({ status: "NOT_FOUND", sources: [] });
  await user.click((await open(user))[0]);
  expect(await screen.findByText("Web'de de bulunamadı. Yanlış demek değil.")).toBeInTheDocument();
});

test("web search failure keeps the button so it can be tried again", async () => {
  const user = userEvent.setup();
  api.selfCheckWeb.mockRejectedValueOnce(Object.assign(new Error("Web araması şu anda yapılamadı."), { code: "AI_SERVICE_UNAVAILABLE" }));
  await user.click((await open(user))[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("Web araması şu anda yapılamadı.");
  expect(screen.getByRole("button", { name: "Web'de ara" })).toBeInTheDocument();
});

test("the web button is also offered on a row that could not be compared, but not on found or conflicting rows", async () => {
  const user = userEvent.setup();
  api.selfCheck.mockResolvedValue({
    ...result,
    claims: [row("Karşılaştırılamayan cümle burada", "UNCHECKED"), row("Bulunan cümle burada", "IN_SOURCE"), row("Kısmen cümle burada", "PARTIAL"), row("Çelişen cümle burada", "CONFLICTS")],
    summary: { IN_SOURCE: 1, NOT_IN_SOURCE: 0, CONFLICTS: 1, PARTIAL: 1, UNCHECKED: 1, total: 4 },
  });
  render(<SelfCheck courseId="course" onOpenSource={vi.fn()} />);
  await user.type(screen.getByLabelText("Konuyu kendi cümlelerinle yaz"), "x");
  await user.click(screen.getByRole("button", { name: "Kontrol et" }));
  const buttons = await screen.findAllByRole("button", { name: "Web'de ara" });
  expect(buttons).toHaveLength(1);
  expect(screen.getByText(/Yanlış demek değil\./)).toBeInTheDocument();
});
