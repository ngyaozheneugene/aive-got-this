# Member 4: surfaces

**Stream:** The PWA, three roles, one board<br>
**Folders:** `src/app/`, except `src/app/api/`<br>
**Status:** Week-1 critical path. The desk board is a week-1 deliverable, not a week-2 one.

You own everything a human touches. Three surfaces share one Next.js PWA: a customer who pastes a message, a technician who clocks in and accepts offers, and a desk that sees ranked suggestions and approves the risky ones. The demo is eight minutes of your screen, so the trace has to be legible, not just present.

---

## 1. Mission

Make the agent's reasoning visible. Every assign has a Why?, every approval card names who would be late, and nothing on screen is a second source of truth.

---

## 2. What you own

| Folder | Contents |
|---|---|
| `src/app/(customer)/` | Paste a message or pick a job type, at most two questions, status and ETA. |
| `src/app/(technician)/` | Clock in, incoming offers with a 10-minute countdown, today in stop order, escalate, site note at close. |
| `src/app/(desk)/` | The board, ranked suggestions, approval cards, the Why? trace, drag with a reason. |
| `src/app/_components/` | Components used by more than one surface, and the Cognito session wiring. The underscore is what keeps Next.js from routing it. |
| `public/` | PWA manifest and icons. |

There is no fourth role. Admin is a Cognito group, not a surface.

> **Note:** `src/app/api/` belongs to member 1. You call those handlers; you do not write them. Everything else under `src/app/` is yours.

> **Warning:** a route group in brackets does not add a URL segment. `(customer)`, `(technician)` and `(desk)` all resolve to the same paths, so at most one of them may define `page.tsx` at its own root, or the build fails with a duplicate-route error. Give each surface a named path inside its group, for example `(technician)/today/page.tsx`, and let `src/app/page.tsx` redirect on the Cognito group. The groups exist so each surface can have its own `layout.tsx`, not to namespace the URLs.

---

## 3. Contracts

### 3.1 You consume

- **Member 1's read models** in `src/shared/types/`: board, job, technician day, approval card. You render these and derive nothing that the server could have told you.
- **Member 2's `RankedTechnician` and exclusion reasons.** The Why? panel shows the Stage A exclusions and the Stage B breakdown as data, not as prose you write.
- **Member 3's `decision_log`.** The Why? control opens the stored row. It does not re-explain the decision in the browser.

### 3.2 You publish

- Nothing other people build on, which is why you can move fast once contracts are frozen on day two.

> **Note:** you are the only stream with no downstream consumer, so when week 2 slips, cutting from your list costs the team least. That is also why the copilot and the dashboard are on the cut list and the Why? panel is not.

---

## 4. Week by week

### 4.1 Week 1, the board

- App shell, Cognito session, three route groups behind the three groups.
- Customer: paste a message, see the two questions, watch status and ETA.
- Technician: clock in, receive an offer, accept it.
- Desk: the board with the top three per job and the score breakdown, assign from a suggestion, or override with a reason.

Build against member 1's in-memory double and member 2's fixtures from day two. Do not wait for RDS.

**Done when** the desk sees Wei excluded and Ahmad first, the technician accepts, and the customer status moves.

### 4.2 Week 2, the approval queue

- Approval cards showing the recommendation and who would be late.
- The Why? trace viewer over `decision_log`.
- Offer countdown and expiry.
- Drag to reassign, with a mandatory reason.

**Done when** an 08:20 no-show puts one tight-window card in the queue, the desk approves it in one click, and the trace shows the interrupt and the resume.

### 4.3 Week 3, polish and the demo

- The dashboard: travel week 1 against week 3, eval pass rate, Bedrock spend against the $100 cap.
- The desk copilot panel, on read-only tools.
- The scripted Tuesday, rehearsed end to end.

**Done when** a stranger can run the whole flow without narration.

---

## 5. Surface rules

These are product rules from root README §9 and §13, and two of them are safety controls rather than niceties.

- **The unit number stays masked until `en_route`.** This is a query-layer mask from member 1, so do not cache an unmasked address and re-render it.
- **Untrusted text renders as a quote.** Customer notes and site notes are displayed as quoted blocks, visibly not part of the interface's own voice.
- **A technician cannot clock out while on site.**
- **Offers expire in 10 minutes** and become declines. The countdown is honest; it does not round up.
- **An override always takes a reason.** Legal gates are still rejected server-side, so surface the rejection rather than hiding the control.
- **Customer status is a read of Dispatch.** Never keep a parallel status in client state.

---

## 6. Demo, and what it needs from you

The eight-minute run in root README §15 is almost entirely your screen. Steps 2, 4, 6 and 7 are yours to make legible.

| Step | What has to be obvious on screen |
|---|---|
| 2 | Wei excluded with a reason, Ahmad first, Raj second, Mei third |
| 4 | Three auto offers, one approval card naming who would be late, then resume |
| 5 | A proposal that does not move the other job |
| 6 | The injected note rendered as a quote, with Wei still hidden |
| 7 | Travel week 1 against week 3, pass rate, spend against the cap |

---

## 7. Rules you cannot break

- **Render read models, do not assemble them.** If the board needs a field, ask member 1 for it rather than joining in the browser.
- **The Why? panel shows stored reasons.** It never re-derives a score in TypeScript, because then the screen and the trace could disagree.
- **No free text to a customer.** Notifications are templates owned by member 3's `notify` tool.
- **Three Cognito groups, three route groups.** A surface never renders a control the session's group cannot use.
