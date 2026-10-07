'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CandidatePlan, DeskBoard, DeskJobRow, PlanProfile } from '../../../shared/types/domain';
import {
  DeskApiError, deskApi, type PlanResult,
} from '../../_components/desk-api';
import { BoardView } from '../../_components/BoardView';
import { MapBoundary } from '../../_components/MapBoundary';
import { Simulator } from '../../_components/Simulator';
import { ProposalPanel, type ProposalMemory } from '../../_components/ProposalPanel';
import { TraceDrawer } from '../../_components/TraceDrawer';
import { RefusalNotice } from '../../_components/RefusalNotice';
import type { Refusal } from '../../_components/refusals';
import {
  disruptionForBooking, disruptionForJob, disruptionForOverrun, disruptionForUnavailable, findDisruption,
} from '../../_components/disruptions';
import { NewJobForm } from '../../_components/NewJobForm';
import type { CreateJobBody } from '../../../shared/contracts/jobs';
import { TechList } from '../../_components/TechList';
import { EventFeed, type FeedItem, SourceIcon, receivedTime, useEventStatuses } from '../../_components/EventFeed';
import type { MapInsets } from '../../_components/MapView';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell, ChevronDown, Clock, FlaskConical, History, List, Loader2, Maximize2, RotateCcw, Snowflake, Table2, X,
} from 'lucide-react';
import { BorderBeam, LiveDot, NumberTicker, ShimmerText } from '../../_components/fx';
import { PROFILE_COPY, eventStatusCopy } from '../../_components/copy';
import { cn } from '../../_components/lib/utils';
import { addDays } from '../../../shared/config/demo';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../_components/ui/select';
import { Badge } from '../../_components/ui/badge';
import { Button } from '../../_components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../_components/ui/card';
import { Skeleton } from '../../_components/ui/skeleton';

