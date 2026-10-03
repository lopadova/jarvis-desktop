/** Suggestion chips grouped by category tabs (+ "For you"). Clicking a chip = speaking it. */
import type { SuggestionCategory } from '@jarvis/core';
import { useMemo } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { Suggestion, SuggestionGridProps } from '../../types/ui';
import { Icon, SUGGESTION_ICON } from '../common/Icon';

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
  disabled,
}: {
  suggestion: Suggestion;
  onPick(s: Suggestion): void;
  disabled?: boolean;
}) {
  const t = useT();
  const say = t('chip.say', { utterance: suggestion.utterance });
  return (
    <button
      type="button"
      disabled={disabled}
      title={say}
      onClick={() => onPick(suggestion)}
      className="box-border flex min-h-16 min-w-0 cursor-pointer flex-col items-stretch gap-1.5 rounded-[12px] border border-border bg-surface-raised px-3 py-2.5 text-left transition-[transform,box-shadow,border-color] duration-[160ms] ease-standard hover:-translate-y-px hover:border-border-strong hover:shadow-md active:scale-[.98] disabled:cursor-default disabled:opacity-45"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] bg-accent-soft text-accent">
          <Icon name={SUGGESTION_ICON[suggestion.id] ?? suggestion.icon} size={14} />
        </span>
        <span className="truncate text-[13px] font-semibold text-text">{suggestion.label}</span>
      </span>
      <span className="truncate text-left text-[11.5px] text-subtle">{say}</span>
    </button>
  );
}

export function SuggestionGrid({
  suggestions,
  activeCategory,
  onCategoryChange,
  onPick,
  forYou,
  disabled,
}: SuggestionGridProps & { forYou?: Suggestion[]; disabled?: boolean }) {
  const t = useT();
  const present = useMemo(() => new Set(suggestions.map((s) => s.category)), [suggestions]);
  const tabs: (SuggestionCategory | 'for-you')[] = ['for-you', ...CATEGORIES.filter((c) => present.has(c))];
  const shown =
    activeCategory === 'for-you'
      ? (forYou ?? suggestions).slice(0, 12)
      : suggestions.filter((s) => s.category === activeCategory);

  return (
    <section aria-label={t('home.suggestions')} className="flex flex-col gap-3">
      <div role="tablist" aria-label={t('home.categories')} className="no-scrollbar flex gap-1 overflow-x-auto pb-0.5">
        {tabs.map((c) => {
          const on = activeCategory === c;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onCategoryChange(c)}
              className={cn(
                'h-[30px] shrink-0 cursor-pointer rounded-pill border px-3 text-[12.5px] whitespace-nowrap hover:text-text',
                on
                  ? 'border-border-strong bg-surface-raised font-semibold text-text'
                  : 'border-transparent bg-transparent font-medium text-muted',
              )}
            >
              {t(`category.${c}` as MessageKey)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
        {shown.map((s) => (
          <SuggestionChip key={s.id} suggestion={s} onPick={onPick} disabled={disabled} />
        ))}
      </div>
    </section>
  );
}
