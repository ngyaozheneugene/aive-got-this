'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DeskBoard, PlanProfile } from '../../../shared/types/domain';
import { DeskApiError, deskApi, type PlanResult } from '../../_components/desk-api';
import { BoardView } from '../../_components/BoardView';
import { Simulator } from '../../_components/Simulator';
import { ProposalPanel } from '../../_components/ProposalPanel';
import { ghostBtn, label } from '../../_components/ui';

const RAFFLES_JOB_ID = 'job_raffles';

export default function DeskPage() {
  const [board, setBoard] = useState<DeskBoard | null>(null);
  const [proposal, setProposal] = useState<PlanResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
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
    async (profile: PlanProfile) => {
      if (!board) return;
      setBusy(true);
      setSimError(null);
      setProposal(null);
      try {
        const event = await deskApi.createUrgentEvent(RAFFLES_JOB_ID, board.snapshot.id);
        setProposal(await deskApi.plan(event.id, profile));
      } catch (e) {
        setSimError(
          e instanceof DeskApiError
            ? `${e.code}${e.detail ? ` — ${e.detail}` : ''}`
            : 'Planning failed.',
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
    setSimError(null);
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

        <Simulator busy={busy} disabled={Boolean(proposal)} onSimulate={(p) => void simulate(p)} />

        {simError ? (
          <p style={{ margin: 0, color: '#8c2f21', fontSize: 13 }}>
            <strong>Planning refused:</strong> {simError}
          </p>
        ) : null}

        {proposal ? <ProposalPanel result={proposal} onCommitted={onCommitted} /> : null}

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
