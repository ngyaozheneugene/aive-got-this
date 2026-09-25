'use client';

import { Lock } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CandidatePlan, DeskBoard } from '../../shared/types/domain';
import { clock, techColor } from './geo';
import { cn } from './lib/utils';
import { buildScheduleView, type ScheduleSlot } from './schedule-view';
import { urgent, warn } from './tokens';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { profileName } from './copy';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const ROW_H = 44;
const NAME_W = 148;

/**
 * The day as a Gantt: one row per technician. With a plan selected, the plan
 * is drawn over the board — moved jobs leave a dashed ghost where they were.
 */
export function Timeline({
  board,
  plan,
  unavailableTechId,
  focusTechId,
  pinnedTechId,
  onFocusTech,
  onPinTech,
}: {
  board: DeskBoard;
  plan?: CandidatePlan;
  unavailableTechId?: string;
  focusTechId?: string;
  /** The technician whose route the map is following, if any. */
  pinnedTechId?: string;
  onFocusTech: (technicianId: string | undefined) => void;
  onPinTech?: (technicianId: string) => void;
}) {
  const view = buildScheduleView(board, plan);
  const techIds = board.technicians.map((t) => t.technician.id);
  const span = (view.endHour - view.startHour) * 60;
  const pct = (minutes: number) => `${((minutes - view.startHour * 60) / span) * 100}%`;
  const width = (minutes: number) => `${(minutes / span) * 100}%`;
  const hours = Array.from({ length: view.endHour - view.startHour + 1 }, (_, i) => view.startHour + i);
  const changed = view.slots.filter((s) => s.change !== 'unchanged').length;

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>Tuesday</CardTitle>
        <CardDescription>
          {plan ? (
            <>
              Preview of <span className="text-foreground">{profileName(plan.profile)}</span> —{' '}
              {changed} {changed === 1 ? 'job changes' : 'jobs change'} (outlined). Nothing changes until you
              approve.
            </>
          ) : (
            <>Who is where today. Hover a technician to see their day on the map.</>
          )}
        </CardDescription>
        <Legend />
      </CardHeader>

      <CardContent className="px-4">
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* hour ruler */}
            <div className="flex h-6">
              <div style={{ width: NAME_W }} className="flex-none" />
              <div className="relative flex-1">
                {hours.map((h) => (
                  <span
                    key={h}
                    style={{ left: pct(h * 60) }}
                    className="absolute -translate-x-1/2 font-mono text-[11px] text-muted-foreground tabular-nums"
                  >
                    {String(h).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
            </div>

            {board.technicians.map(({ technician, loadMinutes }) => {
              const color = techColor(techIds, technician.id);
              const off = technician.id === unavailableTechId;
              const dim = focusTechId !== undefined && focusTechId !== technician.id;
              const rowSlots = view.slots.filter((s) => s.technicianId === technician.id);
              const ghosts = view.slots.filter((s) => s.previous && s.previous.technicianId === technician.id);
              return (
                <div
                  key={technician.id}
                  onMouseEnter={() => onFocusTech(technician.id)}
                  onMouseLeave={() => onFocusTech(undefined)}
                  style={{ height: ROW_H }}
                  className={cn(
                    'flex border-t transition-[opacity,background-color] duration-150',
                    dim && 'opacity-40',
                    pinnedTechId === technician.id && 'bg-accent/50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onPinTech?.(technician.id)}
                    aria-pressed={pinnedTechId === technician.id}
                    title="Show this technician’s route on the map"
                    style={{ width: NAME_W }}
                    className="flex flex-none cursor-pointer items-center gap-2.5 rounded-md pr-2 pl-1 text-left hover:bg-accent/60"
                  >
                    <span className="size-2.5 flex-none rounded-full" style={{ background: color }} />
                    <div className="min-w-0 leading-tight">
                      <div className={cn('truncate text-sm font-medium', off && 'text-muted-foreground line-through')}>
                        {technician.name}
                      </div>
                      <div className={cn('truncate text-[11px]', off ? 'text-destructive' : 'text-muted-foreground')}>
                        {off ? 'unavailable' : `${technician.currentCluster ?? '—'} · ${loadMinutes}m`}
                      </div>
                    </div>
                  </button>
                  <div
                    className="relative flex-1"
                    style={{
                      background: off
                        ? 'repeating-linear-gradient(135deg, rgb(239 68 68 / 0.10) 0 6px, transparent 6px 12px)'
                        : undefined,
                    }}
                  >
                    {hours.map((h) => (
                      <div key={h} style={{ left: pct(h * 60) }} className="absolute inset-y-0 border-l border-border/60" />
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
                        }}
                        className="text-muted-foreground opacity-70"
                      >
                        <span className="truncate">{s.row.customer.name}</span>
                      </div>
                    ))}
                    {rowSlots.map((s) => (
                      <SlotBlock
                        key={s.jobId}
                        slot={s}
                        color={color}
                        left={pct(s.start)}
                        width={width(s.end - s.start)}
                        travelWidth={width(s.travelBeforeMinutes ?? 0)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {view.unassigned.length > 0 ? (
              <div style={{ minHeight: ROW_H }} className="flex items-center border-t">
                <div style={{ width: NAME_W }} className="flex-none text-sm font-medium text-destructive">
                  Unassigned
                </div>
                <div className="flex flex-wrap gap-1.5 py-2">
                  {view.unassigned.map((r) => {
                    const ws = r.job.windowStart?.slice(11, 16);
                    const we = r.job.windowEnd?.slice(11, 16);
                    return (
                      <Badge key={r.job.id} variant={r.job.priority === 'urgent' ? 'danger' : 'secondary'}>
                        {r.job.priority === 'urgent' ? <span className="size-1.5 rounded-full bg-current" /> : null}
                        {r.customer.name}
                        {ws && we ? ` · window ${ws}–${we}` : ''}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
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
  const isUrgent = slot.row.job.priority === 'urgent';
  const moved = slot.change !== 'unchanged';
  const locked = slot.row.job.lockState && slot.row.job.lockState !== 'none';
  const tag =
    slot.change === 'added' ? 'new' : slot.change === 'reassigned' ? 'reassigned' : slot.change === 'retimed' ? 'retimed' : null;
  const accent = isUrgent ? urgent : color;
  return (
    <>
      {slot.travelBeforeMinutes ? (
        <div
          title={`${slot.travelBeforeMinutes} min travel`}
          style={{
            position: 'absolute',
            top: ROW_H / 2 - 2,
            height: 4,
            left: `calc(${left} - ${travelWidth})`,
            width: travelWidth,
            background: `repeating-linear-gradient(90deg, ${color}99 0 3px, transparent 3px 6px)`,
          }}
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            style={{
              ...block,
              left,
              width,
              background: `${accent}33`,
              borderLeft: `3px solid ${accent}`,
              outline: moved ? `2px solid ${warn}` : undefined,
              outlineOffset: moved ? 1 : undefined,
              boxShadow: moved ? `0 0 16px ${warn}55` : undefined,
              animation: moved ? 'desk-pop 320ms ease-out' : undefined,
            }}
            className="cursor-default text-foreground"
          >
            {locked ? <Lock className="mr-1 size-3 flex-none opacity-80" /> : null}
            <span className="truncate font-medium">{slot.row.customer.name}</span>
            {tag ? (
              <span className="ml-1 flex-none rounded-sm bg-warning/20 px-1 text-[10px] font-semibold text-warning">{tag}</span>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="font-medium">{slot.row.customer.name}</div>
          <div className="opacity-80">{slot.row.site.addressLine1}</div>
          <div className="font-mono opacity-80">
            {clock(slot.start)}–{clock(slot.end)}
            {slot.travelBeforeMinutes ? ` · ${slot.travelBeforeMinutes} min travel` : ''}
            {locked ? ` · ${slot.row.job.lockState}` : ''}
          </div>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function Legend() {
  const item = 'inline-flex items-center gap-1.5 text-[11px] text-muted-foreground';
  return (
    <div className="flex flex-wrap gap-3 pt-1">
      <span className={item}>
        <span className="h-2.5 w-3.5 rounded-sm" style={{ background: '#3b82f633', borderLeft: '3px solid #3b82f6' }} /> job
      </span>
      <span className={item}>
        <span className="h-1 w-3.5" style={{ background: 'repeating-linear-gradient(90deg,#3b82f699 0 3px,transparent 3px 6px)' }} />{' '}
        travel
      </span>
      <span className={item}>
        <span className="h-2.5 w-3.5 rounded-sm" style={{ outline: `2px solid ${warn}` }} /> would change
      </span>
      <span className={item}>
        <span className="h-2.5 w-3.5 rounded-sm border-[1.5px] border-dashed border-muted-foreground" /> currently here
      </span>
    </div>
  );
}

const block: CSSProperties = {
  position: 'absolute',
  top: 6,
  height: ROW_H - 12,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px',
  boxSizing: 'border-box',
  overflow: 'hidden',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
