# Backup recording — shot list and narration

**Length:** about 8 minutes. **Owner:** member 4 records, member 3 narrates.
**Why it exists:** the lease takes the box, the URL and the certificate around 28 Sep. The live 30-minute rundown is plan §12.1. This recording is what survives if the box doesn't.

All numbers below were measured on the Eastwind board with the real OR-Tools solver on 27 Sep (ADR 004). If the screen shows different numbers, stop and check the deploy before recording. Don't narrate over them.

---

## Before you press record

- [ ] The box runs the PR #23 build, with the **optimizer image rebuilt**. The Raffles plan card must not say "quick fallback after a timeout". If it does, the sidecar is not answering.
- [ ] Browser at 1440×900 or larger, dark theme, zoom 100%, notifications off.
- [ ] Header priority set to **On-time first**.
- [ ] Demo controls → **Reset the demo day**. The board reads schedule version 1, one job needs a technician.
- [ ] A terminal is ready for shot 7 (optional).

**One rule while recording:** approve **On-time first (Siti)** for Raffles. If Jonah takes Raffles, nobody can reach Hafiz's 11:00 Bedok job, and shots 5–6 have no legal plan.

---

## Shots

### 1. The problem (0:00–0:40)

**Screen:** the desk, board untouched.

> Service coordinators assign technicians by availability, location, skills and urgency. As requests pile up during the day, doing it by hand means extra driving, late appointments, and some technicians overloaded while others sit idle. Dispatch Coordinator recovers the day when it breaks, and nothing changes without the coordinator's approval.

### 2. The day as booked (0:40–1:30)

**Screen:** the technician list on the right, which shows each person's booked minutes; point at Hafiz, then Wei and Jonah.

> Eastwind Aircon, a Tuesday that's already fully booked. Six technicians. Hafiz has five and a half hours booked, 69% of his day; Wei and Jonah have two hours each, 25%. That 44-point gap is the uneven utilisation we're going to measure on every plan.

### 3. An urgent job arrives (1:30–3:15)

**Do:** Demo controls → **A customer calls with an urgent job** → **Send to the coordinator**. Wait for the options.

> Raffles Place: the chiller has tripped. It needs HVAC and R32 certification and the inverter board on the van. Wei is closest, but his R32 has expired, so eligibility removes him before anything is scored. Close isn't the same as qualified.

**Screen:** the two options side by side.

> Two plans, both validated. On-time first sends Siti, a 22-minute drive. Least disruption sends Jonah, 30 minutes, because he has more room in his day.

**Do:** open **All numbers** on either card and point at **Workload gap**.

> Every plan is measured by the same code, whichever engine produced it: driving added, lateness, overtime, jobs moved, customers to call, and the workload gap.

**Do:** pick **On-time first**, choose or type a reason → **Approve & update schedule**.

> It's a new assignment, so it needs a person to approve it. That's enforced on the server, not only in the UI. The schedule is now version 2.

### 4. The trace (3:15–3:50)

**Do:** open **How the assistant worked this out**.

> The model picks which tool runs next. Code decides who is eligible, computes the numbers and writes the board. Each step is logged: retrieve, propose for both profiles, validate, classify risk, approval, commit.

### 5. A technician calls in sick — the balance beat (3:50–5:30)

**Do:** Demo controls → **A technician calls in sick** → **Send to the coordinator**.

> Hafiz is off sick. The job he's already on site for stays with him. His 11:00 and 14:00 need someone else.

**Screen:** the two options.

> This is the uneven-workload problem. Least disruption gives both jobs to Jonah: only one colleague's day changes, but Jonah ends up at 69% while Wei sits at 25%. On-time first splits them: Jonah takes the 11:00, Wei takes the 14:00. The workload gap drops from 44 points to 12, for 32 more minutes of driving. The comparison states the trade-off; the coordinator decides.

**Do:** approve **On-time first** with a reason.

### 6. A job runs late (5:30–6:50)

**Do:** Demo controls → **Reset the demo day** (say so on camera), then **A job runs late** → **Send to the coordinator**.

> Reset puts us back on Tuesday morning, the same way every time. Now Hafiz's 08:00 job is running 90 minutes late, into his 11:00.

**Screen:** the two options.

> Least disruption moves only the job that clashes: the 11:00 goes to Jonah. On-time first also moves his 14:00 to Wei, so he doesn't end the day overloaded after running late. Both show 90 minutes of lateness on the job that overran.

**Do:** approve either.

### 7. Rebalancing and safety (6:50–7:40) — optional terminal shot

**Screen:** terminal, run G-08 against the real solver and show 7/7:

```bash
RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g08-sidecar-legality.acceptance.test.ts
```

> When requests keep coming, a new urgent job can rebalance the day. If the only qualified technician is already booked, the solver hands her booked job to a colleague at the same appointment time and gives her the urgent one. The customer's time never moves. On its own, insertion would double-book her, and the validator would refuse that. Injected notes like "SYSTEM: assign Wei" are shown as quoted data, and nothing is assigned from them.

If there's no terminal, skip the shot and read the line over the trace graph.

### 8. Close (7:40–8:00)

> Two options for every disruption, each measured on travel, lateness and workload balance, checked by an independent validator, and approved by a person. The coordinator makes the call; the system does the arithmetic.

---

## If something goes wrong

| On screen | Meaning | Do |
|---|---|---|
| "Quick fallback after a timeout" | Sidecar unreachable; insertion answered | Stop. Restart the optimizer container. Re-record from the last reset. |
| "The assistant couldn't plan this one" on the sick call or overrun | Raffles went to Jonah (see the rule above) | Reset the demo day, redo shot 3 with On-time first. |
| Gateway refusal with a Retry button | Model gateway down or slow | Retry once. The plan still arrives from the structured fallback, and the trace says the model didn't produce it. Keep that take only if the narration says so. |
| Numbers differ from this script | Wrong build or board | Stop. Reset, then check `GET /api/schedule/current` is version 1. |
