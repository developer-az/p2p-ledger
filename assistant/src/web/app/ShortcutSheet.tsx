import { useEffect, useId, useMemo, useRef } from 'react';
import './styles/palette.css';
import { SHORTCUTS, formatKeys, type Shortcut, type ShortcutGroup } from './shortcuts.js';
import { Icon } from './ui.js';

export interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
}

const GROUP_ORDER: readonly ShortcutGroup[] = ['General', 'Navigation'];

/** The cheat sheet, split into the groups the table declares. */
const GROUPS: readonly { group: ShortcutGroup; rows: readonly Shortcut[] }[] = GROUP_ORDER
  .map((group) => ({ group, rows: SHORTCUTS.filter((row) => row.group === group) }))
  .filter((entry) => entry.rows.length > 0);

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = agent.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Every shortcut, rendered from the table so the sheet cannot drift from the matcher. */
export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = `shortcut-title-${useId().replace(/:/g, '')}`;
  const isMac = useMemo(isMacPlatform, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      closeRef.current?.focus();
      return;
    }
    if (dialog.open) dialog.close();
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore !== null && restore.isConnected) restore.focus();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="app shortcut-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="shortcut-panel glass">
        <div className="shortcut-head">
          <h2 id={titleId} className="shortcut-title">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="shortcut-close"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="shortcut-body">
          {GROUPS.map((entry) => (
            <section key={entry.group} className="shortcut-group" aria-label={entry.group}>
              <p className="shortcut-group-label">{entry.group}</p>
              <dl className="shortcut-rows">
                {entry.rows.map((row) => (
                  <div key={row.id} className="shortcut-row">
                    <dt>{row.label}</dt>
                    <dd><kbd>{formatKeys(row.keys, isMac)}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
