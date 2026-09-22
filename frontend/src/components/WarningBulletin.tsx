import { Bell } from 'lucide-react';

export type ImdSeverity = 'green' | 'yellow' | 'orange' | 'red';

export interface ImdWarning {
  /** Short warning title, e.g. "Heavy to very heavy rainfall warning" */
  title?: string;
  /** Verbatim IMD warning text: never paraphrased or softened */
  text: string;
  /** Issue timestamp, e.g. "05:30 IST, 23 Sep" */
  issuedAt?: string;
  /** Resolved district, e.g. "Sitamarhi district" */
  district?: string;
  /** IMD-issued severity tier. Defaults to red when unknown. */
  severity?: ImdSeverity;
}

interface WarningBulletinProps {
  warning: ImdWarning | null;
}

const SEVERITY_LABEL: Record<ImdSeverity, string> = {
  green: 'No active warning',
  yellow: 'Yellow warning',
  orange: 'Orange warning',
  red: 'Red warning',
};

/**
 * Active IMD warning bulletin, rendered above the chat stream (and above
 * the input bar) whenever a warning exists. The 3px dashed frame follows
 * the bulletin's actual IMD severity tier (green/yellow/orange/red) so it
 * never reads as routine chat content. Slides in/out with a single
 * ~450ms max-height transition.
 */
export default function WarningBulletin({ warning }: WarningBulletinProps) {
  const severity: ImdSeverity = warning?.severity ?? 'red';
  return (
    <div className={`bulletin-wrap ${warning ? 'show' : ''}`} aria-live="polite">
      {warning && (
        <div className={`bulletin tier-${severity}`} role="alert">
          <div className="bulletin-head">
            <Bell />
            {SEVERITY_LABEL[severity]}
            {warning.district ? ` for ${warning.district}` : ''}
          </div>
          {warning.title && <p className="bulletin-title">{warning.title}</p>}
          <p>{warning.text}</p>
          <div className="bulletin-meta">
            <span>Verbatim · India Meteorological Department</span>
            {warning.issuedAt && <span>{warning.issuedAt}</span>}
          </div>
        </div>
      )}
    </div>
  );
}