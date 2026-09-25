'use client';

// Small motion pieces in the style of 21st.dev / Magic UI: a travelling border
// beam, shimmering text, a number ticker, a live dot and a drawn check. All of
// them respect prefers-reduced-motion.
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from './lib/utils';

/** A light that runs around the border of its (relative, rounded) parent. */
export function BorderBeam({
  className,
  duration = 6,
  colorFrom = 'var(--warning)',
  colorTo = 'var(--primary)',
}: {
  className?: string;
  duration?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('fx-border-beam pointer-events-none absolute inset-0 rounded-[inherit]', className)}
      style={
        {
          '--beam-duration': `${duration}s`,
          '--beam-from': colorFrom,
          '--beam-to': colorTo,
        } as React.CSSProperties
      }
    />
  );
}

/** Text with a highlight sweeping across it: "something is happening". */
export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('fx-shimmer bg-clip-text text-transparent', className)}>{children}</span>;
}

/** Counts to its value when it changes, like 21st.dev's number ticker. */
export function NumberTicker({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (v) => Math.round(v).toString());

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.8, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, inView, reduce, mv]);

  return (
    <motion.span ref={ref} className={cn('tabular-nums', className)}>
      {rounded}
    </motion.span>
  );
}

/** A status dot with a soft radar ping. */
export function LiveDot({ tone = 'success', className }: { tone?: 'success' | 'warning'; className?: string }) {
  const color = tone === 'success' ? 'bg-success' : 'bg-warning';
  return (
    <span className={cn('relative inline-flex size-2', className)} aria-hidden>
      <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} />
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  );
}

/** A check mark that draws itself, for "done" moments. */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <motion.svg viewBox="0 0 24 24" fill="none" className={cn('size-5', className)} aria-hidden>
      <motion.circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
      <motion.path
        d="M7.5 12.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.4, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}

/** Slides a panel in from the right; used for anything that just arrived. */
export const slideIn = {
  initial: { opacity: 0, x: 32, scale: 0.98 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: 24, scale: 0.98 },
  transition: { type: 'spring', stiffness: 380, damping: 32 },
} as const;

/** Parent/child variants for a staggered reveal of a list of cards. */
export const stagger = {
  parent: { animate: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } },
  child: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } },
  },
} as const;
