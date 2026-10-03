import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../i18n';
import { mockSessions } from '../mocks';
import { applyUiEvent, initialState } from '../store/reducer';
import type { SessionView } from '../types/ui';
import { ListeningPill } from './pill/ListeningPill';
import { SessionCard } from './sessions/SessionCard';
import { SessionsPanel } from './sessions/SessionsPanel';
import { PermissionLevelControl } from './settings/controls';

const en = (ui: React.ReactNode) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('SessionCard', () => {
  it('shows status-specific actions (done → Open result + Log, dismissable)', () => {
    const [, done] = mockSessions('en', 0);
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    en(<SessionCard session={done as SessionView} locale="en" onOpen={onOpen} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /Open result/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onOpen).toHaveBeenCalledWith('s-done');
    expect(onDismiss).toHaveBeenCalledWith('s-done');
  });

  it('an approval session offers Review and Stop; needs-input offers an inline reply', () => {
    const base = mockSessions('en', 0)[0] as SessionView;
    const onReview = vi.fn();
    const onReply = vi.fn();
    const { unmount } = en(<SessionCard session={{ ...base, status: 'approval' }} locale="en" onReview={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    expect(onReview).toHaveBeenCalledWith('s-run');
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument();
    unmount();
    en(<SessionCard session={{ ...base, status: 'needs-input' }} locale="en" onReply={onReply} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'Under 1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('s-run', 'Under 1500');
  });

  it('the panel counts running sessions and shows the empty state', () => {
    const { unmount } = en(<SessionsPanel sessions={mockSessions('en', 0)} locale="en" />);
    expect(screen.getByText('1 running')).toBeInTheDocument();
    unmount();
    en(<SessionsPanel sessions={[]} locale="en" />);
    expect(screen.getByText('Nothing running.')).toBeInTheDocument();
  });
});

describe('PermissionLevelControl (R1)', () => {
  it('Full auto needs an explicit, checked confirmation', () => {
    const onChange = vi.fn();
    en(<PermissionLevelControl value="safe" project="shop" label="Permission" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Full auto/ }));
    expect(onChange).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Turn on Full auto for shop?');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const confirm = screen.getByRole('button', { name: 'Turn on Full auto' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand the risk' }));
    fireEvent.click(confirm);
    expect(onChange).toHaveBeenCalledWith('full-auto');
  });

  it('lower levels apply immediately', () => {
    const onChange = vi.fn();
    en(<PermissionLevelControl value="safe" project="shop" label="Permission" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Trusted/ }));
    expect(onChange).toHaveBeenCalledWith('trusted');
  });
});

describe('ListeningPill', () => {
  it('speaking shows a stop affordance and the chip; private mode shows Local only', () => {
    const onStop = vi.fn();
    en(
      <ListeningPill
        state={{ kind: 'speaking', text: 'Ten minutes, starting now.', progress: 0.5, level: 0.4 }}
        privateMode
        platform="mac"
        onStop={onStop}
      />,
    );
    expect(screen.getByText('Speaking')).toBeInTheDocument();
    expect(screen.getByText('Local only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('clarify offers quick replies', () => {
    const onQuickReply = vi.fn();
    en(
      <ListeningPill
        state={{ kind: 'clarify', question: 'Which two laptops?', quickReplies: ['MacBook Air vs XPS 13'] }}
        privateMode={false}
        platform="win"
        onQuickReply={onQuickReply}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'MacBook Air vs XPS 13' }));
    expect(onQuickReply).toHaveBeenCalledWith('MacBook Air vs XPS 13');
  });
});

describe('reducer: approval decisions', () => {
  it('records resolved decisions for the chat cards', () => {
    const s = applyUiEvent(initialState(), 'ui.approval', {
      pending: [],
      state: 'resolved',
      id: 'appr-1',
      decision: 'deny',
      via: 'click',
    });
    expect(s.resolved).toEqual({ 'appr-1': 'deny' });
  });
});
