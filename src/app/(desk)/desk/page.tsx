'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import type { CandidatePlan, DeskBoard, PlanProfile } from '../../../shared/types/domain';
import {
  DeskApiError, deskApi, type PlanResult,
} from '../../_components/desk-api';
import { BoardView } from '../../_components/BoardView';
import { MapBoundary } from '../../_components/MapBoundary';
import { Timeline } from '../../_components/Timeline';
import { Simulator } from '../../_components/Simulator';
import { ProposalPanel } from '../../_components/ProposalPanel';
import { TraceDrawer } from '../../_components/TraceDrawer';
import { RefusalNotice } from '../../_components/RefusalNotice';
import type { Refusal } from '../../_components/refusals';
import { findDisruption } from '../../_components/disruptions';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { BellRing, Check, List, Loader2, Map as MapIcon, RotateCcw, Snowflake } from 'lucide-react';
import { BorderBeam, LiveDot, NumberTicker, ShimmerText, slideIn } from '../../_components/fx';
import { PROFILE_COPY } from '../../_components/copy';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../_components/ui/select';
import { Badge } from '../../_components/ui/badge';
import { Button } from '../../_components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../_components/ui/card';
import { Skeleton } from '../../_components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../_components/ui/tabs';

// Leaflet needs `window`, so the map renders only in the browser.
const MapView = dynamic(() => import('../../_components/MapView'), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[240px] rounded-xl" />,
});

