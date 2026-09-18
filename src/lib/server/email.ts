import 'server-only';
import { getServerEnv } from '@/lib/env';

export function isEmailConfigured(): boolean {
  return !!getServerEnv().resendApiKey;
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
    'Über den folgenden Link kannst du die Einladung annehmen:',
    link,
    '',
    'Falls du noch kein Konto hast, kannst du dich zuerst registrieren.',
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
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">du wurdest eingeladen, dem Team <strong>&bdquo;${safeTeam}&ldquo;</strong> beizutreten.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">Über den folgenden Link kannst du die Einladung annehmen:</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#00d7f5;color:#00232a;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:16px">Team beitreten</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#8aa9ac;line-height:1.5">Falls du noch kein Konto hast, kannst du dich zuerst registrieren.</p>
<p style="margin:0 0 24px;font-size:14px;color:#8aa9ac;line-height:1.5">Diese Einladung ist nur für einen begrenzten Zeitraum gültig.</p>
<p style="margin:0;font-size:16px">Viele Grüße<br>METRO Fit Team</p>
</td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}

/** Sends one transactional mail through Resend's HTTP API. Secrets stay
 * server-side; provider errors are logged (without the key) and reduced to a
 * boolean for the caller. */
export async function sendEmail(params: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  const { resendApiKey, inviteEmailFrom } = getServerEnv();
  if (!resendApiKey) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: inviteEmailFrom, to: [params.to], subject: params.subject, html: params.html, text: params.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('[email] provider rejected message', res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send failed', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}
