interface AnswerCardConfidence {
  /** 0–100 */
  percent: number;
  /** e.g. "Moderate" or "High" — shown beside the model-agreement count */
  label?: string;
  /** X of Y members agreeing on this value */
  members?: number;
  of?: number;
}

interface AnswerCardProps {
  figure: string | number;
  label: string;
  body?: string;
  confidence?: AnswerCardConfidence;
  issuedAt?: string;
  source?: string;
}

/**
 * Structured answer card — NOT a chat bubble. Big tabular-nums figure +
 * label, body copy, a confidence bar (percent + "model agreement: X of Y
 * members"), and a mono footer with issue time + data source. Replaces
 * bare-number answers everywhere in the app.
 */
export default function AnswerCard({
  figure,
  label,
  body,
  confidence,
  issuedAt,
  source,
}: AnswerCardProps) {
  return (
    <div className="answer-card">
      <div className="answer-top">
        <div>
          <span className="answer-label">{label}</span>
          <div className="answer-figure">{figure}</div>
        </div>
      </div>

      {body && <div className="answer-body">{body}</div>}

      {confidence && (
        <div className="answer-body">
          <div className="confidence">
            <div className="confidence-label">
              <span>Confidence</span>
              <span>
                {confidence.label ? `${confidence.label} · ` : ''}
                {confidence.members != null && confidence.of
                  ? `model agreement: ${confidence.members} of ${confidence.of} members`
                  : `${Math.round(confidence.percent)}%`}
              </span>
            </div>
            <div className="confidence-track">
              <div
                className="confidence-fill"
                style={{ width: `${Math.max(0, Math.min(100, confidence.percent))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {(issuedAt || source) && (
        <div className="answer-foot">
          <span>{issuedAt || ''}</span>
          <span>{source || ''}</span>
        </div>
      )}
    </div>
  );
}