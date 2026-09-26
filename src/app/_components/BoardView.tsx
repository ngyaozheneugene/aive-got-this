import { Lock } from 'lucide-react';
import type { DeskBoard } from '../../shared/types/domain';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

/** Renders member 1's board read model as-is. No client-side joins. */
export function BoardView({ board }: { board: DeskBoard }) {
  return (
    <Tabs defaultValue="jobs">
      <TabsList>
        <TabsTrigger value="jobs">Jobs ({board.jobs.length})</TabsTrigger>
        <TabsTrigger value="technicians">Technicians ({board.technicians.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="jobs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Lock</TableHead>
              <TableHead className="text-right">Technician</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.jobs.map((row) => {
              const locked = row.job.lockState && row.job.lockState !== 'none';
              return (
                <TableRow key={row.job.id}>
                  <TableCell>
                    <div className="font-medium">{row.customer.name}</div>
                    <div className="text-xs text-muted-foreground">{row.site.addressLine1}</div>
                  </TableCell>
                  <TableCell>
                    {row.job.priority === 'urgent' ? (
                      <Badge variant="danger">urgent</Badge>
                    ) : (
                      <span className="text-muted-foreground">{row.job.priority}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.job.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {locked ? (
                      <Badge variant="warning">
                        <Lock />
                        {row.job.lockState}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.technician?.name ?? <span className="text-muted-foreground">unassigned</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TabsContent>

      <TabsContent value="technicians">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead className="text-right">Load</TableHead>
              <TableHead className="text-right">Jobs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.technicians.map((row) => (
              <TableRow key={row.technician.id}>
                <TableCell className="font-medium">{row.technician.name}</TableCell>
                <TableCell className="text-muted-foreground">{row.technician.currentCluster ?? '—'}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.loadMinutes} min</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.assignedJobIds.length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TabsContent>
    </Tabs>
  );
}
