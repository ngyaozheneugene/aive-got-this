import { ghostBtn, label, line, primaryBtn } from './ui';

export type DecisionPhase = 'recommended' | 'approved' | 'rejected' | 'committed';

/**
 * Presentational approve / reject / commit control. Overrides always take a
 * reason. Commit is gated behind an approval because the proposal is medium
 * risk / approval mode; the server enforces this too.
 */
export function ApproveBar({
  phase,
  reason,
  onReasonChange,
  planSelected,
  busy,
  onApprove,
  onReject,
  onCommit,
}: {
  phase: DecisionPhase;
  reason: string;
  onReasonChange: (value: string) => void;
  planSelected: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCommit: () => void;
}) {
  const reasonRequired = reason.trim().length === 0;

  if (phase === 'committed') {
    return null;
  }

  return (
    <div style={{ borderTop: `1px solid ${line}`, marginTop: 16, paddingTop: 16 }}>
      <label style={{ display: 'block' }}>
        <span style={label}>Reason (required for every decision)</span>
        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={2}
          placeholder="Why this plan, or why rejected"
          disabled={busy || phase === 'approved'}
          style={{
            width: '100%',
            marginTop: 6,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${line}`,
            font: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {phase === 'recommended' ? (
          <>
            <button
              type="button"
              onClick={onApprove}
              disabled={busy || reasonRequired || !planSelected}
              style={{ ...primaryBtn, opacity: busy || reasonRequired || !planSelected ? 0.5 : 1 }}
            >
              Approve selected plan
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy || reasonRequired}
              style={{ ...ghostBtn, opacity: busy || reasonRequired ? 0.5 : 1 }}
            >
              Reject
            </button>
            {!planSelected ? (
              <span style={{ alignSelf: 'center', color: '#6b6455', fontSize: 13 }}>
                Select a plan to approve.
              </span>
            ) : null}
          </>
        ) : null}

        {phase === 'approved' ? (
          <>
            <span style={{ alignSelf: 'center', color: '#1f6b3b', fontSize: 13 }}>
              Approved. Commit to write the new snapshot.
            </span>
            <button
              type="button"
              onClick={onCommit}
              disabled={busy}
              style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}
            >
              Commit to board
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
