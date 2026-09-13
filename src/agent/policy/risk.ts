import { RISK_POLICY } from '../../shared/config/reason-codes';
import type { AutonomyMode, RiskLevel } from '../../shared/types/domain';

export function modeForRisk(risk: RiskLevel): AutonomyMode {
  return RISK_POLICY[risk];
}
