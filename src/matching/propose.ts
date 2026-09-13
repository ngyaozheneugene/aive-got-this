import type { ProposeInput, ProposeOutput } from '../shared/types/domain';

/** G1 fills insertion. G3 routes unavailable/overrun to the sidecar. */
export function propose(_input: ProposeInput): ProposeOutput {
  return {
    plans: [],
    engine: 'insertion',
    timedOut: false,
    message: 'not_implemented',
  };
}
