import { MapPin, Menu, Moon, Sun, X } from 'lucide-react';
import type { ThemeMode } from '../hooks/useTheme';
import type { LocationState } from '../location/LocationContext';

interface AppHeaderProps {
  locationName: string | null;
  locationStatus: LocationState['status'];
  lang: 'en' | 'hi';
  onLanguageChange: (lang: 'en' | 'hi') => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLocationClick?: () => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}

/**
 * Top header: brand wordmark + location pill + EN/हिं toggle + theme
 * button. On mobile a menu button opens the nav drawer. No other chrome.
 *
 * The location pill reflects the canonical state truthfully: it shows the
 * selected name when one exists, the in-flight GPS lookup while the browser
 * is resolving a fix, and an explicit "select a location" prompt otherwise —
 * it never fabricates a place (§no-location).
 */
export default function AppHeader({
  locationName,
  locationStatus,
  lang,
  onLanguageChange,
  theme,
  onToggleTheme,
  onLocationClick,
  drawerOpen,
  onToggleDrawer,
}: AppHeaderProps) {
  // Truthful pill copy for every LocationState discriminant.
  const pillLabel = locationName
    ? locationName
    : locationStatus === 'requesting-gps'
      ? 'Finding your location…'
      : locationStatus === 'denied' || locationStatus === 'error'
        ? 'Location unavailable'
        : 'Select a location';

  return (
    <header className="top app-header">
      <button
        className="rail-toggle"
        onClick={onToggleDrawer}
        aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={drawerOpen}
      >
        {drawerOpen ? <X /> : <Menu />}
      </button>

      <span className="brand">WeatherGPT</span>

      <button
        type="button"
        className="location-pill"
        onClick={onLocationClick}
        title="Use my location"
      >
        <MapPin />
        <span>{pillLabel}</span>
      </button>

      <div className="lang-toggle" role="group" aria-label="Language">
        <button
          type="button"
          className={`lang-opt ${lang === 'en' ? 'on' : ''}`}
          data-lang="en"
          onClick={() => onLanguageChange('en')}
        >
          EN
        </button>
        <button
          type="button"
          className={`lang-opt ${lang === 'hi' ? 'on' : ''}`}
          data-lang="hi"
          onClick={() => onLanguageChange('hi')}
        >
          हिं
        </button>
      </div>

      <button
        type="button"
        className="theme-toggle"
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun /> : <Moon />}
      </button>
    </header>
  );
}