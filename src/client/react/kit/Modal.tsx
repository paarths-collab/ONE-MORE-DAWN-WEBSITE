import type { ReactNode } from 'react';

export type ModalProps = {
  icon: string;
  title: string;
  onClose?: () => void;
  children: ReactNode;
};

/**
 * Bottom-sheet on phones, centered card on wider screens — mirrors the design
 * doc's overlay structure (header row + scrollable body).
 */
export function Modal({ icon, title, onClose, children }: ModalProps) {
  return (
    <div
      className="omd-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="omd-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="omd-sheet-head">
          <span className="omd-sheet-titlebox">
            <span style={{ fontSize: 20 }}>{icon}</span>
            <span className="omd-sheet-title">{title}</span>
          </span>
          {onClose !== undefined && (
            <button type="button" className="omd-sheet-x" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="omd-sheet-body">{children}</div>
      </div>
    </div>
  );
}
