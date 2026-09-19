import type { CandidatePlan } from '../../shared/types/domain';
import { PlanCard } from './PlanCard';
import { label } from './ui';

/** Side-by-side plans. Selection drives which plan the desk approves/commits. */
export function CompareView({
  plans,
  recommendedPlanId,
  selectedPlanId,
  onSelect,
}: {
  plans: CandidatePlan[];
  recommendedPlanId?: string;
  selectedPlanId?: string;
  onSelect: (planId: string) => void;
}) {
  return (
    <div>
      <span style={label}>Plans ({plans.length})</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            recommended={plan.id === recommendedPlanId}
            selected={plan.id === selectedPlanId}
            onSelect={() => onSelect(plan.id)}
          />
        ))}
      </div>
    </div>
  );
}
