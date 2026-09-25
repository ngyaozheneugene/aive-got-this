'use client';

import type { CSSProperties } from 'react';
import type { CandidatePlan, DeskBoard } from '../../shared/types/domain';
import { clock, techColor } from './geo';
import { buildScheduleView, type ScheduleSlot } from './schedule-view';
import { badge, card, label, line, warn } from './ui';

const ROW_H = 46;
const NAME_W = 132;

/**
 * The day as a Gantt: one row per technician. With a plan selected, the plan
 * is drawn over the board — moved jobs leave a dashed ghost where they were.
 */
export function Timeline({
  board,
  plan,
  unavailableTechId,
  focusTechId,
  onFocusTech,
}: {
  board: DeskBoard;
  plan?: CandidatePlan;
  unavailableTechId?: string;
  focusTechId?: string;
  onFocusTech: (technicianId: string | undefined) => void;
}) {
  const view = buildScheduleView(board, plan);
  const techIds = board.technicians.map((t) => t.technician.id);
  const span = (view.endHour - view.startHour) * 60;
  const pct = (minutes: number) => `${((minutes - view.startHour * 60) / span) * 100}%`;
  const width = (minutes: number) => `${(minutes / span) * 100}%`;
  const hours = Array.from({ length: view.endHour - view.startHour + 1 }, (_, i) => view.startHour + i);
  const changed = view.slots.filter((s) => s.change !== 'unchanged').length;

  return (
    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <span style={label}>Tuesday timeline</span>
          <p style={{ margin: '4px 0 0', fontSize: 15 }}>
            {plan ? (
              <>
                Previewing <strong>{plan.profile === 'sla_first' ? 'SLA first' : 'Minimal disruption'}</strong>
                {' — '}
                {changed} {changed === 1 ? 'job changes' : 'jobs change'}. The board is untouched until commit.
              </>
            ) : (
              <>Committed board v{board.snapshot.version}</>
            )}
          </p>
        </div>
        <Legend />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
          {/* hour ruler */}
          <div style={{ display: 'flex', height: 18 }}>
            <div style={{ width: NAME_W, flex: 'none' }} />
            <div style={{ position: 'relative', flex: 1 }}>
              {hours.map((h) => (
                <span
                  key={h}
                  style={{
                    position: 'absolute',
                    left: pct(h * 60),
                    transform: 'translateX(-50%)',
                    fontSize: 11,
                    color: '#6b6455',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {String(h).padStart(2, '0')}
                </span>
              ))}
            </div>
          </div>

          {board.technicians.map(({ technician, loadMinutes }) => {
            const color = techColor(techIds, technician.id);
            const off = technician.id === unavailableTechId;
            const dim = focusTechId !== undefined && focusTechId !== technician.id;
            const rowSlots = view.slots.filter((s) => s.technicianId === technician.id);
            const ghosts = view.slots.filter(
              (s) => s.previous && s.previous.technicianId === technician.id,
            );
            return (
              <div
                key={technician.id}
                onMouseEnter={() => onFocusTech(technician.id)}
                onMouseLeave={() => onFocusTech(undefined)}
                style={{
                  display: 'flex',
                  height: ROW_H,
                  borderTop: `1px solid ${line}`,
                  opacity: dim ? 0.45 : 1,
                  transition: 'opacity 150ms',
                }}
              >
                <div style={{ width: NAME_W, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flex: 'none' }} />
                  <div style={{ lineHeight: 1.2 }}>
                    <strong style={{ fontSize: 14 }}>{technician.name}</strong>
                    <div style={{ fontSize: 11, color: off ? '#8c2f21' : '#6b6455' }}>
                      {off ? 'unavailable' : `${technician.currentCluster ?? '—'} · ${loadMinutes}m`}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    position: 'relative',
                    flex: 1,
                    background: off
                      ? 'repeating-linear-gradient(135deg, #f3e0dc 0 6px, #fbf4f1 6px 12px)'
                      : undefined,
                  }}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      style={{ position: 'absolute', top: 0, bottom: 0, left: pct(h * 60), borderLeft: `1px dashed ${line}` }}
                    />
                  ))}
                  {ghosts.map((s) => (
                    <div
                      key={`ghost-${s.jobId}`}
                      title={`Was here: ${s.row.customer.name} ${clock(s.previous!.start)}–${clock(s.previous!.end)}`}
                      style={{
                        ...block,
                        left: pct(s.previous!.start),
                        width: width(s.previous!.end - s.previous!.start),
                        border: `1.5px dashed ${color}`,
                        background: 'transparent',
                        color: '#6b6455',
                        opacity: 0.8,
                      }}
                    >
                      <span style={blockText}>{s.row.customer.name}</span>
                    </div>
                  ))}
                  {rowSlots.map((s) => (
                    <SlotBlock key={s.jobId} slot={s} color={color} left={pct(s.start)} width={width(s.end - s.start)} travelWidth={width(s.travelBeforeMinutes ?? 0)} />
                  ))}
                </div>
              </div>
            );
          })}

          {view.unassigned.length > 0 ? (
            <div style={{ display: 'flex', minHeight: ROW_H, borderTop: `1px solid ${line}`, alignItems: 'center' }}>
              <div style={{ width: NAME_W, flex: 'none' }}>
                <strong style={{ fontSize: 14, color: '#8c2f21' }}>Unassigned</strong>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 0' }}>
                {view.unassigned.map((r) => {
                  const ws = r.job.windowStart?.slice(11, 16);
                  const we = r.job.windowEnd?.slice(11, 16);
                  return (
                    <span key={r.job.id} style={{ ...badge(r.job.priority === 'urgent' ? 'bad' : 'muted'), fontWeight: 500 }}>
                      {r.job.priority === 'urgent' ? '● ' : ''}
                      {r.customer.name}
                      {ws && we ? ` · window ${ws}–${we}` : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SlotBlock({
  slot,
  color,
  left,
  width,
  travelWidth,
}: {
  slot: ScheduleSlot;
  color: string;
  left: string;
  width: string;
  travelWidth: string;
}) {
  const urgent = slot.row.job.priority === 'urgent';
  const moved = slot.change !== 'unchanged';
  const tag =
    slot.change === 'added' ? 'new' : slot.change === 'reassigned' ? 'reassigned' : slot.change === 'retimed' ? 'retimed' : null;
  return (
    <>
      {slot.travelBeforeMinutes ? (
        <div
          title={`${slot.travelBeforeMinutes} min travel`}
          style={{
            position: 'absolute',
            top: 19,
            height: 6,
            left: `calc(${left} - ${travelWidth})`,
            width: travelWidth,
            background: `repeating-linear-gradient(90deg, ${color}55 0 3px, transparent 3px 5px)`,
          }}
        />
      ) : null}
      <div
        title={`${slot.row.customer.name} · ${slot.row.site.addressLine1}\n${clock(slot.start)}–${clock(slot.end)}${
          slot.travelBeforeMinutes ? ` · ${slot.travelBeforeMinutes} min travel` : ''
        }${slot.row.job.lockState && slot.row.job.lockState !== 'none' ? ` · ${slot.row.job.lockState}` : ''}`}
        style={{
          ...block,
          left,
          width,
          background: urgent ? '#f3e0dc' : `${color}1f`,
          borderLeft: `4px solid ${urgent ? '#8c2f21' : color}`,
          outline: moved ? `2px solid ${warn}` : undefined,
          outlineOffset: moved ? 1 : undefined,
          boxShadow: moved ? '0 2px 8px rgba(138,90,0,0.25)' : undefined,
          animation: moved ? 'desk-pop 320ms ease-out' : undefined,
        }}
      >
        <span style={blockText}>
          {slot.row.job.lockState && slot.row.job.lockState !== 'none' ? '🔒 ' : ''}
          {slot.row.customer.name}
        </span>
        {tag ? (
          <span style={{ ...badge('warn'), fontSize: 10, padding: '0 6px', marginLeft: 4, flex: 'none' }}>{tag}</span>
        ) : null}
      </div>
    </>
  );
}

function Legend() {
  const item: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b6455' };
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <span style={item}>
        <span style={{ width: 14, height: 10, background: '#16325c1f', borderLeft: '3px solid #16325c' }} /> job
      </span>
      <span style={item}>
        <span style={{ width: 14, height: 6, background: 'repeating-linear-gradient(90deg,#16325c55 0 3px,transparent 3px 5px)' }} /> travel
      </span>
      <span style={item}>
        <span style={{ width: 14, height: 10, outline: `2px solid ${warn}` }} /> changed by plan
      </span>
      <span style={item}>
        <span style={{ width: 14, height: 10, border: '1.5px dashed #6b6455' }} /> was here
      </span>
    </div>
  );
}

const block: CSSProperties = {
  position: 'absolute',
  top: 7,
  height: ROW_H - 14,
  borderRadius: 5,
  display: 'flex',
  alignItems: 'center',
  padding: '0 6px',
  boxSizing: 'border-box',
  overflow: 'hidden',
  fontSize: 12,
  color: '#161410',
};

const blockText: CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};
