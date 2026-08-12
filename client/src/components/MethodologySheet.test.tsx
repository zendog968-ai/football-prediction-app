// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import MethodologySheet from "./MethodologySheet";

describe("MethodologySheet", () => {
  afterEach(() => cleanup());

  it("opens an accessible methodology drawer and closes it again", async () => {
    const user = userEvent.setup();
    render(<MethodologySheet />);

    await user.click(screen.getByRole("button", { name: "開啟方法學說明" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("怎麼閱讀這些數字？")).toBeTruthy();
    expect(screen.getByText("什麼是折外驗證？")).toBeTruthy();
    expect(screen.getByText("Log-Loss：機率分配是否合理")).toBeTruthy();
    expect(screen.getByText("樣本數警示：為何要保留？")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
