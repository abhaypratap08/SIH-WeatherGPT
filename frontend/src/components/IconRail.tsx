import { CHAT_MARK_ICON, NAV_ITEMS } from '../config/navigation';
import type { NavPage } from '../config/navigation';

interface IconRailProps {
  activePage: NavPage | null; // null = chat is the primary view
  onNavigate: (page: NavPage) => void;
  onGoHome: () => void;
  userName?: string;
}

/**
 * Desktop icon rail: 64px, ink background, quiet single-color icons with a
 * monsoon-green active state. Chat is the app's primary view; the wordmark
 * mark returns to it. Nowcasting has no entry here (feature removed).
 */
export default function IconRail({
  activePage,
  onNavigate,
  onGoHome,
  userName = 'C',
}: IconRailProps) {
  const MarkIcon = CHAT_MARK_ICON;
  return (
    <nav className="rail" aria-label="Pages">
      <button
        type="button"
        className="mark"
        onClick={onGoHome}
        title="Chat, WeatherGPT home"
        aria-label="Back to chat"
      >
        <MarkIcon />
      </button>

      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={activePage === id ? 'active' : ''}
          onClick={() => onNavigate(id)}
          title={label}
          aria-label={label}
          aria-current={activePage === id ? 'page' : undefined}
        >
          <Icon />
        </button>
      ))}

      <div className="spacer" />

      <div className="avatar" title={userName} aria-hidden="true">
        {userName.charAt(0).toUpperCase()}
      </div>
    </nav>
  );
}