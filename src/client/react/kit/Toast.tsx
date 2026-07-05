import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastItem = { id: number; text: string };

export type ToastApi = {
  toasts: ToastItem[];
  push: (text: string) => void;
};

const TOAST_MS = 2600;

/** Queue of transient ink-dark toasts; auto-expire after ~2.6s. */
export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const push = useCallback((text: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    timers.current.push(
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, TOAST_MS),
    );
  }, []);

  return { toasts, push };
}

export function ToastLayer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="omd-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="omd-toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
