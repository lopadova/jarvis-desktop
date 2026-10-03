import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../i18n';
import { MockTransport } from '../ipc/mock';
import { applySnapshot, applyUiEvent, initialState } from '../store/reducer';
import type { ChatMessage } from '../types/ui';
import { SystemCard } from './home/Conversation';
import { ListeningPill } from './pill/ListeningPill';

const wrap = (locale: 'en' | 'it', ui: React.ReactNode) =>
  render(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);

const items = [
  { id: 'a', text: 'milk', createdAt: 1 },
  { id: 'b', text: 'eggs', createdAt: 2 },
];

describe('everyday UI', () => {
  it('reducer: ui.shopping, ui.navigate (seq bumps), ui.history (drops cleared messages)', () => {
    let s = initialState();
    s = applyUiEvent(s, 'ui.shopping', { items });
    expect(s.shopping).toEqual(items);
    s = applyUiEvent(s, 'ui.navigate', { view: 'memory' });
    s = applyUiEvent(s, 'ui.navigate', { view: 'memory' });
    expect(s.navigate).toEqual({ view: 'memory', seq: 2 });
    expect(applyUiEvent(s, 'ui.navigate', { view: 'nope' })).toBe(s);
    const msg = (id: string, at: number): ChatMessage => ({ id, role: 'jarvis', text: id, at, spoken: false });
    s = { ...s, chat: [msg('old', 10), msg('new', 100)] };
    s = applyUiEvent(s, 'ui.history', { since: 50 });
    expect(s.chat.map((m) => m.id)).toEqual(['old']);
    expect(applySnapshot(initialState(), { shopping: items }).shopping).toEqual(items);
  });

  it('shopping card: newest card lists the live items with remove buttons', () => {
    const onRemove = vi.fn();
    wrap(
      'en',
      <SystemCard
        card={{ type: 'shopping', items, added: ['eggs'] }}
        shoppingLive={items}
        onShoppingRemove={onRemove}
      />,
    );
    expect(screen.getByText('Shopping list')).toBeInTheDocument();
    expect(screen.getByText('Added eggs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove milk' }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('shopping card (IT, snapshot only): no remove buttons, empty state', () => {
    wrap('it', <SystemCard card={{ type: 'shopping', items: [] }} />);
    expect(screen.getByText('Lista della spesa')).toBeInTheDocument();
    expect(screen.getByText('La lista è vuota')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('text result card copies the full text and says it is not saved', () => {
    const onCopy = vi.fn();
    wrap(
      'en',
      <SystemCard card={{ type: 'text-result', source: 'clipboard', text: 'Ciao a tutti' }} onCopy={onCopy} />,
    );
    expect(screen.getByText('From your clipboard')).toBeInTheDocument();
    expect(screen.getByText('Not saved in history')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledWith('Ciao a tutti');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('briefing card shows empty columns explicitly', () => {
    wrap('en', <SystemCard card={{ type: 'briefing', weather: 'Sunny', events: [], emails: [] }} />);
    expect(screen.getAllByText('Nothing today')).toHaveLength(2);
  });

  it('pill shows the dictation state', () => {
    wrap(
      'it',
      <ListeningPill
        state={{ kind: 'listening', level: 0, partial: '', committed: '', dictation: true }}
        privateMode={false}
        platform="win"
      />,
    );
    expect(screen.getByText('Dettatura')).toBeInTheDocument();
    expect(screen.getByText('Parla, scrivo io. Esc per annullare')).toBeInTheDocument();
  });

  it('mock transport: the shopping chip adds an item and emits a card', async () => {
    const t = new MockTransport('en', 0);
    const events: [string, unknown][] = [];
    t.onNotification((m, p) => events.push([m, p]));
    await t.call('turn.submit', { text: 'Jarvis, add milk to the shopping list', source: 'chip' });
    expect(events.find(([m]) => m === 'ui.shopping')?.[1]).toMatchObject({ items: [{ text: 'milk' }] });
    await t.call('shopping.clear', {});
    expect(t.snapshot.shopping).toEqual([]);
    t.stop();
  });
});
