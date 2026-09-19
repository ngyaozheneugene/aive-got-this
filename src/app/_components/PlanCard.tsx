import type { CandidatePlan } from '../../shared/types/domain';
import { badge, line, navy } from './ui';

const PROFILE_LABEL: Record<string, string> = {
  sla_first: 'SLA first',
  minimal_disruption: 'Minimal disruption',
};

const METRIC_ROWS: Array<{ key: keyof CandidatePlan['metrics']; label: string; unit?: string }> = [
  { key: 'slaLatenessMinutes', label: 'SLA lateness', unit: 'min' },
  { key: 'travelMinutes', label: 'Travel', unit: 'min' },
  { key: 'overtimeMinutes', label: 'Overtime', unit: 'min' },
  { key: 'jobsMoved', label: 'Jobs moved' },
  { key: 'customersAffected', label: 'Customers affected' },
  { key: 'unassignedCount', label: 'Left unassigned' },
];

/**
 * One candidate plan. Shows the metrics member 2 stored and its validation
 * outcome. Selectable when it is committable. The browser does not re-score.
 */
export function PlanCard({
  plan,
  recommended,
  selected,
  onSelect,
}: {
  plan: CandidatePlan;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const valid = plan.validations.ok && plan.status !== 'REJECTED';
  return (
    <button
      type="button"
      onClick={valid ? onSelect : undefined}
      aria-pressed={selected}
      disabled={!valid}
      style={{
        textAlign: 'left',
        border: `2px solid ${selected ? navy : line}`,
        borderRadius: 8,
        background: valid ? '#fffdf8' : '#f3f0e8',
        padding: 16,
        cursor: valid ? 'pointer' : 'not-allowed',
        opacity: valid ? 1 : 0.85,
        flex: '1 1 240px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <strong style={{ fontSize: 15 }}>{PROFILE_LABEL[plan.profile] ?? plan.profile}</strong>
        {recommended ? <span style={badge('good')}>Recommended</span> : null}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 13 }}>
        <tbody>
          {METRIC_ROWS.map((row) => (
            <tr key={row.key} style={{ borderTop: `1px solid ${line}` }}>
              <td style={{ padding: '5px 0', color: '#6b6455' }}>{row.label}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {plan.metrics[row.key]}
                {row.unit ? ` ${row.unit}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12 }}>
        {valid ? (
          <span style={badge('good')}>Validated</span>
        ) : (
          <span style={badge('bad')}>Blocked</span>
        )}
        {plan.timedOut ? <span style={{ ...badge('warn'), marginLeft: 6 }}>timed out</span> : null}
        {plan.validations.violations.length > 0 ? (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#8c2f21', fontSize: 12 }}>
            {plan.validations.violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </button>
  );
}
