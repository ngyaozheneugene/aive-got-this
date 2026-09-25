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
      <div className="grid gap-1">
        <span className="text-sm font-medium">Choose an option</span>
        {plans.length > 1 ? (
          <p className="text-sm text-muted-foreground">
            {plans.every((p) => p.validations.ok && p.status !== 'REJECTED')
              ? 'Both options are safe to use. '
              : 'Only an option that passes every safety check can be chosen. '}
            They trade off speed for the customer against changes to the rest of the team’s day. The one you select
            is drawn on the map and timeline.
          </p>
        ) : null}
        {recommendation ? (
          <p className="flex items-start gap-1.5 text-sm">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
            {recommendation}
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
