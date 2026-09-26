import { AlertCircle, Loader2, RotateCw } from 'lucide-react';
import { refusalCopy } from './copy';
import { type Refusal, isRetryablePlanningCode } from './refusals';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

/**
 * Renders a planning refusal faithfully: the human detail the backend sent,
 * plus its code as a tag for the trust story. A Retry button appears only for
 * transient dependency failures, which are the only refusals a retry can clear.
 */
export function RefusalNotice({
  refusal,
  busy,
  onRetry,
}: {
  refusal: Refusal;
  busy: boolean;
  onRetry: () => void;
}) {
  const retryable = isRetryablePlanningCode(refusal.code);
  const copy = refusalCopy(refusal.code);
  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
      <AlertCircle />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {copy.title}
      </AlertTitle>
      <AlertDescription>
        <p className="text-foreground/80">{copy.detail}</p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Technical details:
          <Badge variant="danger" className="font-mono">
            {refusal.code}
          </Badge>
          {refusal.detail}
        </p>
        {retryable ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={onRetry} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
              {busy ? 'Trying again…' : 'Try again'}
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
