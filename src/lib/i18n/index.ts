import { de } from './de';
import { en } from './en';
import { ru } from './ru';
import type { TranslationKey } from './de';

export type { TranslationKey };
export type Locale = 'de' | 'en' | 'ru';

const dictionaries: Record<Locale, Partial<Record<TranslationKey, string>>> = { de, en, ru };

export const SUPPORTED_LOCALES: Locale[] = ['de', 'en', 'ru'];

/**
 * Translate a key for the given locale, falling back to German (the
 * source-of-truth dictionary) for any key not yet translated. All
 * user-facing strings MUST go through this function — never hardcode UI
 * text directly in a component.
 */
export function t(key: TranslationKey, params?: Record<string, string | number>, locale: Locale = 'de'): string {
  const dict = dictionaries[locale] ?? de;
  let value: string = dict[key] ?? de[key] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(paramValue));
    }
  }

  return value;
}

export function createTranslator(locale: Locale) {
  return (key: TranslationKey, params?: Record<string, string | number>) => t(key, params, locale);
}
