/** In-window toasts (handoff: 360 wide, bottom-right of the window card). */
import { useEffect } from 'react';
import { Toast } from '../components/common/common';
import { useMotion } from '../lib/motion';
import { useApp } from '../store/app';

export function Toasts({ bottom = 104 }: { bottom?: number }) {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const anim = useMotion();
  useEffect(() => {
    const first = toasts[0];
    if (!first) return;
    const id = setTimeout(() => dismiss(first.id), 6000);
    return () => clearTimeout(id);
  }, [toasts, dismiss]);
  if (toasts.length === 0) return null;
  return (
    <ol
      aria-live="polite"
      className="absolute right-5 z-[6] m-0 flex max-w-[calc(100%-40px)] list-none flex-col gap-2 p-0"
      style={{ bottom }}
    >
      {toasts.map((toast) => (
        <li key={toast.id}>
          <Toast
            level={toast.level}
            title={toast.title}
            body={toast.body}
            onClose={() => dismiss(toast.id)}
            style={{ animation: anim ? 'jv-toast-in 240ms var(--ease-standard)' : 'none' }}
          />
        </li>
      ))}
    </ol>
  );
}
