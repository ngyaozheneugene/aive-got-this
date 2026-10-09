import { cn } from '../lib/utils';

export const PRODUCT_NAME = 'PAilot';
export const PRODUCT_TAGLINE = 'The AI co-pilot for field-service dispatch';

/** The PAilot mark: a dispatch gauge with a paper plane for a needle. */
export function BrandMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a 256px PNG; next/image adds nothing here.
  return <img src="/brand/pailot-mark.png" alt="" width={28} height={28} className={cn('size-7 flex-none select-none', className)} draggable={false} />;
}

/** "PAilot" with "Ai" in blue, as on the poster. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-bold tracking-tight', className)}>
      P<span className="text-[#50a2ff]">Ai</span>lot
    </span>
  );
}
