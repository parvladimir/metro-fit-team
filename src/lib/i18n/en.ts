import type { TranslationKey } from './de';

// Partial on purpose: any key missing here falls back to German (see
// ./index.ts). This is scaffolding for a future language switch — v1 ships
// with German as the only selectable UI language.
export const en: Partial<Record<TranslationKey, string>> = {
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.back': 'Back',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong.',
  'common.retry': 'Retry',
  'common.confirm': 'Confirm',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copied': 'Copied!',
  'common.optional': 'Optional',
  'common.minutes': 'min',
  'common.points': 'points',
  'common.today': 'Today',

  'nav.home': 'Home',
  'nav.plan': 'Plan',
  'nav.activity': 'Activity',
  'nav.team': 'Team',
  'nav.profile': 'Profile',
  'nav.startWorkout': 'Start workout',

  'auth.signIn.title': 'Sign in',
  'auth.signIn.submit': 'Sign in',
  'auth.signIn.noAccount': "Don't have an account?",
  'auth.signIn.createAccount': 'Create one',
  'auth.signIn.forgotPassword': 'Forgot password?',
  'auth.signUp.title': 'Sign up',
  'auth.signUp.submit': 'Create account',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.signOut': 'Sign out',

  'dashboard.yourWeek': 'Your week',
  'dashboard.yourTeam': 'Your team',
  'dashboard.today': 'Today',
  'dashboard.startWorkout': 'Start workout',
};
