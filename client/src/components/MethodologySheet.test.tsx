// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MethodologySheet, { getStoredReadingMode, READING_MODE_STORAGE_KEY } from "./MethodologySheet";

describe("MethodologySheet", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens an accessible methodology drawer and closes it again", async () => {
    const user = userEvent.setup();
    render(<MethodologySheet />);

    await user.click(screen.getByRole("button", { name: "開啟方法學說明" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("怎麼閱讀這些數字？")).toBeTruthy();
    expect(screen.getByText("折外驗證與時間序列")).toBeTruthy();
    expect(screen.getByText("Log-Loss：機率分配是否合理")).toBeTruthy();
    expect(screen.getByText("樣本數警示與分組解讀")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "初學者模式" }).getAttribute("data-state")).toBe("on");
    expect(screen.queryByText("Log-Loss = −(1 / N) × Σ log(pᵢ, yᵢ)")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "進階模式" }));
    expect(screen.getByRole("radio", { name: "進階模式" }).getAttribute("data-state")).toBe("on");
    await user.click(screen.getByRole("button", { name: "Log-Loss：機率分配是否合理" }));
    expect(screen.getByText("Log-Loss = −(1 / N) × Σ log(pᵢ, yᵢ)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "進階術語表" }));
    expect(screen.getByText("Dixon–Coles")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: "初學者模式" }));
    expect(screen.queryByText("Log-Loss = −(1 / N) × Σ log(pᵢ, yᵢ)")).toBeNull();
    expect(screen.queryByText("Dixon–Coles")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("persists the selected reading mode and restores it after remount", async () => {
    const user = userEvent.setup();
    const firstRender = render(<MethodologySheet />);
    await user.click(screen.getByRole("button", { name: "開啟方法學說明" }));
    await user.click(screen.getByRole("radio", { name: "進階模式" }));
    expect(localStorage.getItem(READING_MODE_STORAGE_KEY)).toBe("advanced");

    firstRender.unmount();
    render(<MethodologySheet />);
    await user.click(screen.getByRole("button", { name: "開啟方法學說明" }));
    expect(screen.getByRole("radio", { name: "進階模式" }).getAttribute("data-state")).toBe("on");
    expect(screen.getByText("Train(t₁ … tₖ) → Test(tₖ₊₁ … tₙ)")).toBeTruthy();
  });

  it("falls back to beginner mode for invalid or unavailable storage", async () => {
    localStorage.setItem(READING_MODE_STORAGE_KEY, "not-a-mode");
    expect(getStoredReadingMode()).toBe("beginner");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    expect(getStoredReadingMode()).toBe("beginner");
  });
});
