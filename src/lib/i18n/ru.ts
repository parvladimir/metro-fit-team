import type { TranslationKey } from './de';

// Partial on purpose — see en.ts.
export const ru: Partial<Record<TranslationKey, string>> = {
  'nav.home': 'Главная',
  'nav.plan': 'План',
  'nav.activity': 'Активность',
  'nav.team': 'Команда',
  'nav.profile': 'Профиль',
  'nav.startWorkout': 'Начать тренировку',

  'auth.signIn.title': 'Вход',
  'auth.signIn.submit': 'Войти',
  'auth.signUp.title': 'Регистрация',
  'auth.signUp.submit': 'Создать аккаунт',
  'auth.email': 'Электронная почта',
  'auth.password': 'Пароль',
  'auth.signOut': 'Выйти',

  'common.save': 'Сохранить',
  'common.cancel': 'Отмена',
  'common.loading': 'Загрузка…',
};