export default function DeskPage() {
  const [board, setBoard] = useState<DeskBoard | null>(null);
  const [proposal, setProposal] = useState<PlanResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<Refusal | null>(null);
  const [lastAttempt, setLastAttempt] = useState<{ disruptionKey: string; profile: PlanProfile } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  // The coordinator's own standing preference; decides which option is recommended.
  const [priority, setPriority] = useState<PlanProfile>('sla_first');
  const [preview, setPreview] = useState<CandidatePlan | undefined>(undefined);
  // Hover previews a technician; a click pins them so the map follows their route.
  const [hoverTechId, setHoverTechId] = useState<string | undefined>(undefined);
  const [pinnedTechId, setPinnedTechId] = useState<string | undefined>(undefined);
  const focusTechId = hoverTechId ?? pinnedTechId;
  const togglePin = useCallback(
    (technicianId: string) => setPinnedTechId((current) => (current === technicianId ? undefined : technicianId)),
    [],
  );
  // What the coordinator did with the current proposal; a decided proposal no
  // longer blocks reporting the next problem.
  const [decision, setDecision] = useState<'committed' | 'rejected' | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setBoard(await deskApi.getBoard());
    } catch (e) {
      setLoadError(e instanceof DeskApiError ? e.message : 'Could not load the board.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const simulate = useCallback(
    async (disruptionKey: string, profile: PlanProfile = priority) => {
      if (!board) return;
      setBusy(true);
      setPlanError(null);
      setProposal(null);
      setPreview(undefined);
      setDecision(null);
      setLastAttempt({ disruptionKey, profile });
      // The arrival itself is the slide-in card in the decision column.
      const incoming = findDisruption(disruptionKey);
      try {
        const event = await deskApi.createEvent(incoming.body, board.snapshot.id);
        const result = await deskApi.plan(event.id, profile);
        setProposal(result);
        toast.success(
          result.plans.length === 1 ? 'One option is ready' : `${result.plans.length} options are ready`,
          { description: 'Pick one on the right; the map and timeline show what it changes.' },
        );
      } catch (e) {
        setPlanError(
          e instanceof DeskApiError
            ? { code: e.code, detail: e.detail }
            : { code: 'planning_failed', detail: 'Planning could not be completed.' },
        );
        toast.error('The assistant couldn’t plan this one', { description: 'Details are on the right.' });
      } finally {
        setBusy(false);
      }
    },
    [board, priority],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    setProposal(null);
    setPreview(undefined);
    setDecision(null);
    setPlanError(null);
    setLastAttempt(null);
    setPinnedTechId(undefined);
    try {
      await deskApi.reset();
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const onCommitted = useCallback((version: number) => {
    setDecision('committed');
    toast.success('Schedule updated', { description: `Saved as version ${version}. Everyone sees the new plan.` });
    void load();
  }, [load]);

  if (loadError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Board unavailable</CardTitle>
            <CardDescription className="text-destructive">{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void load()}>
              <RotateCcw />
              Retry
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!board) {
    return (
      <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Loading Eastwind Tuesday…
        </span>
      </main>
    );
  }

  const lastBody = lastAttempt ? findDisruption(lastAttempt.disruptionKey).body : undefined;
  const unavailableTechId =
    lastBody?.type === 'technician_unavailable' && proposal
      ? (lastBody.payload as { technicianId?: string }).technicianId
      : undefined;
  const unassigned = board.jobs.filter((j) => !j.technician).length;
  const incoming = lastAttempt ? findDisruption(lastAttempt.disruptionKey) : undefined;
  const headerStatus: { label: string; tone: 'warning' | 'success' } =
    proposal && decision === null
      ? { label: 'Waiting for your decision', tone: 'warning' }
      : decision === 'rejected'
        ? { label: 'Arrange this one manually', tone: 'warning' }
        : { label: 'Schedule up to date', tone: 'success' };

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col gap-6 border-b bg-card/40 p-5 lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:w-72 lg:flex-none lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_0_24px_-4px] shadow-blue-500/60">
            <Snowflake className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Dispatch Coordinator</div>
            <div className="text-xs text-muted-foreground">Eastwind Aircon</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-background/50 p-3">
          <div className="grid size-8 place-items-center rounded-full bg-secondary text-sm font-semibold">C</div>
          <div className="leading-tight">
            <div className="text-sm font-medium">You: Coordinator</div>
            <div className="text-xs text-muted-foreground">Eastwind dispatch office</div>
          </div>
        </div>

        <div className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">Your priority when problems come in</span>
          <Select value={priority} onValueChange={(v) => setPriority(v as PlanProfile)} disabled={busy}>
            <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sla_first">{PROFILE_COPY.sla_first.name}</SelectItem>
              <SelectItem value="minimal_disruption">{PROFILE_COPY.minimal_disruption.name}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {PROFILE_COPY[priority].promise} You always see both options; this decides which one is recommended.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <Stat label="Schedule version" value={board.snapshot.version} />
          <Stat label="Date" value={board.date} />
          <Stat label="Technicians" value={board.technicians.length} />
          <Stat label="Jobs needing a technician" value={unassigned} tone={unassigned > 0 ? 'bad' : undefined} />
        </dl>

        <div className="mt-auto">
          <Simulator
            busy={busy}
            disabled={Boolean(proposal) && decision === null}
            onSimulate={(k) => void simulate(k)}
            onReset={() => void reset()}
          />
        </div>
      </aside>

      {/*
        Wide screens: nothing scrolls away. The map and timeline share the
        left pane and always show what the selected option would do; the
        decision lives in its own scrolling column beside them.
      */}
      <main className="fx-ambient flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6 xl:h-dvh xl:overflow-hidden xl:py-5">
        <header className="flex flex-none flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Today’s schedule</h1>
            <Steps step={decision === 'committed' ? 3 : proposal && decision === null ? 2 : 1} />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={headerStatus.label}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.2 }}
            >
              <Badge variant={headerStatus.tone} className="gap-2 py-1">
                <LiveDot tone={headerStatus.tone} />
                {headerStatus.label}
              </Badge>
            </motion.div>
          </AnimatePresence>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          {/* Decision column. First on narrow screens, right-hand on wide ones. */}
          <div className="grid min-h-0 content-start gap-4 xl:order-2 xl:overflow-y-auto xl:pr-1">
            <AnimatePresence mode="popLayout" initial={false}>
            {incoming && (busy || planError) && !proposal ? (
              <motion.div key={`incoming-${incoming.key}`} {...slideIn}>
                <Card className="fx-attention overflow-hidden border-warning/30 bg-warning/[0.06]">
                  {busy ? <BorderBeam duration={4} /> : null}
                  <CardHeader>
                    <CardDescription className="flex items-center gap-2 text-warning">
                      <motion.span
                        animate={{ rotate: [0, -14, 12, -8, 6, 0] }}
                        transition={{ duration: 0.8, delay: 0.25 }}
                        className="inline-flex"
                      >
                        <BellRing className="size-4" />
                      </motion.span>
                      New · {incoming.source}
                    </CardDescription>
                    <CardTitle className="text-base">{incoming.headline}</CardTitle>
                    <CardDescription>{incoming.detail}</CardDescription>
                  </CardHeader>
                  {busy ? (
                    <CardContent className="grid gap-3">
                      <span className="flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        <ShimmerText>The assistant is working out your options…</ShimmerText>
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        <Skeleton className="h-28 rounded-lg" />
                        <Skeleton className="h-28 rounded-lg [animation-delay:150ms]" />
                      </div>
                    </CardContent>
                  ) : null}
                </Card>
              </motion.div>
            ) : null}

            {planError ? (
              <RefusalNotice
                refusal={planError}
                busy={busy}
                onRetry={() => {
                  if (lastAttempt) void simulate(lastAttempt.disruptionKey, lastAttempt.profile);
                }}
              />
            ) : null}

            {proposal && lastAttempt ? (
              <motion.div key={`proposal-${proposal.proposal.id}`} {...slideIn}>
              <ProposalPanel
                result={proposal}
                board={board}
                source={findDisruption(lastAttempt.disruptionKey).source}
                title={findDisruption(lastAttempt.disruptionKey).headline}
                detail={findDisruption(lastAttempt.disruptionKey).detail}
                onCommitted={onCommitted}
                onRejected={() => setDecision('rejected')}
                onPreview={setPreview}
              />
              </motion.div>
            ) : !busy && !planError ? (
              <motion.div key="idle" {...slideIn}>
              <Card className="border-dashed bg-transparent backdrop-blur-none">
                <CardHeader>
                  <CardTitle>Nothing needs your attention</CardTitle>
                  <CardDescription>
                    When a customer calls with an urgent job, a technician goes off sick or a job runs late, it shows
                    up here. The assistant suggests options, you see each one on the map and timeline, and nothing
                    changes until you approve.
                  </CardDescription>
                </CardHeader>
              </Card>
              </motion.div>
            ) : null}
            </AnimatePresence>

            {proposal ? <TraceDrawer eventId={proposal.proposal.eventId} /> : null}
          </div>

          {/* What the day looks like: map (or list) above, timeline below. */}
          <div className="flex min-h-0 min-w-0 flex-col gap-4 xl:order-1">
            <Tabs defaultValue="map" className="flex min-h-[360px] flex-1 flex-col gap-2 xl:min-h-0">
              <TabsList className="flex-none">
                <TabsTrigger value="map">
                  <MapIcon />
                  Map
                </TabsTrigger>
                <TabsTrigger value="list">
                  <List />
                  List
                </TabsTrigger>
              </TabsList>
              <TabsContent value="map" className="min-h-0 flex-1">
                <MapBoundary>
                  <MapView
                    board={board}
                    plan={preview}
                    unavailableTechId={unavailableTechId}
                    focusTechId={focusTechId}
                    pinnedTechId={pinnedTechId}
                    onFocusTech={setHoverTechId}
                    onPinTech={togglePin}
                  />
                </MapBoundary>
              </TabsContent>
              <TabsContent value="list" className="min-h-0 flex-1 overflow-y-auto">
                <Card className="py-4">
                  <CardContent className="px-4">
                    <BoardView board={board} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex-none">
              <Timeline
                board={board}
                plan={preview}
                unavailableTechId={unavailableTechId}
                focusTechId={focusTechId}
                pinnedTechId={pinnedTechId}
                onFocusTech={setHoverTechId}
                onPinTech={togglePin}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'bad' }) {
  return (
    <div className="rounded-lg border bg-background/50 px-3 py-2 transition-colors hover:bg-accent/40">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={tone === 'bad' ? 'font-mono text-sm text-destructive' : 'font-mono text-sm'}>
        {typeof value === 'number' ? <NumberTicker value={value} /> : value}
      </dd>
    </div>
  );
}

const STEPS = ['Something comes in', 'You choose an option', 'Schedule updated'];

/** Where the coordinator is in the loop, so the next action is never a guess. */
function Steps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 rounded-full border bg-card/60 p-1 text-xs backdrop-blur-sm">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'next';
        return (
          <li key={label} className="relative flex items-center gap-2 rounded-full px-2.5 py-1">
            {state === 'current' ? (
              <motion.span
                layoutId="step-highlight"
                className="absolute inset-0 rounded-full bg-primary/15 ring-1 ring-primary/40"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span
              className={
                'relative grid size-4 place-items-center rounded-full text-[10px] font-semibold ' +
                (state === 'current'
                  ? 'bg-primary text-primary-foreground'
                  : state === 'done'
                    ? 'bg-success/20 text-success'
                    : 'border text-muted-foreground')
              }
            >
              {state === 'done' ? <Check className="size-2.5" strokeWidth={3} /> : n}
            </span>
            <span className={'relative ' + (state === 'current' ? 'font-medium' : 'text-muted-foreground')}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
