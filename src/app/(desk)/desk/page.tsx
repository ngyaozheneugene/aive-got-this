'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DeskBoard } from '../../../shared/types/domain';
import {
  DeskApiError, deskApi, DISRUPTION_LABEL, type DeskDisruption, type PlanResult,
} from '../../_components/desk-api';
import { BoardView } from '../../_components/BoardView';
import { Simulator } from '../../_components/Simulator';
import { ProposalPanel } from '../../_components/ProposalPanel';
import { TraceDrawer } from '../../_components/TraceDrawer';
import { RefusalNotice } from '../../_components/RefusalNotice';
import type { Refusal } from '../../_components/refusals';
import { ghostBtn, label } from '../../_components/ui';

export default function DeskPage() {
  const [board, setBoard] = useState<DeskBoard | null>(null);
  const [proposal, setProposal] = useState<PlanResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<Refusal | null>(null);
  const [lastDisruption, setLastDisruption] = useState<DeskDisruption | null>(null);
  const [busy, setBusy] = useState(false);

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
    async (disruption: DeskDisruption) => {
      if (!board) return;
      setBusy(true);
      setPlanError(null);
      setProposal(null);
      setLastDisruption(disruption);
      try {
        const event = await deskApi.createEvent(disruption, board.snapshot.id);
        setProposal(await deskApi.plan(event.id, disruption.profile));
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
    [board],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    setProposal(null);
    setPlanError(null);
    setLastDisruption(null);
    try {
      await deskApi.reset();
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const onCommitted = useCallback(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <main style={shell}>
        <p style={{ color: '#8c2f21' }}>{loadError}</p>
        <button type="button" onClick={() => void load()} style={ghostBtn}>
          Retry
        </button>
      </main>
    );
  }

  if (!board) {
    return <main style={shell}>Loading Eastwind Tuesday…</main>;
  }

  return (
    <main style={shell}>
      <header style={{ marginBottom: 20 }}>
        <span style={label}>Dispatch Coordinator · Eastwind Aircon</span>
        <h1 style={{ margin: '4px 0 0' }}>Coordinator desk</h1>
      </header>

      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => void reset()} disabled={busy} style={ghostBtn}>
            Reset Tuesday
          </button>
        </div>

        <Simulator busy={busy} disabled={Boolean(proposal)} onSimulate={(disruption) => void simulate(disruption)} />

        {planError ? (
          <RefusalNotice
            refusal={planError}
            busy={busy}
            onRetry={() => {
              if (lastDisruption) void simulate(lastDisruption);
            }}
          />
        ) : null}

        {proposal && lastDisruption ? (
          <ProposalPanel
            result={proposal}
            title={DISRUPTION_LABEL[lastDisruption.kind]}
            onCommitted={onCommitted}
          />
        ) : null}

        {proposal ? <TraceDrawer eventId={proposal.proposal.eventId} /> : null}

        <BoardView board={board} />
      </div>
    </main>
  );
}

const shell = {
  fontFamily: 'system-ui, sans-serif',
  padding: 24,
  maxWidth: 960,
  margin: '0 auto',
} as const;
