/** shadcn-style primitives on Radix, themed with the §4 tokens. */
import { Dialog as DialogPrimitive, Switch as SwitchPrimitive, Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

// ── Input ──
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-text placeholder:text-subtle focus-visible:border-accent',
        className,
      )}
      {...props}
    />
  );
}

// ── Badge ──
export function Badge({
  className,
  tone = 'neutral',
  children,
}: {
  className?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'private';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-surface-raised text-muted border-border',
    accent: 'bg-accent-soft text-accent border-transparent',
    success: 'text-success border-success/40',
    warning: 'text-warning border-warning/40',
    danger: 'text-danger border-danger/40',
    private: 'text-private border-private/40',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Progress ──
export function Progress({ value, label, tone }: { value: number; label: string; tone?: 'accent' | 'warning' | 'danger' }) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-accent';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
    >
      <div className={cn('h-full origin-left rounded-pill transition-transform', bar)} style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}

// ── Switch ──
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border border-border bg-surface-sunken transition-colors data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-pill bg-text shadow-sm transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-contrast" />
    </SwitchPrimitive.Root>
  );
}

// ── Tabs ──
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex gap-1 overflow-x-auto', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'h-8 shrink-0 rounded-pill px-3 text-sm text-muted transition-colors hover:text-text data-[state=active]:bg-accent-soft data-[state=active]:text-accent',
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

// ── Dialog ──
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  role,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-overlay" />
      <DialogPrimitive.Content
        role={role}
        className="fixed top-1/2 left-1/2 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-5 shadow-lg"
      >
        <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        <div className="mt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ── Field row (settings) ──
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-xs text-subtle">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
