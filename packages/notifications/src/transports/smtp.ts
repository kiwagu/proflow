import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import type { EmailTransport } from '../types.js';

export type SmtpTransportOptions = {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
};

function parseBooleanEnv(v: string | undefined): boolean | undefined {
  if (v === undefined) {
    return undefined;
  }
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') {
    return true;
  }
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') {
    return false;
  }
  return undefined;
}

export class SmtpEmailTransport implements EmailTransport {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(options: SmtpTransportOptions) {
    this.from = options.from;
    const auth =
      options.user !== undefined && options.user !== ''
        ? { user: options.user, pass: options.pass ?? '' }
        : undefined;
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? options.port === 465,
      ...(auth ? { auth } : {}),
    });
  }

  async send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }
}

function env(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined;
  }
  const v = process.env[name];
  return v === '' ? undefined : v;
}

/**
 * Builds SMTP transport from process.env (Node/Bun).
 * Expected: SMTP_HOST, SMTP_PORT, SMTP_USER (optional), SMTP_PASS (optional),
 * SMTP_FROM (or SMTP_ADMIN_EMAIL).
 */
export function createSmtpTransportFromEnv(): SmtpEmailTransport {
  const host = env('SMTP_HOST');
  const portRaw = env('SMTP_PORT');
  const from = env('SMTP_FROM') ?? env('SMTP_ADMIN_EMAIL');
  const secure = parseBooleanEnv(env('SMTP_SECURE'));
  if (!host || !portRaw || !from) {
    throw new Error(
      'SMTP_HOST, SMTP_PORT, and SMTP_FROM (or SMTP_ADMIN_EMAIL) are required'
    );
  }
  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    throw new Error('SMTP_PORT must be a number');
  }
  return new SmtpEmailTransport({
    host,
    port,
    secure,
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from,
  });
}
