import { expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import VideoProgressPanel from "../../src/components/VideoProgressPanel";
test("resume uses saved position separately from unique watched percentage", () => {
  const resume = vi.fn(),
    retry = vi.fn();
  render(
    <VideoProgressPanel
      progress={{
        duration_ms: 1200000,
        position_ms: 900000,
        watched_ms: 300000,
        watched_percent: 25,
        intervals: [{ start_ms: 0, end_ms: 300000 }],
      }}
      currentMs={920000}
      saving={false}
      error="Network"
      onResume={resume}
      onRetry={retry}
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "25",
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Kaldığın yerden devam et/ }),
  );
  expect(resume).toHaveBeenCalledWith(900000);
  fireEvent.click(screen.getByRole("button", { name: "Tekrar kaydet" }));
  expect(retry).toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Kaydedilemedi");
});
