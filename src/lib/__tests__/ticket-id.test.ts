import { ticketId } from "../ticket-id";

describe("ticketId", () => {
  it("formats a number with default prefix and 4-digit padding", () => {
    expect(ticketId(1)).toBe("TKT-0001");
  });

  it("pads numbers shorter than 4 digits", () => {
    expect(ticketId(42)).toBe("TKT-0042");
    expect(ticketId(999)).toBe("TKT-0999");
  });

  it("does not truncate numbers longer than 4 digits", () => {
    expect(ticketId(10000)).toBe("TKT-10000");
  });

  it("returns em dash for null", () => {
    expect(ticketId(null)).toBe("—");
  });

  it("returns em dash for undefined", () => {
    expect(ticketId(undefined)).toBe("—");
  });

  it("returns em dash for 0 (falsy)", () => {
    expect(ticketId(0)).toBe("—");
  });
});
