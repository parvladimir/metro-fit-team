import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Reads SMTP settings from server-only env vars; null when incomplete. */
export function getSmtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, INVITE_EMAIL_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 465);
  if (!Number.isInteger(port) || port <= 0) return null;
  return {
    host: SMTP_HOST,
    port,
    secure: SMTP_SECURE ? SMTP_SECURE === 'true' : port === 465,
    user: SMTP_USER,
    pass: SMTP_PASS.replace(/\s+/g, ''), // Google shows app passwords in groups of 4
    from: INVITE_EMAIL_FROM || SMTP_USER,
  };
}

export function isEmailConfigured(): boolean {
  return getSmtpConfig() !== null;
}

/** The invite link must always be the canonical app URL — a localhost or
 * non-https URL must never be mailed out from production. */
export function buildInviteUrl(appUrl: string, token: string, isProduction: boolean): string {
  const base = appUrl.replace(/\/+$/, '');
  if (isProduction && (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base))) {
    throw new Error('invalid_production_app_url');
  }
  return `${base}/beitreten/${encodeURIComponent(token)}`;
}

let cachedTransport: Transporter | null = null;
function getTransport(cfg: SmtpConfig): Transporter {
  cachedTransport ??= nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return cachedTransport;
}

/** Confirms the SMTP server accepts our credentials (no mail is sent). */
export async function verifySmtp(): Promise<boolean> {
  const cfg = getSmtpConfig();
  if (!cfg) return false;
  try {
    await getTransport(cfg).verify();
    return true;
  } catch (err) {
    console.error('[mail] smtp verify failed', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildInviteEmail(teamName: string, link: string): { subject: string; html: string; text: string } {
  const safeTeam = escapeHtml(teamName);
  const subject = `Einladung zu ${teamName}`;
  const text = [
    'Hallo,',
    '',
    `du wurdest eingeladen, dem Team „${teamName}“ beizutreten.`,
    '',
    'Team beitreten:',
    link,
    '',
    'Falls du noch kein Konto hast, kannst du dich zuerst registrieren.',
    'Nach Anmeldung oder Registrierung wird deine Einladung automatisch fortgesetzt.',
    '',
    'Diese Einladung ist nur für einen begrenzten Zeitraum gültig.',
    '',
    'Viele Grüße',
    'METRO Fit Team',
  ].join('\n');

  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#04141a;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e6f1f1">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0e2226;border-radius:20px;padding:32px">
<tr><td>
<p style="margin:0 0 16px;font-size:16px">Hallo,</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">du wurdest eingeladen, dem Team<br><strong>&bdquo;${safeTeam}&ldquo;</strong><br>beizutreten.</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#00d7f5;color:#00232a;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:16px">Team beitreten</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#8aa9ac;line-height:1.5">Falls du noch kein Konto hast, kannst du dich zuerst registrieren.</p>
<p style="margin:0 0 8px;font-size:14px;color:#8aa9ac;line-height:1.5">Nach Anmeldung oder Registrierung wird deine Einladung automatisch fortgesetzt.</p>
<p style="margin:0 0 24px;font-size:14px;color:#8aa9ac;line-height:1.5">Diese Einladung ist nur für einen begrenzten Zeitraum gültig.</p>
<p style="margin:0;font-size:16px">Viele Grüße<br>METRO Fit Team</p>
</td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}

/** Sends one mail over SMTP. Provider errors are logged (never the
 * credentials) and reduced to a boolean for the caller. */
export async function sendMail(
  params: { to: string; subject: string; html: string; text: string },
  transport?: Pick<Transporter, 'sendMail'>
): Promise<boolean> {
  const cfg = getSmtpConfig();
  if (!cfg && !transport) return false;
  try {
    const t = transport ?? getTransport(cfg!);
    await t.sendMail({ from: cfg?.from, to: params.to, subject: params.subject, html: params.html, text: params.text });
    return true;
  } catch (err) {
    console.error('[mail] send failed', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
    return false;
  }
}
