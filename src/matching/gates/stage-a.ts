import type { EligibleTechnician, Job, Technician } from '../../shared/types/domain';

/** G1: Stage A eligibility. Nearby is not eligibility. */
export function stageA(_job: Job, _technicians: Technician[]): EligibleTechnician[] {
  return [];
}
