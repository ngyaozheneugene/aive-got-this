import type { DeskBoard } from '../../shared/types/domain';
import { badge, card, label, line } from './ui';

/** Renders member 1's board read model as-is. No client-side joins. */
export function BoardView({ board }: { board: DeskBoard }) {
  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div style={card}>
        <span style={label}>Snapshot</span>
        <p style={{ margin: '4px 0 0', fontSize: 18 }}>
          <strong>v{board.snapshot.version}</strong> · {board.date} ·{' '}
          {board.technicians.length} technicians · {board.jobs.length} jobs
        </p>
      </div>

      <div style={card}>
        <span style={label}>Technicians</span>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
          <tbody>
            {board.technicians.map((row) => (
              <tr key={row.technician.id} style={{ borderTop: `1px solid ${line}` }}>
                <td style={{ padding: '6px 8px' }}>{row.technician.name}</td>
                <td style={{ padding: '6px 8px', color: '#6b6455' }}>
                  {row.technician.currentCluster ?? '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{row.loadMinutes} min</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  {row.assignedJobIds.length} jobs
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <span style={label}>Jobs</span>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
          <tbody>
            {board.jobs.map((row) => {
              const locked = row.job.lockState && row.job.lockState !== 'none';
              return (
                <tr key={row.job.id} style={{ borderTop: `1px solid ${line}` }}>
                  <td style={{ padding: '6px 8px' }}>
                    <strong>{row.customer.name}</strong>
                    <div style={{ color: '#6b6455', fontSize: 12 }}>{row.site.addressLine1}</div>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {row.job.priority === 'urgent' ? (
                      <span style={badge('bad')}>urgent</span>
                    ) : (
                      <span style={{ color: '#6b6455' }}>{row.job.priority}</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{row.job.status}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {locked ? <span style={badge('warn')}>{row.job.lockState}</span> : null}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {row.technician?.name ?? <span style={{ color: '#6b6455' }}>unassigned</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
