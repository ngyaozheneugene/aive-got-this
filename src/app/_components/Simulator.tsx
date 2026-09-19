import { useState } from 'react';
import type { PlanProfile } from '../../shared/types/domain';
import { card, label, primaryBtn } from './ui';

/** Event simulator. Raises the Raffles Place urgent job and asks for a plan. */
export function Simulator({
  busy,
  disabled,
  onSimulate,
}: {
  busy: boolean;
  disabled: boolean;
  onSimulate: (profile: PlanProfile) => void;
}) {
  const [profile, setProfile] = useState<PlanProfile>('sla_first');
  return (
    <section style={{ ...card, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
      <div>
        <span style={label}>Simulate disruption</span>
        <p style={{ margin: '4px 0 0', fontSize: 14 }}>Raffles Place chiller trip — urgent job</p>
      </div>
      <label style={{ fontSize: 13 }}>
        <span style={{ display: 'block', color: '#6b6455' }}>Preferred profile</span>
        <select
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
        onClick={() => onSimulate(profile)}
        disabled={busy || disabled}
        style={{ ...primaryBtn, opacity: busy || disabled ? 0.5 : 1 }}
      >
        {busy ? 'Planning…' : 'Raise urgent job'}
      </button>
    </section>
  );
}
