import { describe, expect, it } from "vitest";
import { createInvitationInput, slugify } from "./schemas";

describe("slugify", () => {
  it("normalises accents, case and punctuation", () => {
    expect(slugify("Café Société & Co!")).toBe("cafe-societe-co");
  });
  it("pads very short names so they stay valid", () => {
    expect(slugify("A")).toBe("org-a");
    expect(slugify("!!!")).toBe("org-new");
  });
});

describe("createInvitationInput", () => {
  it("lower-cases emails and refuses the owner role", () => {
    expect(createInvitationInput.parse({ email: " Bob@Example.COM ", role: "member" }).email).toBe(
      "bob@example.com",
    );
    expect(() => createInvitationInput.parse({ email: "a@b.co", role: "owner" })).toThrow();
  });
});
