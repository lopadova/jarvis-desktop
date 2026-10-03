/**
 * Tiny typed i18n: flat keys in `en.json` / `it.json` (brief §9). `en.json` is the key source of truth;
 * a test asserts both files have identical key sets. `{name}` placeholders are interpolated.
 */
import { createContext, type ReactNode, useCallback, useContext } from 'react';
import type { Locale } from '../types/ui';
import en from './en.json';
import it from './it.json';

export type MessageKey = keyof typeof en;
export type Vars = Record<string, string | number>;

const DICTS: Record<Locale, Record<string, string>> = { en, it };

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const raw = DICTS[locale][key] ?? en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export type T = (key: MessageKey, vars?: Vars) => string;

export function useT(): T {
  const locale = useLocale();
  return useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
}

export const dictionaries = DICTS;
