/**
 * Outgoing email. Production sends through Resend's HTTP API when RESEND_API_KEY and MAIL_FROM are
 * set (no SDK needed). Without them, development prints the message to the server log so the
 * password-reset flow can be tried locally; production logs only that mail is not configured.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** False when messages go nowhere a user can read them. */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

export class ResendMailer implements Mailer {
  readonly delivers = true;
  constructor(private readonly apiKey: string, private readonly from: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async send(message: MailMessage): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`email provider answered ${res.status}`);
  }
}

export class LogMailer implements Mailer {
  readonly delivers = false;
  constructor(private readonly production: boolean) {}

  async send(message: MailMessage): Promise<void> {
    if (this.production) {
      console.warn('[mail] RESEND_API_KEY / MAIL_FROM are not set; a password-reset email was not sent.');
      return;
    }
    console.info(`[mail] (dev, not sent) to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

/** Test double: keeps what would have been sent. */
export class MemoryMailer implements Mailer {
  readonly delivers = true;
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (key && from) return new ResendMailer(key, from);
  return new LogMailer(env.NODE_ENV === 'production' || !!env.VERCEL_ENV);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function passwordResetEmail(to: string, name: string, link: string, minutes: number): MailMessage {
  const text = [
    `Hi ${name},`,
    '',
    'Someone asked to reset the password for your Settle account. If it was you, open this link to choose a new one:',
    link,
    '',
    `The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email; your password stays the same.`,
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>Someone asked to reset the password for your Settle account. If it was you, choose a new one here:</p>
<p><a href="${escapeHtml(link)}">Reset my password</a></p>
<p>The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email; your password stays the same.</p>`;
  return { to, subject: 'Reset your Settle password', text, html };
}
