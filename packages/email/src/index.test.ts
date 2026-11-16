import { describe, expect, it } from "vitest";
import { actionEmail } from "./index";

describe("actionEmail", () => {
  it("escapes user-controlled text in the HTML body", () => {
    const message = actionEmail({
      to: "a@example.com",
      subject: "Invite",
      intro: 'Join <script>alert("x")</script>',
      actionLabel: "Accept",
      url: "https://app.example.com/invite?token=abc&x=1",
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("token=abc&amp;x=1");
    expect(message.text).toContain("https://app.example.com/invite?token=abc&x=1");
  });
});
