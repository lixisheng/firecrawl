import { describe, expect, it } from "@jest/globals";

describe("Reporter output smoke tests", () => {
  it("surfaces intentional failure 1", () => {
    expect("intentional reporter failure 1").toBe("expected passing value");
  });

  it("surfaces intentional failure 2", () => {
    expect({
      actual: "intentional reporter failure 2",
    }).toEqual({
      actual: "expected passing value",
    });
  });
});
