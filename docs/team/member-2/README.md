# Member 2: matching and location

**Stream:** The Stage A gate, the Stage B rank, travel, and the G suite<br>
**Folders:** `src/matching/`, `src/location/`, `evals/g-suite/`, `evals/fixtures/`<br>
**Status:** Week-1 critical path, and the most isolated stream on the team.

You own the code that decides who is eligible and what the score is. The model never does either. Your folder is pure TypeScript with no I/O, which means you can start on day two and finish week 1 without touching AWS, the database or the agent.

---

## 1. Mission

Make the ranking auditable. Every exclusion returns a reason a desk operator can read, and every ordering is reproducible from published constants.

---

## 2. What you own

| Folder | Contents |
|---|---|
| `src/matching/gates/` | Stage A. Missing cert, expired cert, below `min_tier`, not clocked in, leave or MC, at `max_minutes_day`, cannot fit the window. |
| `src/matching/scoring/` | Stage B. The five weighted signals, the over-qualification penalty, and crew sizing. |
| `src/location/postal/` | 6-digit postal to planning region and estate from the sector. |
| `src/location/matrix/` | Travel matrix, insertion cost, the 1.4x peak multiplier. |
| `evals/g-suite/` | G-01 to G-06. No model anywhere in this suite. |
| `evals/fixtures/` | The committed travel matrix and seed cases every suite reads. |

---

## 3. Contracts

### 3.1 You publish

- **`EligibleTechnician`** in `src/shared/types/`, carrying the exclusion reason for anyone filtered out. Member 4 renders these reasons in the Why? panel, so the reason codes are part of your public surface, not an internal detail.
- **`RankedTechnician`**, carrying the score breakdown per signal.
- **Scoring constants** in `src/shared/config/`: the five weights, the sub-weights inside qualification fit, the over-qualification penalty, the crew triggers, and the peak window. These are named constants, not literals buried in a function.

### 3.2 You consume

- The in-memory database double from member 1, for test data only. Your functions themselves take plain arguments and return plain values.

---

## 4. Week by week

### 4.1 Week 1, the engine

- Stage A with every exclusion reason enumerated.
- Stage B with the five signals: qualification fit 45%, travel 25%, cluster 10%, workload 10%, SLA risk 10%.
- Crew sizing, taking the maximum across triggers and never the sum.
- Flat 20-minute travel for the live path, committed fixture matrix for evals.
- G-01 to G-06 green in CI.

**Done when** a Bedok Daikin leak hides Wei with `tier_too_low` and `missing NEA_R32`, and returns Ahmad, Raj, Mei in that order, reproducibly.

### 4.2 Week 2, real geography

- Region travel matrix replaces the flat 20 minutes on the live path.
- Insertion cost measured after the previous stop rather than crow-flies.
- Re-rank behaviour for the disruption playbooks member 3 is building.

**Done when** re-ranking after a release produces a different, explicable order.

### 4.3 Week 3, clusters and peak

- Cluster matrix, same block before same estate before same region.
- The 1.4x peak multiplier live during 07:30 to 09:30 and 17:30 to 19:30.
- Travel minutes measured week 1 against week 3 for `evals/reports/`, which is a demo number.

**Done when** the week-1 and week-3 travel figures are both in the report and the difference is real.

---

## 5. Evals you own

| Id | Case | Must hold |
|---|---|---|
| G-01 | Bedok Daikin leak | Wei hidden. Order is Ahmad, Raj, Mei |
| G-02 | Easy wash, equal distance | Apprentice ranks above specialist |
| G-03 | Expired `NEA_R32` | `cert_expired` |
| G-04 | No time left in shift | `no_fit_in_window` |
| G-05 | 08:30 travel | Insertion x 1.4 on the fixture matrix |
| G-06 | 9 units plus ledge | Crew 2, not 3 |

> **Note:** G-05 asserts the peak multiplier in week 1, when the live path is still flat 20 minutes. That works only because the suite reads `evals/fixtures/` and never the live matrix. Keep it that way.

---

## 6. Open questions assigned to you

| Id | Question | Due |
|---|---|---|
| O-06 | Is LEW a hard Stage A gate or a desk flag? Root README §3 and §8 disagree | Week 1, day 2 |
| O-07 | Publish the sub-weights inside the 45% qualification signal, and the size of the over-qualification penalty | Week 1, day 3 |

> **Warning:** until O-07 is answered, G-01 and G-02 are unfalsifiable. G-01 asserts Raj above Mei, which holds only for a particular weighting of brand familiarity against travel. Pick the numbers first, then write the assertion, not the other way round.

---

## 7. Rules you cannot break

- **No I/O.** `src/matching/` never imports HTTP, the AWS SDK, or a database client. If a function needs data, it takes it as an argument.
- **Nearby is not eligibility.** Travel is a Stage B signal only. A closer unqualified technician never appears.
- **Legal gates are absolute.** BCA, NEA-R32 and LEW cannot be overridden by anyone, including the desk. Soft gaps can be, with a reason.
- **Certificates are checked against the job date,** not today. Expired counts as missing.
- **Take the maximum across crew triggers, never the sum.**
