import { useState } from 'react';
import type { PlanProfile } from '../../shared/types/domain';
import { DISRUPTION_LABEL, type DeskDisruption, type DeskDisruptionKind } from './desk-api';
import { card, label, primaryBtn } from './ui';

const KINDS: DeskDisruptionKind[] = ['urgent_job', 'technician_unavailable', 'job_overrun'];

/** Raises one of the three P0 disruptions and asks for a plan. No second planner. */
export function Simulator({
  busy,
  disabled,
  onSimulate,
}: {
  busy: boolean;
  disabled: boolean;
  onSimulate: (disruption: DeskDisruption) => void;
}) {
  const [kind, setKind] = useState<DeskDisruptionKind>('urgent_job');
  const [profile, setProfile] = useState<PlanProfile>('sla_first');
  return (
    <section style={{ ...card, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
      <div>
        <span style={label}>Simulate disruption</span>
        <p style={{ margin: '4px 0 0', fontSize: 14 }}>{DISRUPTION_LABEL[kind]}</p>
      </div>
      <label style={{ fontSize: 13 }}>
        <span style={{ display: 'block', color: '#6b6455' }}>Event</span>
        <select
          aria-label="Disruption"
          value={kind}
          onChange={(e) => setKind(e.target.value as DeskDisruptionKind)}
          disabled={busy}
          style={{ font: 'inherit', padding: '4px 6px', marginTop: 4 }}
        >
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {DISRUPTION_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 13 }}>
        <span style={{ display: 'block', color: '#6b6455' }}>Preferred profile</span>
        <select
          aria-label="Preferred profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value as PlanProfile)}
          disabled={busy}
          style={{ font: 'inherit', padding: '4px 6px', marginTop: 4 }}
        >
          <option value="sla_first">SLA first</option>
          <option value="minimal_disruption">Minimal disruption</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() => onSimulate({ kind, profile })}
        disabled={busy || disabled}
        style={{ ...primaryBtn, opacity: busy || disabled ? 0.5 : 1 }}
      >
        {busy ? 'Planning…' : 'Raise event'}
      </button>
    </section>
  );
}
