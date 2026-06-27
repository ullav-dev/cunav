import {
  hasCunavAccess,
  getCunavTeamIds,
  getAweTeamIds,
  isAdmin,
  hasSupportRole,
} from "../auth-api";

/** Build a fake JWT with the given payload (no real signature — these functions only decode). */
function fakeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

const teamWithCunav = { products: ["cunav", "obair"] };
const teamWithObairOnly = { products: ["obair"] };
const teamWithSupport = { products: ["cunav"], product_roles: { cunav: "support" } };
const teamNoProducts = { products: [] };

describe("hasCunavAccess", () => {
  it("returns true when any team has cunav product", () => {
    const token = fakeToken({ teams: { "team-1": teamWithCunav } });
    expect(hasCunavAccess(token)).toBe(true);
  });

  it("returns false when no team has cunav product", () => {
    const token = fakeToken({ teams: { "team-1": teamWithObairOnly } });
    expect(hasCunavAccess(token)).toBe(false);
  });

  it("returns false for null token", () => {
    expect(hasCunavAccess(null)).toBe(false);
  });

  it("returns false for malformed token", () => {
    expect(hasCunavAccess("not.a.token")).toBe(false);
  });
});

describe("getCunavTeamIds", () => {
  it("returns IDs of teams with cunav access", () => {
    const token = fakeToken({
      teams: {
        "team-1": teamWithCunav,
        "team-2": teamWithObairOnly,
        "team-3": { products: ["cunav"] },
      },
    });
    expect(getCunavTeamIds(token).sort()).toEqual(["team-1", "team-3"]);
  });

  it("returns empty array when no teams have cunav", () => {
    const token = fakeToken({ teams: { "team-1": teamNoProducts } });
    expect(getCunavTeamIds(token)).toEqual([]);
  });

  it("returns empty array for null token", () => {
    expect(getCunavTeamIds(null)).toEqual([]);
  });
});

describe("getAweTeamIds", () => {
  it("returns IDs of teams with obair product (required for awe-server)", () => {
    const token = fakeToken({
      teams: {
        "team-1": teamWithCunav,      // has obair
        "team-2": { products: ["cunav"] }, // no obair
        "team-3": teamWithObairOnly,  // has obair
      },
    });
    expect(getAweTeamIds(token).sort()).toEqual(["team-1", "team-3"]);
  });

  it("returns empty array for null token", () => {
    expect(getAweTeamIds(null)).toEqual([]);
  });
});

describe("isAdmin", () => {
  it("returns true when roles includes admin", () => {
    const token = fakeToken({ roles: ["admin", "user"] });
    expect(isAdmin(token)).toBe(true);
  });

  it("returns false when roles does not include admin", () => {
    const token = fakeToken({ roles: ["user"] });
    expect(isAdmin(token)).toBe(false);
  });

  it("returns false when roles is absent", () => {
    const token = fakeToken({});
    expect(isAdmin(token)).toBe(false);
  });

  it("returns false for null token", () => {
    expect(isAdmin(null)).toBe(false);
  });
});

describe("hasSupportRole", () => {
  it("returns true when any team has cunav support role", () => {
    const token = fakeToken({ teams: { "team-1": teamWithSupport } });
    expect(hasSupportRole(token)).toBe(true);
  });

  it("returns false when cunav role is not support", () => {
    const token = fakeToken({
      teams: { "team-1": { products: ["cunav"], product_roles: { cunav: "member" } } },
    });
    expect(hasSupportRole(token)).toBe(false);
  });

  it("returns false when product_roles is absent", () => {
    const token = fakeToken({ teams: { "team-1": teamWithCunav } });
    expect(hasSupportRole(token)).toBe(false);
  });

  it("returns false for null token", () => {
    expect(hasSupportRole(null)).toBe(false);
  });
});
