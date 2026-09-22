import { badge, bad, ghostBtn } from './ui';
import { type Refusal, isRetryablePlanningCode } from './refusals';

/**
 * Renders a planning refusal faithfully: the human detail the backend sent,
 * plus its code as a tag for the trust story. A Retry button appears only for
 * transient dependency failures, which are the only refusals a retry can clear.
 */
export function RefusalNotice({
  refusal,
  busy,
  onRetry,
}: {
  refusal: Refusal;
  busy: boolean;
  onRetry: () => void;
}) {
  const retryable = isRetryablePlanningCode(refusal.code);
  return (
    <div
      role="alert"
      style={{
        border: `1px solid ${bad}`,
        borderRadius: 8,
        background: '#f8ece9',
        padding: 12,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ color: bad }}>Planning refused</strong>
        <span style={badge('bad')}>{refusal.code}</span>
      </div>

      {refusal.detail ? (
        <p style={{ margin: 0, fontSize: 13 }}>{refusal.detail}</p>
      ) : null}

      {retryable ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            style={{ ...ghostBtn, opacity: busy ? 0.5 : 1 }}
          >
            {busy ? 'Retrying…' : 'Retry'}
          </button>
          <span style={{ color: '#6b6455', fontSize: 12 }}>
            A transient dependency; the same request can succeed once it recovers.
          </span>
        </div>
      ) : null}
    </div>
  );
}