// Leaflet needs `window`, so the map renders only in the browser.
const MapView = dynamic(() => import('../../_components/MapView'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
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
  // Clicking a technician pins them: the map moves to their day and their
  // route stays highlighted until they are unpinned. Hover highlights only
  // while nobody is pinned, and never moves the map.
  const [mapHoverTechId, setMapHoverTechId] = useState<string | undefined>(undefined);
  const [listHoverTechId, setListHoverTechId] = useState<string | undefined>(undefined);
  const [pinnedTechId, setPinnedTechId] = useState<string | undefined>(undefined);
  const focusTechId = pinnedTechId ?? listHoverTechId ?? mapHoverTechId;
  const togglePin = useCallback(
    (technicianId: string) => setPinnedTechId((current) => (current === technicianId ? undefined : technicianId)),
    [],
  );
  // What the coordinator did with the current proposal; a decided proposal no
  // longer blocks reporting the next problem.
  const [decision, setDecision] = useState<'committed' | 'rejected' | null>(null);
  // The proposal panel's own state, kept here because closing the event card
  // unmounts the panel; reopening must resume, not offer the choice again.
  const [proposalMemory, setProposalMemory] = useState<ProposalMemory | undefined>(undefined);
  // Layers over the map: the event card, a bottom drawer, the demo popover
  // and, on narrow screens, the technician list.
  const [cardOpen, setCardOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  // Today's events: what this desk has received, newest first. Kept for the
  // browser session so a reload keeps the feed; statuses always come from the server.
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedOpen, setFeedOpen] = useState(false);
  const [currentEventId, setCurrentEventId] = useState<string | undefined>(undefined);
  const [feedRef, feedSize] = useElementSize<HTMLDivElement>();
  const wide = useMediaQuery('(min-width: 768px)');
  const [cardRef, cardSize] = useElementSize<HTMLDivElement>();
  const [drawerRef, drawerSize] = useElementSize<HTMLDivElement>();

  // Restore before saving: saving first would overwrite the stored feed with
  // the empty initial one (and strict mode runs mount effects twice).
  const [feedRestored, setFeedRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(FEED_KEY);
      if (saved) setFeed(JSON.parse(saved) as FeedItem[]);
    } catch {
      // No storage (private window, blocked): the feed just starts empty.
    }
    setFeedRestored(true);
  }, []);

  useEffect(() => {
    if (!feedRestored) return;
    try {
      sessionStorage.setItem(FEED_KEY, JSON.stringify(feed));
    } catch {
      // Best effort only.
    }
  }, [feed, feedRestored]);

  // Refetch statuses whenever something about the current event moves.
  const feedRefresh = `${currentEventId}|${busy}|${proposal?.proposal.id}|${decision}|${planError?.code}`;
  const statuses = useEventStatuses(feed, feedRefresh);

  // The server forgets events on a demo reset or a restart; so does the feed.
  useEffect(() => {
    if (feed.some((i) => statuses[i.eventId] === 'missing')) {
      setFeed((prev) => prev.filter((i) => statuses[i.eventId] !== 'missing'));
    }
  }, [feed, statuses]);

  // Choosing an option hands the map back to the change it makes.
  useEffect(() => {
    if (preview) setPinnedTechId(undefined);
  }, [preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDemoOpen(false);
      setPinnedTechId(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Which day is on screen. Undefined is the board's own day, the one
  // disruptions plan against; any other day is a read-only look ahead.
  const [viewDate, setViewDate] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setBoard(await deskApi.getBoard(viewDate));
    } catch (e) {
      setLoadError(e instanceof DeskApiError ? e.message : 'Could not load the board.');
    }
  }, [viewDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const simulate = useCallback(
    async (disruptionKey: string, profile: PlanProfile = priority) => {
      if (!board || (board.today && board.date !== board.today)) return;
      setBusy(true);
      setPlanError(null);
      setProposal(null);
      setPreview(undefined);
      setDecision(null);
      setProposalMemory(undefined);
      setLastAttempt({ disruptionKey, profile });
      setPinnedTechId(undefined);
      setCardOpen(true);
      setDemoOpen(false);
      const incoming = findDisruption(disruptionKey);
      try {
        const event = await deskApi.createEvent(incoming.body, board.snapshot.id);
        setCurrentEventId(event.id);
        setFeed((prev) => [{ eventId: event.id, disruptionKey }, ...prev.filter((i) => i.eventId !== event.id)]);
        const result = await deskApi.plan(event.id, profile);
        setProposal(result);
      } catch (e) {
        setPlanError(
          e instanceof DeskApiError
            ? { code: e.code, detail: e.detail }
            : { code: 'planning_failed', detail: 'Planning could not be completed.' },
        );
      } finally {
        setBusy(false);
      }
    },
    [board, priority],
  );

  // Booking a call for a job that is not on the board: save it as waiting, then
  // ask for options exactly as "Find a technician" would.
  const [bookingOpen, setBookingOpen] = useState(false);
  const loadJobTypes = useCallback(() => deskApi.jobTypes(), []);
  const bookJob = useCallback(
    async (body: CreateJobBody, typeName: string): Promise<string | null> => {
      try {
        const booked = await deskApi.createJob(body);
        setBookingOpen(false);
        await load();
        const row = { job: booked.job, customer: booked.customer, site: booked.site } as DeskJobRow;
        void simulate(disruptionForBooking(row, typeName, booked.customerIsNew).key);
        return null;
      } catch (e) {
        return e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not book the job.';
      }
    },
    [load, simulate],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    setProposal(null);
    setPreview(undefined);
    setDecision(null);
    setProposalMemory(undefined);
    setPlanError(null);
    setLastAttempt(null);
    setPinnedTechId(undefined);
    setCardOpen(false);
    setFeed([]);
    setCurrentEventId(undefined);
    setViewDate(undefined);
    setBookingOpen(false);
    try {
      await deskApi.reset();
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const onAlreadyApplied = useCallback(() => {
    setDecision('committed');
    void load();
  }, [load]);

  // The event card's "Done" summary and the feed say the schedule changed; no pop-up.
  const onCommitted = useCallback(() => {
    setDecision('committed');
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
  // Greyed out for the whole day only; a part-day absence still has working hours.
  const unavailablePayload =
    lastBody?.type === 'technician_unavailable' && proposal
      ? (lastBody.payload as { technicianId?: string; from?: string; until?: string })
      : undefined;
  const unavailableTechId =
    unavailablePayload && !unavailablePayload.from && !unavailablePayload.until ? unavailablePayload.technicianId : undefined;
  const unassigned = board.jobs.filter((j) => !j.technician).length;
  const today = board.today;
  const lookingAhead = Boolean(today) && board.date !== today;
  const incoming = lastAttempt ? findDisruption(lastAttempt.disruptionKey) : undefined;
  const headerStatus: { label: string; tone: 'warning' | 'success' } =
    busy && incoming && !proposal
      ? { label: 'Something just came in', tone: 'warning' }
      : proposal && decision === null
      ? { label: 'Waiting for your decision', tone: 'warning' }
      : decision === 'rejected'
        ? { label: 'Arrange this one manually', tone: 'warning' }
        : { label: 'Schedule up to date', tone: 'success' };

  const openEvents = feed.filter((i) => {
    const e = statuses[i.eventId];
    return e && e !== 'missing' && eventStatusCopy(e.status).open;
  }).length;
  const latest = feed.find((i) => statuses[i.eventId] && statuses[i.eventId] !== 'missing');
  const latestEvent = latest ? statuses[latest.eventId] : undefined;
  const hasEvent = Boolean(proposal) || (Boolean(incoming) && (busy || Boolean(planError)));
  const cardVisible = cardOpen && hasEvent;
  const pending = (busy && Boolean(incoming)) || (Boolean(proposal) && decision === null);
  // Frame map changes in the part of the map no floating layer covers.
  const insets: MapInsets = {
    top: 16,
    right: feedOpen && wide ? feedSize.width + 28 : 16,
    left: cardVisible && wide ? cardSize.width + 28 : 16,
    bottom: tableOpen ? drawerSize.height + 16 : cardVisible && !wide ? cardSize.height + 16 : 16,
  };

  return (
    <div className="fixed inset-0 grid grid-rows-[48px_minmax(0,1fr)_40px] bg-background">
      {/* Top bar */}
      <header className="z-20 grid grid-cols-[1fr_auto] items-center gap-3 border-b bg-background px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_0_18px_-4px] shadow-blue-500/70">
            <Snowflake className="size-4" />
          </div>
          <span className="truncate text-sm font-semibold">Dispatch Coordinator</span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">Eastwind Aircon</span>
        </div>
        <div className="flex items-center justify-end gap-2">
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
                <span className="hidden sm:inline">{headerStatus.label}</span>
              </Badge>
            </motion.div>
          </AnimatePresence>
          <Select value={priority} onValueChange={(v) => setPriority(v as PlanProfile)} disabled={busy}>
            <SelectTrigger size="sm" className="w-auto gap-1.5" title={`${PROFILE_COPY[priority].promise} This decides which option is recommended.`}>
              <span className="hidden text-muted-foreground xl:inline">Priority</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="sla_first">{PROFILE_COPY.sla_first.name}</SelectItem>
              <SelectItem value="minimal_disruption">{PROFILE_COPY.minimal_disruption.name}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setListOpen((o) => !o)}
            aria-label="Show jobs and technicians"
            aria-pressed={listOpen}
          >
            <List />
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0">
        {/* Left rail */}
        <nav className="z-10 flex w-[52px] flex-none flex-col items-center gap-2 border-r bg-background py-2.5" aria-label="Tools">
          <span title="You: coordinator" className="grid size-8 place-items-center rounded-full border bg-secondary text-[11px] font-bold">
            C
          </span>
          <span className="my-0.5 h-px w-6 bg-border" />
          <RailButton
            label={hasEvent ? (cardVisible ? 'Hide the event' : 'Show the event') : 'No events'}
            active={cardVisible}
            onClick={() => {
              if (!hasEvent) {
                // Nothing to show: the feed's empty state says so, in place.
                setFeedOpen(true);
                return;
              }
              setCardOpen((o) => !o);
            }}
          >
            <Bell />
            {pending && !cardVisible ? (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9.5px] font-bold text-white ring-2 ring-background"
              >
                1
              </motion.span>
            ) : null}
          </RailButton>
          <RailButton label="Today’s events" active={feedOpen} onClick={() => setFeedOpen((o) => !o)}>
            <History />
            {openEvents > 0 && !feedOpen ? (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[9.5px] font-bold text-black ring-2 ring-background"
              >
                {openEvents}
              </motion.span>
            ) : null}
          </RailButton>
          <RailButton
            label="Show all of Singapore"
            onClick={() => {
              setPinnedTechId(undefined);
              setResetSignal((n) => n + 1);
            }}
          >
            <Maximize2 />
          </RailButton>
          <div className="mt-auto">
            <RailButton label="Demo controls" active={demoOpen} onClick={() => setDemoOpen((o) => !o)} className="text-warning">
              <FlaskConical />
            </RailButton>
          </div>
        </nav>

        {/* Map and everything floating on it */}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {/* isolate: Leaflet's own z-indexes stay inside the map. */}
          <div className="absolute inset-0 isolate">
            <MapBoundary>
              <MapView
                board={board}
                plan={preview}
                unavailableTechId={unavailableTechId}
                focusTechId={focusTechId}
                frameTechId={pinnedTechId}
                onFocusTech={setMapHoverTechId}
                onPinTech={togglePin}
                insets={insets}
                resetSignal={resetSignal}
              />
            </MapBoundary>
          </div>

          {/* The event card: arrives from the left, like a message over the map. */}
          <AnimatePresence>
            {cardVisible ? (
              <motion.div
                key="event-card"
                ref={cardRef}
                initial={wide ? { opacity: 0, x: -28, scale: 0.98 } : { opacity: 0, y: 28 }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                exit={wide ? { opacity: 0, x: -20, scale: 0.98 } : { opacity: 0, y: 20 }}
                transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                className={cn(
                  'absolute z-[500] overflow-y-auto overscroll-contain rounded-xl shadow-[0_24px_60px_-20px_rgb(0_0_0/0.85)]',
                  'inset-x-2 bottom-2 max-h-[46%]',
                  'md:inset-x-auto md:top-3 md:bottom-auto md:left-3 md:max-h-[calc(100%-24px)] md:w-[380px]',
                )}
              >
                <button
                  type="button"
                  onClick={() => setCardOpen(false)}
                  aria-label="Close the event"
                  className="absolute top-2 right-2 z-10 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
                <div className="grid gap-3">
                  {incoming && (busy || planError) && !proposal ? (
                    <Card className="fx-attention overflow-hidden border-warning/30 bg-card/95">
                      {busy ? <BorderBeam duration={4} /> : null}
                      <CardHeader className="pr-10">
                        <CardDescription className="flex items-center gap-2 text-xs font-semibold tracking-wide text-warning uppercase">
                          <motion.span
                            animate={{ rotate: [0, -14, 12, -8, 6, 0] }}
                            transition={{ duration: 0.8, delay: 0.25 }}
                            className="inline-flex"
                          >
                            <Bell className="size-4" />
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
                          <Skeleton className="h-20 rounded-lg" />
                          <Skeleton className="h-20 rounded-lg [animation-delay:150ms]" />
                        </CardContent>
                      ) : null}
                    </Card>
                  ) : null}

                  {planError ? (
                    <div className="rounded-xl bg-card/95">
                      <RefusalNotice
                        refusal={planError}
                        busy={busy}
                        onRetry={() => {
                          if (lastAttempt) void simulate(lastAttempt.disruptionKey, lastAttempt.profile);
                        }}
                      />
                    </div>
                  ) : null}

                  {proposal && lastAttempt ? (
                    <div className="[&>[data-slot=card]]:bg-card/95">
                      <ProposalPanel
                        result={proposal}
                        board={board}
                        source={findDisruption(lastAttempt.disruptionKey).source}
                        title={findDisruption(lastAttempt.disruptionKey).headline}
                        detail={findDisruption(lastAttempt.disruptionKey).detail}
                        onCommitted={onCommitted}
                        onRejected={() => setDecision('rejected')}
                        onAlreadyApplied={onAlreadyApplied}
                        onPreview={setPreview}
                        memory={proposalMemory}
                        onMemoryChange={setProposalMemory}
                      />
                    </div>
                  ) : null}

                  {proposal ? (
                    <div className="[&>[data-slot=card]]:bg-card/95">
                      <TraceDrawer
                        eventId={proposal.proposal.eventId}
                        refreshKey={feedRefresh}
                        awaitingDecision={decision === null}
                      />
                    </div>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Today's events: floats on the right of the map, opposite the event card. */}
          <AnimatePresence>
            {feedOpen ? (
              <motion.section
                key="feed"
                ref={feedRef}
                initial={wide ? { opacity: 0, x: 28 } : { opacity: 0, y: -16 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={wide ? { opacity: 0, x: 20 } : { opacity: 0, y: -16 }}
                transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                className={cn(
                  'absolute z-[550] flex flex-col overflow-hidden rounded-xl border bg-card/95 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.85)] backdrop-blur-md',
                  'inset-x-2 top-2 max-h-[60%]',
                  'md:inset-x-auto md:top-3 md:right-3 md:max-h-[calc(100%-24px)] md:w-[360px]',
                )}
                aria-label="Today’s events"
              >
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                  <div>
                    <h2 className="text-sm font-semibold">Today’s events</h2>
                    <p className="text-[11px] text-muted-foreground">
                      {feed.length === 0
                        ? 'Nothing yet'
                        : `${feed.length} received · ${openEvents} waiting on you`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeedOpen(false)}
                    aria-label="Close today’s events"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="min-h-0 overflow-y-auto overscroll-contain">
                  <EventFeed
                    items={feed}
                    statuses={statuses}
                    refreshKey={feedRefresh}
                    currentEventId={currentEventId}
                    onOpenCurrent={() => setCardOpen(true)}
                  />
                </div>
              </motion.section>
            ) : null}
          </AnimatePresence>

          {/* The job table, pulled up from the bottom bar. */}
          <AnimatePresence>
            {tableOpen ? (
              <motion.section
                key="drawer"
                ref={drawerRef}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                className="absolute inset-x-0 bottom-0 z-[600] max-h-[55%] overflow-y-auto border-t bg-background/95 backdrop-blur-md"
                aria-label="Table"
              >
                <button
                  type="button"
                  onClick={() => setTableOpen(false)}
                  aria-label="Close"
                  className="absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ChevronDown className="size-4" />
                </button>
                <div className="px-7 pt-4 pb-3">
                  <BoardView board={board} />
                </div>
              </motion.section>
            ) : null}
          </AnimatePresence>

          {/* Demo controls: stand-in for the outside world. */}
          <AnimatePresence>
            {demoOpen ? (
              <motion.div
                key="demo"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                className="absolute bottom-3 left-3 z-[700] w-[min(290px,calc(100%-24px))] rounded-xl bg-background/95 shadow-[0_24px_50px_-20px_rgb(0_0_0/0.8)] backdrop-blur-md"
              >
                <Simulator
                  busy={busy}
                  disabled={lookingAhead || (Boolean(proposal) && decision === null)}
                  disabledNote={lookingAhead ? 'Switch back to today to send events.' : undefined}
                  onSimulate={(k) => void simulate(k)}
                  onReset={() => void reset()}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </main>

        {/* Right panel: what needs a technician, then the team and their stops. */}
        <aside
          className={cn(
            'z-[800] w-[340px] flex-none border-l bg-card',
            'max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:w-[min(340px,calc(100%-52px))] max-md:shadow-2xl max-md:transition-transform max-md:duration-300',
            !listOpen && 'max-md:translate-x-full',
          )}
          aria-label="Jobs and technicians"
        >
          <TechList
            board={board}
            plan={preview}
            unavailableTechId={unavailableTechId}
            focusTechId={focusTechId}
            pinnedTechId={pinnedTechId}
            onFocusTech={setListHoverTechId}
            onPinTech={togglePin}
            onOpenJob={pending ? () => setCardOpen(true) : undefined}
            onFindTechnician={
              busy || pending || lookingAhead ? undefined : (row) => void simulate(disruptionForJob(row).key)
            }
            onMarkUnavailable={
              busy || pending || lookingAhead
                ? undefined
                : (technicianId, availability) => {
                    const tech = board.technicians.find((t) => t.technician.id === technicianId)?.technician;
                    if (tech) void simulate(disruptionForUnavailable(tech, board.date, availability).key);
                  }
            }
            onReportLate={
              busy || pending || lookingAhead ? undefined : (row, minutes) => void simulate(disruptionForOverrun(row, minutes).key)
            }
            onNewJob={busy || pending || lookingAhead ? undefined : () => setBookingOpen(true)}
            newJobForm={
              bookingOpen && !lookingAhead ? (
                <NewJobForm loadTypes={loadJobTypes} onBook={bookJob} onCancel={() => setBookingOpen(false)} />
              ) : null
            }
          />
        </aside>
      </div>

      {/* Bottom bar */}
      <footer className="z-20 flex items-center gap-1 overflow-x-auto border-t bg-background px-2 text-xs whitespace-nowrap [scrollbar-width:none]">
        <span className="flex items-center gap-1.5 px-2 text-muted-foreground">
          <Clock className="size-3.5" />
          {today ? (
            <span role="group" aria-label="Day shown" className="flex items-center rounded-md border p-0.5">
              {[today, addDays(today, 1)].map((day, i) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={board.date === day}
                  disabled={busy || (pending && day !== today)}
                  onClick={() => setViewDate(day === today ? undefined : day)}
                  className={cn(
                    'rounded px-2 py-0.5 font-medium transition-colors disabled:opacity-50',
                    board.date === day ? 'bg-muted text-foreground' : 'hover:text-foreground',
                  )}
                >
                  {i === 0 ? 'Today' : 'Tomorrow'} · {formatDay(day)}
                </button>
              ))}
            </span>
          ) : (
            <span className="font-medium text-foreground">{formatDay(board.date)}</span>
          )}
          {lookingAhead ? <Badge variant="outline">Looking ahead · read only</Badge> : null}
        </span>
        <span className="px-2 text-muted-foreground">
          Schedule version{' '}
          <span className="font-mono font-semibold text-foreground">
            <NumberTicker value={board.snapshot.version} />
          </span>
        </span>
        <span className="px-2 text-muted-foreground">
          <span className={cn('font-mono font-semibold', unassigned > 0 ? 'text-destructive' : 'text-success')}>
            <NumberTicker value={unassigned} />
          </span>{' '}
          {unassigned === 1 ? 'job needs' : 'jobs need'} a technician
        </span>
        {latest && latestEvent && latestEvent !== 'missing' ? (
          <button
            type="button"
            onClick={() => setFeedOpen(true)}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open today’s events"
          >
            <SourceIcon source={findDisruption(latest.disruptionKey).source} className="size-3.5 shrink-0" />
            <span className="font-mono">{receivedTime(latestEvent.receivedAt)}</span>
            <span className="truncate text-foreground">{findDisruption(latest.disruptionKey).headline}</span>
            <Badge variant={eventStatusCopy(latestEvent.status).tone} className="py-0 text-[10.5px]">
              {eventStatusCopy(latestEvent.status).label}
            </Badge>
          </button>
        ) : null}
        <span className="flex-1" />
        <BarToggle active={tableOpen} onClick={() => setTableOpen((o) => !o)}>
          <Table2 className="size-3.5" />
          Table
        </BarToggle>
      </footer>
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  className,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'relative grid size-9 place-items-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[18px]',
        active && 'border-primary/35 bg-primary/15 text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

function BarToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active && 'bg-primary/15 text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Tracks an element's rendered size, for keeping map framing clear of it. */
function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) {
      setSize({ width: 0, height: 0 });
      return;
    }
    observer.current = new ResizeObserver(([entry]) => {
      const box = entry!.target.getBoundingClientRect();
      setSize((prev) =>
        Math.abs(prev.width - box.width) < 8 && Math.abs(prev.height - box.height) < 8
          ? prev
          : { width: Math.round(box.width), height: Math.round(box.height) },
      );
    });
    observer.current.observe(el);
  }, []);
  return [ref, size];
}


const FEED_KEY = 'desk:today-events';
