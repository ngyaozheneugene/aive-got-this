import { Lightbulb } from 'lucide-react';
import { motion } from 'motion/react';
import { stagger } from './fx';
import type { CandidatePlan, DeskBoard } from '../../shared/types/domain';
import { PlanCard } from './PlanCard';

/** Side-by-side options. Selection drives which plan the desk approves. */
export function CompareView({
  plans,
  board,
  recommendedPlanId,
  recommendation,
  selectedPlanId,
  onSelect,
}: {
  plans: CandidatePlan[];
  board: DeskBoard;
  recommendedPlanId?: string;
  /** Why the backend recommended its plan, in words. */
  recommendation?: string | null;
  selectedPlanId?: string;
  onSelect: (planId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <div className="grid gap-0.5">
          <span className="text-sm font-semibold">Choose an option</span>
          {plans.length > 1 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {plans.every((p) => p.validations.ok && p.status !== 'REJECTED')
                ? 'Both pass every safety check. '
                : 'Only an option that passes every safety check can be chosen. '}
              The one you select is drawn on the map.
            </p>
          ) : null}
        </div>
        {recommendation ? (
          <p className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/[0.06] px-3 py-2 text-[13px] leading-relaxed">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              <span className="font-semibold text-success">Why it’s recommended: </span>
              {recommendation}
            </span>
          </p>
        ) : null}
      </div>
      <motion.div className="flex flex-wrap gap-3" variants={stagger.parent} initial="initial" animate="animate">
        {plans.map((plan) => (
          <motion.div key={plan.id} variants={stagger.child} className="flex flex-[1_1_260px]">
          <PlanCard
            key={plan.id}
            plan={plan}
            other={plans.find((p) => p.id !== plan.id)}
            board={board}
            recommended={plan.id === recommendedPlanId}
            selected={plan.id === selectedPlanId}
            onSelect={() => onSelect(plan.id)}
          />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
