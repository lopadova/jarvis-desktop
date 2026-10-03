import { allSuggestions } from '@jarvis/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../i18n';
import type { Suggestion, SuggestionCategory } from '../../types/ui';
import { SuggestionGrid } from './SuggestionGrid';

function Harness({ onPick, forYou }: { onPick(s: Suggestion): void; forYou?: Suggestion[] }) {
  const [cat, setCat] = useState<SuggestionCategory | 'for-you'>('for-you');
  return <SuggestionGrid suggestions={allSuggestions('en')} forYou={forYou} activeCategory={cat} onCategoryChange={setCat} onPick={onPick} />;
}

describe('SuggestionGrid', () => {
  it('shows a For you tab plus one tab per category present', () => {
    render(
      <LocaleProvider locale="en">
        <Harness onPick={vi.fn()} />
      </LocaleProvider>,
    );
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs[0]).toBe('For you');
    expect(tabs).toContain('Developer');
    expect(tabs).toContain('Home & family');
    expect(screen.getByRole('tab', { name: 'For you' })).toHaveAttribute('aria-selected', 'true');
  });

  it('filters by category and shows the spoken equivalent', () => {
    render(
      <LocaleProvider locale="en">
        <Harness onPick={vi.fn()} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Reminders' }));
    expect(screen.getByRole('button', { name: /Set a timer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Morning briefing/ })).toBeNull();
    expect(screen.getByText('Say: “Jarvis, timer for 10 minutes”')).toBeInTheDocument();
  });

  it('picking a chip reports the suggestion (its utterance is what gets submitted)', () => {
    const onPick = vi.fn();
    const forYou = allSuggestions('en').filter((s) => s.category === 'reminders');
    render(
      <LocaleProvider locale="en">
        <Harness onPick={onPick} forYou={forYou} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Set a timer/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'timer', utterance: 'Jarvis, timer for 10 minutes' }));
  });

  it('renders Italian labels', () => {
    render(
      <LocaleProvider locale="it">
        <SuggestionGrid suggestions={allSuggestions('it')} activeCategory="reminders" onCategoryChange={vi.fn()} onPick={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Per te' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Imposta un timer/ })).toBeInTheDocument();
  });
});
