import { getEmailEnv } from "@uptimewatch/config";
import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendOptions {
  /** Same key → the provider sends the email at most once, even if we retry after a timeout. */
  idempotencyKey?: string;
}

export interface EmailSender {
  send(message: EmailMessage, options?: SendOptions): Promise<{ id: string | null }>;
}

export function createResendSender(apiKey: string, from: string): EmailSender {
  const resend = new Resend(apiKey);
  return {
    async send(message, options = {}) {
      const { data, error } = await resend.emails.send(
        { from, ...message },
        options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {},
      );
      if (error) throw new Error(`Email provider rejected the message: ${error.name}`);
      return { id: data?.id ?? null };
    },
  };
}

/**
 * Development transport: prints the message so links can be opened locally.
 * In production it is only used when EMAIL_TRANSPORT=console is set explicitly.
 */
export function createConsoleSender(): EmailSender {
  return {
    async send(message) {
      console.info(
        `\n[email:dev] to=${message.to}\n[email:dev] subject=${message.subject}\n${message.text}\n`,
      );
      return { id: null };
    },
  };
}

let sender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (!sender) {
    const env = getEmailEnv();
    sender =
      env.EMAIL_TRANSPORT === "resend" && env.RESEND_API_KEY
        ? createResendSender(env.RESEND_API_KEY, env.EMAIL_FROM)
        : createConsoleSender();
  }
  return sender;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Builds a minimal message with one call-to-action link, in both text and HTML. */
export function actionEmail(input: {
  to: string;
  subject: string;
  intro: string;
  actionLabel: string;
  url: string;
  outro?: string;
}): EmailMessage {
  const outro = input.outro ?? "If you did not expect this email, you can ignore it.";
  return {
    to: input.to,
    subject: input.subject,
    text: `${input.intro}\n\n${input.actionLabel}: ${input.url}\n\n${outro}`,
    html: `<p>${escapeHtml(input.intro)}</p><p><a href="${escapeHtml(input.url)}">${escapeHtml(
      input.actionLabel,
    )}</a></p><p style="color:#666">${escapeHtml(outro)}</p>`,
  };
}
