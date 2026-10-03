/** Suggestion chips grouped by category tabs (+ "For you"). Clicking a chip = speaking it. */
import type { SuggestionCategory } from '@jarvis/core';
import { useMemo } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { Suggestion, SuggestionGridProps } from '../../types/ui';
import { Icon } from '../common/Icon';

export const CATEGORIES: SuggestionCategory[] = [
  'day',
  'reminders',
  'writing',
  'screen',
  'files',
  'web',
  'home',
  'developer',
  'memory',
  'privacy',
];

export function SuggestionChip({
  suggestion,
  onPick,
  compact,
  disabled,
}: {
  suggestion: Suggestion;
  onPick(s: Suggestion): void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(suggestion)}
      className={cn(
        'group flex min-h-11 w-full items-start gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-md active:scale-[0.98] disabled:opacity-50',
        compact && 'min-h-8 p-2',
      )}
    >
      <span className="mt-0.5 text-accent">
        <Icon name={suggestion.icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{suggestion.label}</span>
        {compact ? null : (
          <span className="block truncate text-xs text-subtle">
            {t('chip.say', { utterance: suggestion.utterance })}
          </span>
        )}
      </span>
    </button>
  );
}

export function SuggestionGrid({
  suggestions,
  activeCategory,
  onCategoryChange,
  onPick,
  forYou,
}: SuggestionGridProps & { forYou?: Suggestion[] }) {
  const t = useT();
  const present = useMemo(() => new Set(suggestions.map((s) => s.category)), [suggestions]);
  const tabs: (SuggestionCategory | 'for-you')[] = ['for-you', ...CATEGORIES.filter((c) => present.has(c))];
  const shown =
    activeCategory === 'for-you'
      ? (forYou ?? suggestions).slice(0, 12)
      : suggestions.filter((s) => s.category === activeCategory);

  return (
    <section aria-label={t('home.suggestions')} className="flex flex-col gap-3">
      <div role="tablist" aria-label={t('home.categories')} className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={activeCategory === c}
            onClick={() => onCategoryChange(c)}
            className={cn(
              'h-8 shrink-0 rounded-pill px-3 text-sm transition-colors',
              activeCategory === c ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text',
            )}
          >
            {t(`category.${c}` as MessageKey)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
        {shown.map((s) => (
          <SuggestionChip key={s.id} suggestion={s} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}
