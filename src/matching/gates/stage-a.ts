import type {
  EligibleTechnician,
  Job,
  JobRequirement,
  Shift,
  StageAExclusionReason,
  Technician,
  TechnicianCert,
} from '../../shared/types/domain';

/**
 * G1: Stage A eligibility gate evaluation.
 * Evaluates technicians against job requirements, skill tiers, active shifts,
 * and valid certifications for the job scheduled date.
 */
export function stageA(
  job: Job,
  technicians: Technician[],
  certs: TechnicianCert[] = [],
  shifts: Shift[] = [],
  requirements: JobRequirement[] = [],
): EligibleTechnician[] {
  const req = requirements.find((r) => r.jobId === job.id);
  const jobDate = job.scheduledDate;

  return technicians.map((technician) => {
    const exclusionReasons: StageAExclusionReason[] = [];

    // 1. Technician active status check
    if (!technician.isActive) {
      exclusionReasons.push('not_clocked_in');
    }

    // 2. Shift status check
    const techShift = shifts.find(
      (s) => s.technicianId === technician.id && s.shiftDate === jobDate,
    );
    if (techShift) {
      if (techShift.status === 'mc' || techShift.status === 'no_show') {
        exclusionReasons.push('on_leave_or_mc');
      } else if (techShift.status !== 'clocked_in' && techShift.status !== 'scheduled') {
        exclusionReasons.push('not_clocked_in');
      }
    }

    // 3. Skill tier requirement check
    if (req && technician.tier < req.minTier) {
      exclusionReasons.push('tier_too_low');
    }

    // 4. Certification and legal gate check
    if (req && req.requiredCerts && req.requiredCerts.length > 0) {
      const techCerts = certs.filter((c) => c.technicianId === technician.id);

      for (const requiredCertType of req.requiredCerts) {
        const matchingCert = techCerts.find((c) => c.certType === requiredCertType);

        if (!matchingCert) {
          exclusionReasons.push('missing_cert');
        } else {
          // Check issuance date
          if (matchingCert.issuedAt > jobDate) {
            exclusionReasons.push('missing_cert');
          }
          // Check expiration date
          if (matchingCert.expiresAt && matchingCert.expiresAt < jobDate) {
            exclusionReasons.push('cert_expired');
          }
        }
      }
    }

    const uniqueReasons = Array.from(new Set(exclusionReasons));

    return {
      technician,
      isEligible: uniqueReasons.length === 0,
      exclusionReasons: uniqueReasons,
    };
  });
}
