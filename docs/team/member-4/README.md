# Member 4: desk

**Stream:** Coordinator experience
**Folders:** `src/app/` except `src/app/api/`; `public/`
**Plan role:** C
**Secondary reviewer:** member 3

You own what a stranger sees in four minutes. The demo is your screen. Build the desk first. Technician status is P1 after G2. Customer paste-intake is not P0.

---

## 1. Mission

Make the disruption, the two plans, the risk, and the required action obvious without logs.

---

## 2. What you own

| Folder | Contents |
|---|---|
| `src/app/(desk)/` | Timeline (technician rows, jobs, travel/buffer, SLA). Event simulator. Side-by-side plans. Risk badge. Approve / reject. Trace drawer. |
| `src/app/(technician)/` | P1 after G2: en route, arrived, running late, part required, completed. |
| `src/app/(customer)/` | Not P0. Do not spend Week 1 here. |
| `src/app/_components/` | Shared chrome. Demo-role switcher, not Cognito. |
| `public/` | Assets. Skip PWA until the desk is real. |

Route groups still must not each define a root `page.tsx`. Named paths inside groups. `src/app/page.tsx` can send a demo role to the desk.

`src/app/api/` belongs to member 1. You call it.

---

## 3. Contracts

**You consume**

- Board, proposal, and approval read models from member 1.
- Reason codes and plan metrics from member 2. Why? does not re-score in the browser.
- `decision_log` from member 3.

**You publish**

- Nothing other streams compile against. If Week 2 slips, cut the map and the technician page before Why? or compare.

---

## 4. Weeks

**Week 1.** Shell, timeline from fixtures, proposal card for the urgent job. Mock the API until member 1’s handlers exist. G1: a first-time observer can see the disruption and two plans.

**Week 2.** Compare, approve, committed snapshot, trace. Wire unavailable and overrun simulators. Location panel if it helps the story; not a live map.

**Week 3.** Loading / empty / failure states, copy, keyboard path, rehearsal mode, demo reset control. Technician status only if G2 is green.

---

## 5. Demo surface

| Beat | On screen |
|---|---|
| Establish | Six techs, load, locked promises |
| Trigger | Raffles Place job; nearest van visibly unqualified |
| Compare | SLA-first vs minimal-disruption, metrics from the server |
| Decide | Medium-risk approval |
| Recover | New snapshot |
| Trust | Why / why-not + audit drawer |

---

## 6. Rules

- Render read models. Do not join a second board in client state.
- Why? shows stored reasons and metrics.
- Untrusted notes render as quotes.
- Overrides always take a reason. Legal gates still fail server-side; show the rejection.
- No Cognito. Demo roles are enough for the hackathon box.
