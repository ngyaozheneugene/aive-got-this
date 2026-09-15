# G0 gateway smoke and G1 urgent agent

> Native integration follow-up: see [native-integration.md](native-integration.md).
> After applying that source change, the client defaults to native rather than strict JSON.
> Live client/graph verification is still required; the original implementation evidence below is historical.

Owner: Deen (member 3). Implementation date: 15 September 2026.
Branch: `member-3/gateway-urgent-agent`.
The authoritative completion checklist remains [`docs/tasks.md`](../../tasks.md).

## Current evidence and limits

The offline regression suite passes: **88 passed, 1 live test skipped, 2 acceptance TODOs**.
`npm run typecheck` and `npm run build` both pass. The original baseline was 43 passing tests.

The G1 LangGraph path is implemented and exercised against scheduler/model contract doubles:

```text
model chooses retrieve_board
  -> model chooses propose for each of the two profiles
  -> model chooses validate for each returned candidate
  -> return independently checked candidates and an in-memory execution trace
```

This is not evidence that real scheduling works. Member 2's current `propose()` still returns
`message: 'not_implemented'`; `validatePlan()` still returns unconditional success.
The real-stub integration test expects **`blocked_dependency / SCHEDULER_NOT_IMPLEMENTED`**,
not a fabricated feasible or infeasible result. Both G0 smoke and the G1 agent checkbox remain open.

No live gateway call was made during implementation. A remote credential-file write was blocked;
no credential was stored by this change. The owner must configure the ignored environment file locally.
No native-tools success is claimed. Production uses strict JSON regardless of smoke outcome.

## Starter-kit adaptation

The supplied `ShowMeYourAgent-Starter-Kit-main.zip` contains `test_llm_gateway.py`,
`test_llm_gateway_langgraph.py`, `test_llm_gateway_langgraph_native.py` and a README.
The transport was adapted to the existing TypeScript app, not installed as a second Python stack.

The relevant protocol is **POST `/api/chat`**, `X-API-Key`, `LLM_MODEL`, and `stream: false`.
This is the organiser's Ollama-compatible dialect, not an OpenAI `/v1/chat/completions` client.
The native example targets a local gateway; it does not prove that the public gateway supports tools.
The README's body-size warning motivated a 7,500-byte request budget. Native support must be
measured against the same configured gateway as strict JSON.

No OpenClaw/Hermes installation, new dependency, scheduler rewrite or deployment change was made.

## Run the offline checks

From the repository root:

```sh
npm run typecheck
npm test
npm run test:a
npm run test:x
```

By default, the live test is skipped before loading any environment file or sending any request.
The gateway unit tests use HTTP doubles; A/X use a deterministic model double.
They test enforcement even when the model asks for an illegal tool. They do not claim a live
model's prompt-injection resistance or a real scheduler's eligibility correctness.

## Configure and run the live smoke locally

Create the local file without overwriting one that already exists:

```sh
cp -n .env.example .env.local
chmod 600 .env.local
```

In a local editor, fill `LLM_GATEWAY_API_KEY` with the supplied team key. Keep the URL and
`LLM_MODEL` from the organiser. Do not rename the model variable to `LLM_GATEWAY_MODEL`.
Do not put the key in source, shell arguments, screenshots of results, or evidence files.
`.env.local` is ignored by the existing `.gitignore` and is not part of this branch.

Then explicitly opt into external requests:

```sh
RUN_GATEWAY_SMOKE=1 npx vitest run src/agent/runtime/gateway.live.test.ts
```

This command may consume gateway quota. It makes up to four requests, with three-second spacing,
30-second request timeouts, no retries and a whole-test deadline. The smoke reads a synthetic board
only; it never executes scheduling or writes a real board.

Strict JSON and native tests each require two steps: request `retrieve_board`, then consume a unique
event ID disclosed only in that tool's result when calling `propose`. A plain-text imitation of a native
call is not accepted as native support.

The command writes a timestamped `gateway-smoke-*.json` beside this document. It records safe status
codes, successful step names, duration, model and origin only, not credentials or raw responses.
If strict JSON fails, the test fails. A native failure is recorded without enabling native tools.
Review the report before checking off G0. A passing synthetic smoke is not full-agent acceptance.

## Server-side integration boundary

Member 1 can consume the existing `IDatabase` instance through the exported factory:

```ts
import {
  createGatewayClient, readGatewayConfig, createUrgentTools, runUrgentJobAgent,
} from '@/agent';

// Inside a server-side handler that already has a validated eventId and IDatabase db:
const { model } = createGatewayClient(readGatewayConfig());
const result = await runUrgentJobAgent({
  eventId,
  model,
  tools: createUrgentTools(db),
});
```

This is an integration example, not an implemented API handler. The plan endpoint, desk UI,
proposal persistence, persisted audit trail, recommendation, risk classification, approval and commit
are unchanged. G1 returns candidate evidence only; it does not create proposal, approval, event-status,
assignment or snapshot rows. `comparisonReady` is true only when valid candidates cover both profiles.
Returned candidate IDs belong to the scheduler; platform persistence must establish durable IDs later.

Tools re-read and pin the current snapshot and event. Seed snapshots use their recorded assignment IDs;
committed snapshots use their full recorded slot set. A changed source snapshot ends the run as
`superseded`, with no returned plans. Unknown tools, unexpected arguments, foreign IDs and calls out of
order fail before execution. Solver validation and independent validation must both accept a candidate.

## Bounds and intentionally unfinished work

The graph allows at most 12 steps, four candidates per profile and 90 seconds for the whole run by
default. A scheduler call has a 10-second asynchronous budget. JavaScript cannot interrupt a synchronous
CPU-bound scheduler: an over-budget synchronous result is rejected on return, not preempted.
Gateway HTTP requests have abort signals, a response-size cap and at most two transient retries.
Authentication/forbidden failures are not retried and upstream error bodies are never exposed.

The prompt contains compact state and escaped, delimited notes; it never contains the entire board or
the gateway key. Raw notes remain unchanged in storage. Oversized requests fail closed.

Real Raffles-place legality/latency acceptance awaits member 2. The recommendation assertion is an
explicit G2 TODO. G3 gateway-down structured fallback, additional playbooks, interrupt/resume and durable
trace are not implemented by this G1 change. A gateway failure currently returns a safe failure with no
writes and no false claim that the model succeeded.
