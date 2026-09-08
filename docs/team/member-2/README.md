# Member 2: scheduler

**Stream:** Eligibility, travel, `propose()`, OR-Tools sidecar, G-suite
**Folders:** `src/matching/`, `src/location/`, `services/optimizer/`, `evals/g-suite/`, `evals/fixtures/`
**Plan role:** A
**Secondary reviewer:** member 1

You own who may go and what a legal recovery looks like. The model never does either. Insertion unblocks G1. OR-Tools is the product engine for technician-unavailable and overrun. Product stories: [`docs/usecases.md`](../../usecases.md) UC-01–UC-04, UC-06.

---

## 1. Mission

Make every committed plan falsifiable. Exclusions have reason codes. Two profiles produce different, valid candidates where a trade-off exists. The validator can reject the solver.

---

## 2. What you own

| Folder | Contents |
|---|---|
| `src/matching/gates/` | Stage A. Cert, tier, shift, minutes, window, parts/tools, locks. Nearby is not eligibility. |
| `src/matching/scoring/` | Insertion `propose()`, two weight profiles (SLA-first, minimal-disruption), timeout fallback. |
| `src/matching/` validator | Independent hard-constraint check. No overlap, skills, windows, travel, locks, shifts, unique assignment. |
| `src/location/postal/` | Postal → region / estate. |
| `src/location/matrix/` | Travel minutes. Display may use geometry; scheduling must not. |
| `services/optimizer/` | Python OR-Tools. `POST /propose` and `GET /health`. |
| `evals/g-suite/` | Invariant and ranking cases. No model. |
| `evals/fixtures/` | Travel matrix and seed cases. |

Member 1 wires the sidecar into Compose. You own the model inside it.

---

## 3. Contracts

**You publish**

- `propose(event, schedule, profile) → CandidatePlan[]` in `src/shared/`.
- Exclusion and rejection reason codes (desk Why? renders these).
- Named weight constants in `src/shared/config/`.
- Validator: `validate(plan, schedule) → { ok, violations[] }`.

**You consume**

- Memory DB from member 1 for fixture data only. Pure functions still take plain arguments.

---

## 4. Weeks

**Week 1.** Stage A + insertion `propose()` + validator. Two profiles on the Raffles Place fixture. G-suite: Wei hidden on the leak; no overlap; lock respected. Sidecar may be `/health` only.

**Done when** G1 can show two legal urgent-job plans without Python.

**Week 2.** OR-Tools implements the same `propose()` for unavailable and overrun. Insertion becomes fallback. Live path uses the matrix, not a flat 20 minutes.

**Done when** G3 replans a missing technician without assigning an in-progress job and without stranding a locked SLA unless the plan says so and the desk approves.

**Week 3.** Timeout behaviour, peak multipliers if they change outcomes, travel figures for the demo.

---

## 5. Evals (minimum)

| Id | Must hold |
|---|---|
| G-01 | Raffles / Bedok-style leak: unqualified nearest tech excluded |
| G-02 | Two profiles differ on a fixture with a real trade-off |
| G-03 | Expired legal cert → excluded |
| G-04 | Overlap and lock violations fail the validator even if the solver emits them |
| G-05 | Travel uses the fixture matrix, not crow-flies |
| G-06 | Unavailable: in-progress work stays put |

---

## 6. Rules

- `src/matching/` has no I/O.
- Legal gates (BCA, NEA-R32, and whatever you freeze for LEW) cannot be overridden.
- Certificates checked against the job date.
- Do not call the sidecar from the browser.
- If OR-Tools is late, do not block G1. If OR-Tools is skipped for G3 replans, the product is not done.
