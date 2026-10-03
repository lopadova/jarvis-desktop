import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../i18n';
import { mockApproval } from '../../mocks';
import type { RiskLevel } from '../../types/ui';
import { ApprovalCard } from './ApprovalCard';
import { ListeningPill } from './ListeningPill';

const renderCard = (risk: RiskLevel, onDecision = vi.fn(), locale: 'en' | 'it' = 'en') =>
  render(
    <LocaleProvider locale={locale}>
      <ApprovalCard request={mockApproval(locale, risk, 0)} onDecision={onDecision} now={() => 0} />
    </LocaleProvider>,
  );

describe('ApprovalCard (security-model R2)', () => {
  it('high risk: click only — no always-allow, no voice hint, Deny focused', () => {
    renderCard('high');
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-risk', 'high');
    expect(screen.queryByRole('button', { name: /always allow/i })).toBeNull();
    expect(screen.getByTestId('approval-hint')).toHaveTextContent('Click to confirm');
    expect(screen.queryByText(/say “yes”/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus();
  });

  it.each(['low', 'medium'] as const)('%s risk: always-allow and voice hint available', (risk) => {
    renderCard(risk);
    expect(screen.getByRole('button', { name: /always allow in this project/i })).toBeInTheDocument();
    expect(screen.getByTestId('approval-hint')).toHaveTextContent('Say “yes” to allow');
    expect(screen.getByRole('alertdialog')).toHaveFocus();
  });

  it('emits decisions with the request id', () => {
    const onDecision = vi.fn();
    renderCard('medium', onDecision);
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    fireEvent.click(screen.getByRole('button', { name: /always allow/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDecision.mock.calls).toEqual([
      ['appr-medium', 'allow-once'],
      ['appr-medium', 'always-allow-project'],
      ['appr-medium', 'deny'],
    ]);
  });

  it('Escape denies', () => {
    const onDecision = vi.fn();
    renderCard('high', onDecision);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onDecision).toHaveBeenCalledWith('appr-high', 'deny');
  });

  it('shows the command in monospace and the countdown', () => {
    renderCard('high');
    expect(screen.getByText('rm -rf ~/Projects/shop/dist')).toHaveClass('font-mono');
    expect(screen.getByText(/Auto-deny in 120s/)).toBeInTheDocument();
  });

  it('is localised (Italian high-risk hint)', () => {
    renderCard('high', vi.fn(), 'it');
    expect(screen.getByTestId('approval-hint')).toHaveTextContent('Clicca per confermare');
    expect(screen.getByRole('button', { name: 'Nega' })).toHaveFocus();
  });

  it('is rendered inside the pill in the approval state', () => {
    const onApprovalDecision = vi.fn();
    render(
      <LocaleProvider locale="en">
        <ListeningPill
          state={{ kind: 'approval', request: mockApproval('en', 'low', 0) }}
          privateMode
          platform="win"
          onApprovalDecision={onApprovalDecision}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText('Local only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(onApprovalDecision).toHaveBeenCalledWith('appr-low', 'allow-once');
  });
});
