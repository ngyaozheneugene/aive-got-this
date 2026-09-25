import { useState } from 'react';
import type { PlanProfile } from '../../shared/types/domain';
import { DISRUPTIONS, findDisruption } from './disruptions';
import { card, label, primaryBtn } from './ui';

/** Event simulator. Raises one of the three disruptions and asks for a plan. */
export function Simulator({
  busy,
  disabled,
  onSimulate,
}: {
  busy: boolean;
  disabled: boolean;
  onSimulate: (disruptionKey: string, profile: PlanProfile) => void;
}) {
  const [disruptionKey, setDisruptionKey] = useState<string>(DISRUPTIONS[0]!.key);
  const [profile, setProfile] = useState<PlanProfile>('sla_first');
  const disruption = findDisruption(disruptionKey);
  const inactive = busy || disabled;

  return (
    <section style={{ ...card, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 240 }}>
        <span style={label}>Simulate disruption</span>
        <select
          value={disruptionKey}
          onChange={(e) => setDisruptionKey(e.target.value)}
          disabled={inactive}
          style={{ display: 'block', font: 'inherit', padding: '4px 6px', marginTop: 4, width: '100%' }}
        >
          {DISRUPTIONS.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b6455' }}>{disruption.detail}</p>
      </div>

      <label style={{ fontSize: 13 }}>
        <span style={{ display: 'block', color: '#6b6455' }}>Preferred profile</span>
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value as PlanProfile)}
          disabled={inactive}
          style={{ font: 'inherit', padding: '4px 6px', marginTop: 4 }}
        >
          <option value="sla_first">SLA first</option>
          <option value="minimal_disruption">Minimal disruption</option>
        </select>
      </label>

      <button
        type="button"
        onClick={() => onSimulate(disruptionKey, profile)}
        disabled={inactive}
        style={{ ...primaryBtn, opacity: inactive ? 0.5 : 1 }}
      >
        {busy ? 'Planning…' : `Raise ${disruption.label.toLowerCase()}`}
      </button>
    </section>
  );
}
