import { useState } from 'react';
import { FlaskConical, Loader2, RotateCcw, Send } from 'lucide-react';
import { DISRUPTIONS, findDisruption } from './disruptions';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

/**
 * Demo only. Stands in for the outside world — customers calling, the
 * technician app — so a presenter can make an event happen. The coordinator
 * never uses this in real life; events simply arrive on their desk.
 */
export function Simulator({
  busy,
  disabled,
  onSimulate,
  onReset,
}: {
  busy: boolean;
  disabled: boolean;
  onSimulate: (disruptionKey: string) => void;
  onReset: () => void;
}) {
  const [disruptionKey, setDisruptionKey] = useState<string>(DISRUPTIONS[0]!.key);
  const disruption = findDisruption(disruptionKey);
  const inactive = busy || disabled;

  return (
    <section className="grid grid-cols-1 gap-3 rounded-xl border border-dashed border-warning/50 bg-warning/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical className="size-4 text-warning" />
          Demo controls
        </span>
        <Badge variant="warning">Demo only</Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        In real use, these events arrive on the coordinator’s desk by themselves — from customer calls and the
        technician app. Here you play the outside world.
      </p>

      <div className="grid min-w-0 grid-cols-1 gap-2">
        <span className="text-xs font-medium text-muted-foreground">Make this happen</span>
        <Select value={disruptionKey} onValueChange={setDisruptionKey} disabled={inactive}>
          <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DISRUPTIONS.map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{disruption.source}:</span> {disruption.headline}.{' '}
          {disruption.detail}
        </p>
      </div>

      <Button onClick={() => onSimulate(disruptionKey)} disabled={inactive} variant="secondary" className="w-full">
        {busy ? <Loader2 className="animate-spin" /> : <Send />}
        {busy ? 'Sending…' : 'Send to the coordinator'}
      </Button>
      {disabled && !busy ? (
        <p className="text-xs text-muted-foreground">The coordinator has one event to handle first.</p>
      ) : null}

      <Button variant="ghost" size="sm" onClick={onReset} disabled={busy} className="w-full text-muted-foreground">
        <RotateCcw />
        Reset the demo day
      </Button>
    </section>
  );
}
