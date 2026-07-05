import type { ReactNode } from 'react';

export type ButtonProps = {
  children: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
};

/** Chunky board-game button (terracotta primary / parchment ghost). */
export function Button({ children, onClick, variant = 'primary', disabled, title }: ButtonProps) {
  return (
    <button
      type="button"
      className={`omd-btn omd-btn--${variant}`}
      onClick={onClick}
      disabled={disabled === true}
      {...(title !== undefined ? { title } : {})}
    >
      {children}
    </button>
  );
}
