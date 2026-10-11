import { useEffect, useRef } from 'react';

export function useDialogFocus(open) {
  const previous = useRef(null);
  useEffect(() => {
    if (open) return;
    const remember = event => { if (!event.target.closest('[role="dialog"]')) previous.current = event.target; };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return;
    const controls = () => [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
    if (!dialog.contains(document.activeElement)) controls()[0]?.focus();
    const keydown = event => {
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); if (previous.current?.isConnected) previous.current.focus(); };
  }, [open]);
}
