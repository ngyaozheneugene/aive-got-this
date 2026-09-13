'use client';

import { useCallback, useEffect, useState } from 'react';

type Board = {
  date: string;
  snapshot: { id: string; version: number };
  technicians: Array<{
    technician: { id: string; name: string; currentCluster?: string };
    loadMinutes: number;
    assignedJobIds: string[];
  }>;
  jobs: Array<{
    job: { id: string; status: string; lockState?: string; priority: string };
    customer: { name: string };
    site: { addressLine1: string; estateCluster: string };
    technician?: { name: string };
  }>;
};

export default function DeskPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/schedule/current', { cache: 'no-store' });
    if (!res.ok) {
      setError(`schedule ${res.status}`);
      return;
    }
    setBoard((await res.json()) as Board);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reset() {
    await fetch('/api/demo/reset', { method: 'POST' });
    await load();
  }

  if (error) {
    return (
      <main>
        <p>{error}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </main>
    );
  }

  if (!board) {
    return <main>Loading Eastwind Tuesday…</main>;
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 960 }}>
      <p style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 12 }}>
        Dispatch Coordinator · Eastwind Aircon
      </p>
      <h1>Coordinator desk</h1>
      <p>
        Snapshot v{board.snapshot.version} · {board.date} · {board.technicians.length} technicians ·{' '}
        {board.jobs.length} jobs
      </p>
      <p>
        <button type="button" onClick={() => void reset()}>
          Reset Tuesday
        </button>
      </p>
      <h2>Technicians</h2>
      <ul>
        {board.technicians.map((row) => (
          <li key={row.technician.id}>
            {row.technician.name} ({row.technician.currentCluster}) · {row.loadMinutes} min ·{' '}
            {row.assignedJobIds.length} jobs
          </li>
        ))}
      </ul>
      <h2>Jobs</h2>
      <ul>
        {board.jobs.map((row) => (
          <li key={row.job.id}>
            <strong>{row.job.id}</strong> {row.customer.name} · {row.site.addressLine1} · {row.job.status}
            {row.job.lockState && row.job.lockState !== 'none' ? ` · ${row.job.lockState}` : ''} ·{' '}
            {row.technician?.name ?? 'unassigned'}
          </li>
        ))}
      </ul>
    </main>
  );
}
