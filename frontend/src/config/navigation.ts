import {
  Bell,
  CalendarDays,
  Cloud,
  Cpu,
  FileText,
  Layers,
  Map,
  Radar,
  Route,
  TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Secondary pages — reachable from the collapsed icon rail (desktop) /
 * mobile drawer. Chat is the primary view and intentionally absent here.
 * (Nowcasting was removed from this UI; no component, route or nav entry
 * remains for it.)
 */
export type NavPage =
  | 'forecast'
  | 'nwp'
  | 'sectors'
  | 'alerts'
  | 'climate'
  | 'route'
  | 'report'
  | 'map'
  | 'radar';

export interface NavItem {
  id: NavPage;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'forecast', label: 'Forecast', icon: CalendarDays },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'radar', label: 'Radar', icon: Radar },
  { id: 'alerts', label: 'Alerts & history', icon: Bell },
  { id: 'nwp', label: 'NWP Models', icon: Cpu },
  { id: 'sectors', label: 'Sectors', icon: Layers },
  { id: 'climate', label: 'Climate', icon: TrendingUp },
  { id: 'route', label: 'Route Weather', icon: Route },
  { id: 'report', label: 'Weather Report', icon: FileText },
];

export const CHAT_MARK_ICON = Cloud;

export const isNavPage = (id: string): id is NavPage =>
  NAV_ITEMS.some((n) => n.id === id);