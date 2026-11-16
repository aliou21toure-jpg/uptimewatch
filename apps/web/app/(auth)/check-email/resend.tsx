"use client";
import { Alert, Button } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { useState } from "react";

export function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return (
    <div className="mt-4 flex flex-col gap-3">
      {state === "sent" && <Alert tone="success">A new link is on its way.</Alert>}
      {state === "error" && <Alert>Could not send a new link right now. Try again in a few minutes.</Alert>}
      <Button
        variant="secondary"
        disabled={state === "sending" || state === "sent"}
        onClick={async () => {
          setState("sending");
          const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/app" });
          setState(error ? "error" : "sent");
        }}
      >
        Resend the link
      </Button>
    </div>
  );
}
