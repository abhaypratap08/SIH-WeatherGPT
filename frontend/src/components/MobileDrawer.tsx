import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { NAV_ITEMS } from '../config/navigation';
import type { NavPage } from '../config/navigation';

interface MobileDrawerProps {
  open: boolean;
  activePage: NavPage | null;
  onNavigate: (page: NavPage) => void;
  onClose: () => void;
  userName?: string;
}

/**
 * Mobile navigation drawer — the rail's counterpart on small screens.
 * Slides in from the right with an overlay; monsoon-green active state.
 */
export default function MobileDrawer({
  open,
  activePage,
  onNavigate,
  onClose,
  userName = 'C',
}: MobileDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open; close on Escape.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`drawer-overlay ${open ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`drawer ${open ? 'open' : ''}`}
        aria-label="Pages"
        inert={!open}
      >
        <div className="drawer-header">
          <span className="drawer-title">WeatherGPT</span>
          <button
            ref={closeRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>

        <nav className="drawer-nav">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`drawer-nav-item ${activePage === id ? 'active' : ''}`}
              onClick={() => {
                onNavigate(id);
                onClose();
              }}
              aria-current={activePage === id ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="drawer-footer">
          <div className="drawer-avatar" aria-hidden="true">
            {userName.charAt(0).toUpperCase()}
          </div>
        </div>
      </aside>
    </>
  );
}