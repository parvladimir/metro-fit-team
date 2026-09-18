import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildInviteEmail, buildInviteUrl, getSmtpConfig, sendMail } from './mail';

const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'a@gmail.com', SMTP_PASS: 'secret-pass', INVITE_EMAIL_FROM: 'METRO Fit Team <a@gmail.com>' };

describe('getSmtpConfig', () => {
  it('parses gmail SMTP settings', () => {
    expect(getSmtpConfig(env)).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, user: 'a@gmail.com', from: 'METRO Fit Team <a@gmail.com>' });
  });
  it('strips the spaces Google shows in app passwords', () => {
    expect(getSmtpConfig({ ...env, SMTP_PASS: 'abcd efgh ijkl mnop' })?.pass).toBe('abcdefghijklmnop');
  });
  it('is null when any credential is missing', () => {
    expect(getSmtpConfig({ ...env, SMTP_PASS: undefined })).toBeNull();
    expect(getSmtpConfig({})).toBeNull();
  });
  it('defaults the sender to the SMTP user', () => {
    expect(getSmtpConfig({ ...env, INVITE_EMAIL_FROM: undefined })?.from).toBe('a@gmail.com');
  });
});

describe('buildInviteUrl', () => {
  it('builds the canonical production URL', () => {
    expect(buildInviteUrl('https://metro-fit-team.vercel.app/', 'tok_en-1', true)).toBe('https://metro-fit-team.vercel.app/beitreten/tok_en-1');
  });
  it('refuses localhost / non-https URLs in production', () => {
    expect(() => buildInviteUrl('http://localhost:3000', 't', true)).toThrow();
    expect(() => buildInviteUrl('http://metro-fit-team.vercel.app', 't', true)).toThrow();
  });
  it('allows localhost outside production', () => {
    expect(buildInviteUrl('http://localhost:3000', 't', false)).toBe('http://localhost:3000/beitreten/t');
  });
});

describe('buildInviteEmail', () => {
  const mail = buildInviteEmail('METRO Marl Fitness Team', 'https://metro-fit-team.vercel.app/beitreten/abc');
  it('has German subject, html and text fallback with the link', () => {
    expect(mail.subject).toBe('Einladung zu METRO Marl Fitness Team');
    expect(mail.html).toContain('href="https://metro-fit-team.vercel.app/beitreten/abc"');
    expect(mail.text).toContain('https://metro-fit-team.vercel.app/beitreten/abc');
    expect(mail.text).toContain('Nach Anmeldung oder Registrierung wird deine Einladung automatisch fortgesetzt.');
  });
  it('escapes the team name in html', () => {
    expect(buildInviteEmail('<b>x</b>', 'https://x').html).not.toContain('<b>x</b>');
  });
});

describe('sendMail', () => {
  it('returns true when the transport accepts', async () => {
    const sendMailFn = vi.fn().mockResolvedValue({});
    expect(await sendMail({ to: 'x@y.de', subject: 's', html: 'h', text: 't' }, { sendMail: sendMailFn })).toBe(true);
    expect(sendMailFn).toHaveBeenCalledOnce();
  });
  it('swallows SMTP failures and never leaks the error to the caller', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = { sendMail: vi.fn().mockRejectedValue(new Error('535 auth failed')) };
    expect(await sendMail({ to: 'x@y.de', subject: 's', html: 'h', text: 't' }, failing)).toBe(false);
    spy.mockRestore();
  });
});

describe('env separation', () => {
  it('SMTP secrets are never exposed via NEXT_PUBLIC_ names', () => {
    const src = require('node:fs').readFileSync('.env.example', 'utf8') as string;
    expect(src).not.toMatch(/NEXT_PUBLIC_SMTP/);
    expect(src).not.toMatch(/NEXT_PUBLIC_.*PASS/);
  });
});
