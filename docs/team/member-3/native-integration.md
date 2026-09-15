# Native gateway integration follow-up

Owner: Deen. Prepared on 15 September 2026 for `member-3/gateway-urgent-agent`.
The authoritative checklist remains `docs/tasks.md`.

## Evidence and status

The owner's `gateway-smoke-1789419656751.json` recorded strict JSON failing with
`MALFORMED_TOOL_JSON` and a successful two-step native call/result round trip.
That supports adding the native adapter; it does not prove the entire agent works.

This follow-up was prepared as a local apply package after the remote code-write
request was blocked. Applying the package changes source only. No fresh live-gateway
success, full-repository test success, deployment, or completed gate is claimed by
applying it. G0 remains open until the new native client/graph evidence is reviewed.

## Implementation

`createGatewayClient(config)` now selects `native`; the client exposes `protocol`
and the model exposes the same protocol so prompts match transport. The graph
passes its legal frontier into the client. Only currently legal tool names are
advertised. Native responses must contain exactly one call, with arguments accepted
by the same strict Zod schema. The graph then rechecks the normalized call's size,
exact arguments, execution order, event and snapshot. Extra keys, parallel calls,
text imitations, foreign IDs and forbidden writes remain errors.

Native prompts retain escaped, delimited notes. They feed back only the previous
validated/executed tool call and result, plus compact current state. Assistant prose
is discarded. There is no global client transcript or conversation sharing between
runs. Request/response limits, aborts, retries and no-write boundaries are unchanged.

`{ protocol: 'strict_json' }` remains an explicit diagnostic option. Native errors
never automatically downgrade to the known-failing text protocol. Rerun both live
checks when changing gateway/model. This patch does not deploy or modify `.env*`.

Protocol reference: Ollama's official tool-calling and `/api/chat` documentation:
https://docs.ollama.com/capabilities/tool-calling
https://docs.ollama.com/api/chat
The organiser dialect is tested rather than assumed to implement every Ollama option.

## Verification after applying

```sh
npm run typecheck
npm test
npm run build
RUN_GATEWAY_SMOKE=1 npx vitest run src/agent/runtime/gateway.live.test.ts
RUN_AGENT_GATEWAY_SMOKE=1 npx vitest run evals/a-suite/native-agent.live.test.ts
```

Default tests load no environment files and make no external calls. The existing
strict-mode HTTP tests stay explicit; new tests exercise the default native adapter,
strict argument rejection and native client -> real graph dispatch with doubles.

The first live command compares both protocols and requires the selected production
protocol to pass. Strict failure is still recorded, not hidden or converted into
success. This is necessary but not sufficient: the second command exercises the
actual default client and graph, for both a normal and injected-note scenario.
Each scenario should perform retrieve, two proposes and two validations. It also
asserts that memory assignments, snapshots, events, proposals and approvals remain
unchanged, and that metrics come from the scheduler fixture rather than the model.

Live tests may use gateway quota: up to four comparison requests and up to ten
successful-path agent requests, no transport retries, with 3-second spacing. A graph
that misbehaves fails closed; its limits still cap the run. No raw model responses or
credentials are written to evidence. Reports are unique files next to this document:
`gateway-smoke-*.json` and `native-agent-smoke-*.json`.

Both agent live scenarios use a **real gateway and LangGraph**, a **memory database**,
and **contract-double scheduler/validator**. They do not establish real Raffles Place
legality, latency, recommendation, persisted proposal/trace, desk UI, approval/commit,
or deployment acceptance. Member 2's real scheduler and validator remain a blocker.

Review new evidence before updating G0. Do not advance G1 or mark actual scheduling
complete because the synthetic agent checks pass.
