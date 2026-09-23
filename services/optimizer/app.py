"""OR-Tools CP-SAT sidecar for replanning after technician_unavailable and job_overrun.

What the solver decides, and what it does not
---------------------------------------------
Eligibility is not decided here. Certificates, tier, parts, tools and shift
status are Stage A's job in `src/matching/gates/stage-a.ts`, and the caller
sends its verdict as `eligibility: {jobId: [technicianId, ...]}`. Keeping one
implementation of the legal rules is deliberate: a second copy in Python would
drift from the TypeScript one, and the validator would then reject plans the
solver believed were legal. That is the failure this file used to have.

The solver decides who does each job that the event puts in play, and when,
subject to the rules `validatePlan` enforces on time:

  * a job starts inside its customer window and finishes by its end
  * no technician is in two places at once, and consecutive jobs leave enough
    time to drive between clusters (off-peak matrix minutes, as the validator)
  * nobody starts before they clock in
  * a technician's day stays within maxMinutesDay, plus 120 if they accept OT
  * promised jobs keep their technician; in-progress jobs are never moved

Everything the event does not touch stays exactly where it is. The TypeScript
validator re-checks every plan independently and remains the final gate.

Scope per event
---------------
  technician_unavailable  their jobs that have not started are reassigned
  job_overrun             the job's end moves; that technician's later jobs
                          may be retimed or reassigned if the overrun collides
  urgent_job              the unassigned job is inserted (insertion normally
                          handles this; supported so the sidecar is complete)
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import ortools
from fastapi import FastAPI
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

app = FastAPI(title="Dispatch Coordinator optimizer", version="2.0.0")

SGT = timezone(timedelta(hours=8))
DAY_MINUTES = 24 * 60
# Pessimistic, so a pair missing from the matrix can only make a plan harder to
# accept, never let an infeasible drive through. The validator uses 20.
UNKNOWN_TRAVEL_MINUTES = 45
# Mirrors validate.ts: maxMinutesDay + 120 when the technician accepts overtime.
OT_ALLOWANCE_MINUTES = 120
SOLVER_SECONDS = 5.0
LIVE_STATUSES = ("accepted", "offered")
PRIORITY_WEIGHT = {"urgent": 5, "on_demand": 2, "callback": 2, "when_available": 1, "quote": 1}


class ProposeRequest(BaseModel):
    event: Dict[str, Any]
    schedule: Dict[str, Any]
    profile: str = Field(pattern="^(sla_first|minimal_disruption)$")
    # Stage A's verdict per job. Absent means the caller did not check
    # legality, so the solver refuses rather than guessing.
    eligibility: Optional[Dict[str, List[str]]] = None


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "engine": "ortools",
        "ortools": getattr(ortools, "__version__", "unknown"),
    }


def _empty(message: str, timed_out: bool = False) -> Dict[str, Any]:
    return {"plans": [], "engine": "ortools", "timedOut": timed_out, "message": message}


def _to_minutes(iso: Optional[str]) -> Optional[int]:
    """Minutes after local midnight in Singapore, whatever offset the string carries."""
    if not iso:
        return None
    try:
        moment = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=SGT)
    local = moment.astimezone(SGT)
    return local.hour * 60 + local.minute


def _to_iso(date: str, minutes: int) -> str:
    midnight = datetime.fromisoformat(f"{date}T00:00:00+08:00")
    return (midnight + timedelta(minutes=minutes)).isoformat()


@app.post("/propose")
def propose(body: ProposeRequest) -> Dict[str, Any]:
    event = body.event
    schedule = body.schedule
    profile = body.profile

    date = schedule.get("date") or "2026-09-15"
    techs: Dict[str, Dict[str, Any]] = {
        t["id"]: t for t in schedule.get("technicians") or [] if t.get("id")
    }
    jobs: Dict[str, Dict[str, Any]] = {j["id"]: j for j in schedule.get("jobs") or [] if j.get("id")}
    if not techs or not jobs:
        return _empty("empty_schedule_input")
    if body.eligibility is None:
        return _empty("eligibility_missing")

    sites = {s["id"]: s for s in schedule.get("sites") or [] if s.get("id")}
    travel = {
        (str(r["fromCluster"]).strip().lower(), str(r["toCluster"]).strip().lower()): int(r["minutes"])
        for r in schedule.get("travel") or []
        if r.get("fromCluster") and r.get("toCluster") and r.get("minutes") is not None
    }
    shifts = {
        s["technicianId"]: s
        for s in schedule.get("shifts") or []
        if s.get("technicianId") and s.get("shiftDate") == date
    }

    def cluster_of(job_id: str) -> str:
        site = sites.get(jobs[job_id].get("siteId"))
        return str((site or {}).get("estateCluster") or "cbd")

    def drive(from_cluster: str, to_cluster: str) -> int:
        return travel.get((from_cluster.strip().lower(), to_cluster.strip().lower()), UNKNOWN_TRAVEL_MINUTES)

    def origin_of(tech_id: str) -> str:
        tech = techs[tech_id]
        return str(tech.get("currentCluster") or tech.get("homeRegion") or "cbd")

    def in_progress(job_id: str) -> bool:
        job = jobs[job_id]
        return job.get("lockState") == "in_progress" or job.get("status") == "on_site"

    # The live board: what is actually booked right now.
    live: Dict[str, Dict[str, Any]] = {}
    for a in schedule.get("assignments") or []:
        if a.get("status") not in LIVE_STATUSES or a.get("jobId") not in jobs:
            continue
        start, end = _to_minutes(a.get("windowStart")), _to_minutes(a.get("windowEnd"))
        if start is None or end is None or a.get("technicianId") not in techs:
            continue
        live[a["jobId"]] = {
            "tech": a["technicianId"],
            "start": start,
            "end": end,
            "travel": a.get("travelBeforeMinutes"),
        }

    payload = event.get("normalizedPayload") or {}
    affected = event.get("affectedIds") or []
    event_type = event.get("type")

    fixed: Dict[str, Dict[str, Any]] = {job_id: dict(slot) for job_id, slot in live.items()}
    in_scope: List[str] = []
    unavailable: Optional[str] = None
    overrun_job: Optional[str] = None
    overrun_by = 0

    if event_type == "technician_unavailable":
        unavailable = payload.get("technicianId") or (affected[0] if affected else None)
        if unavailable not in techs:
            return _empty("unavailable_technician_unknown")
        in_scope = [j for j, s in live.items() if s["tech"] == unavailable and not in_progress(j)]
    elif event_type == "job_overrun":
        overrun_job = payload.get("jobId") or (affected[0] if affected else None)
        overrun_by = int(payload.get("overrunMinutes") or 0)
        if overrun_job not in live or overrun_by <= 0:
            return _empty("overrun_job_not_on_board")
        owner = live[overrun_job]["tech"]
        fixed[overrun_job]["end"] += overrun_by
        in_scope = [
            j for j, s in live.items()
            if s["tech"] == owner and j != overrun_job
            and s["start"] >= live[overrun_job]["start"] and not in_progress(j)
        ]
    elif event_type == "urgent_job":
        target = payload.get("jobId") or (affected[0] if affected else None)
        if target not in jobs or target in live:
            return _empty("urgent_job_not_unassigned")
        in_scope = [target]
    else:
        return _empty("unsupported_event_type")

    for job_id in in_scope:
        fixed.pop(job_id, None)

    model = cp_model.CpModel()
    assign: Dict[Tuple[str, str], cp_model.IntVar] = {}
    start: Dict[str, cp_model.IntVar] = {}
    duration: Dict[str, int] = {}
    window_open: Dict[str, int] = {}
    candidates_by_job: Dict[str, List[str]] = {}
    unplaceable: List[str] = []

    for job_id in in_scope:
        job = jobs[job_id]
        booked = live.get(job_id)
        # A job keeps the length it is booked for. Shortening it on a move would
        # show up as a change the coordinator did not ask for.
        dur = (booked["end"] - booked["start"]) if booked else int(job.get("durationMinutes") or 90)
        duration[job_id] = dur
        opens, closes = _to_minutes(job.get("windowStart")), _to_minutes(job.get("windowEnd"))
        lo = opens if opens is not None else 0
        hi = (closes - dur) if closes is not None else DAY_MINUTES - dur
        if hi < lo:
            if not booked:
                unplaceable.append(job_id)
                continue
            lo = hi = booked["start"]
        window_open[job_id] = lo
        start[job_id] = model.NewIntVar(lo, hi, f"start_{job_id}")

        candidates = [t for t in body.eligibility.get(job_id, []) if t in techs and t != unavailable]
        if job.get("lockState") == "promised" and booked:
            candidates = [t for t in candidates if t == booked["tech"]]
        candidates_by_job[job_id] = candidates
        if not candidates:
            unplaceable.append(job_id)
            continue
        for tech_id in candidates:
            chosen = model.NewBoolVar(f"assign_{tech_id}_{job_id}")
            assign[tech_id, job_id] = chosen
            clock_in = _to_minutes((shifts.get(tech_id) or {}).get("clockInAt"))
            if clock_in is not None:
                model.Add(start[job_id] >= clock_in).OnlyEnforceIf(chosen)
        model.AddExactlyOne(assign[t, job_id] for t in candidates)

    if unplaceable:
        return _empty("no_legal_technician:" + ",".join(sorted(unplaceable)))

    # Each technician's day is a route: a circuit from their starting point
    # through every job they hold and back. An arc between two jobs is a real
    # drive, and choosing it forces the second job to start after the first ends
    # plus that drive. This is exactly the rule validatePlan applies between
    # consecutive jobs, and it makes travel exact: a technician who picks up two
    # jobs in Bedok pays one drive to Bedok, not two. An earlier version scored
    # travel from where the technician began the day, could not see chaining,
    # and so split jobs across technicians for more driving and no benefit.
    route_travel: Dict[str, List[Any]] = {}
    for tech_id, tech in techs.items():
        mine_fixed = [(j, s) for j, s in fixed.items() if s["tech"] == tech_id]
        mine_open = [j for j in in_scope if (tech_id, j) in assign]
        if not mine_open:
            continue  # nothing to decide on this day; it is legal as booked

        ceiling = int(tech.get("maxMinutesDay") or 480) + (OT_ALLOWANCE_MINUTES if tech.get("acceptsOt") else 0)
        booked_work = sum(s["end"] - s["start"] for _, s in mine_fixed)
        if booked_work > ceiling:
            # Already over before we add anything (an overrun can do this). The
            # overrun is a fact; we must not pile more onto that day.
            for j in mine_open:
                model.Add(assign[tech_id, j] == 0)
            continue
        model.Add(booked_work + sum(duration[j] * assign[tech_id, j] for j in mine_open) <= ceiling)

        # Node 0 is where the technician starts; then fixed jobs, then choices.
        nodes: List[Tuple[str, Optional[str]]] = [("depot", None)]
        nodes += [("fixed", j) for j, _ in mine_fixed]
        nodes += [("open", j) for j in mine_open]

        def begins(node: Tuple[str, Optional[str]]) -> Any:
            kind, j = node
            return fixed[j]["start"] if kind == "fixed" else start[j]

        def finishes(node: Tuple[str, Optional[str]]) -> Any:
            kind, j = node
            return fixed[j]["end"] if kind == "fixed" else start[j] + duration[j]

        def place(node: Tuple[str, Optional[str]]) -> str:
            kind, j = node
            return origin_of(tech_id) if kind == "depot" else cluster_of(j)

        arcs: List[Tuple[int, int, Any]] = []
        travel_terms: List[Any] = []
        for a, node_a in enumerate(nodes):
            for b, node_b in enumerate(nodes):
                if a == b:
                    continue
                if node_b[0] == "depot":
                    arcs.append((a, b, model.NewBoolVar(f"home_{tech_id}_{a}")))
                    continue
                minutes = drive(place(node_a), place(node_b))
                if node_a[0] == "depot":
                    lit = model.NewBoolVar(f"first_{tech_id}_{b}")
                elif node_a[0] == "fixed" and node_b[0] == "fixed":
                    # Both times are facts; the arc exists only if the drive fits.
                    if finishes(node_a) + minutes > begins(node_b):
                        continue
                    lit = model.NewBoolVar(f"arc_{tech_id}_{a}_{b}")
                else:
                    lit = model.NewBoolVar(f"arc_{tech_id}_{a}_{b}")
                    model.Add(finishes(node_a) + minutes <= begins(node_b)).OnlyEnforceIf(lit)
                arcs.append((a, b, lit))
                travel_terms.append(minutes * lit)

        # A job this technician does not take is skipped. With no fixed jobs,
        # the whole day may be empty.
        for n, (kind, j) in enumerate(nodes):
            if kind == "open":
                arcs.append((n, n, assign[tech_id, j].Not()))
        if not mine_fixed:
            arcs.append((0, 0, model.NewBoolVar(f"idle_{tech_id}")))

        model.AddCircuit(arcs)
        route_travel[tech_id] = travel_terms

    # How far each job starts from where it was booked, for the disruption term.
    drift: Dict[str, cp_model.IntVar] = {}
    for job_id in in_scope:
        booked = live.get(job_id)
        if booked:
            gap = model.NewIntVar(0, DAY_MINUTES, f"drift_{job_id}")
            model.Add(gap >= start[job_id] - booked["start"])
            model.Add(gap >= booked["start"] - start[job_id])
            drift[job_id] = gap

    committed = {t: sum(s["end"] - s["start"] for s in fixed.values() if s["tech"] == t) for t in techs}

    def moves(tech_id: str, job_id: str) -> bool:
        booked = live.get(job_id)
        return not booked or booked["tech"] != tech_id

    # The two profiles optimise different things, not the same thing scaled.
    # Multiplying one objective by 10 and the other by 100, as this file used
    # to, leaves the optimum unchanged: the two plans were always identical.
    if profile == "sla_first":
        objective_name = "soonest_service"
        terms = []
        for job_id in in_scope:
            weight = PRIORITY_WEIGHT.get(jobs[job_id].get("priority"), 2)
            terms.append(10 * weight * (start[job_id] - window_open[job_id]))
            if job_id in drift:
                terms.append(drift[job_id])
        for travel_terms in route_travel.values():
            terms.extend(5 * term for term in travel_terms)
        # Break ties by leaving work where it is. Without this, two routes of
        # equal travel were chosen arbitrarily, and a 90-minute overrun moved a
        # job that could have stayed put. Weight 1 against 5 per travel minute,
        # so a move still wins whenever it saves any driving.
        for (tech_id, job_id), chosen in assign.items():
            if moves(tech_id, job_id):
                terms.append(chosen)
        model.Minimize(sum(terms))
    else:
        objective_name = "least_knock_on"
        terms = []
        receives_new_work: Dict[str, cp_model.IntVar] = {}
        for (tech_id, job_id), chosen in assign.items():
            if moves(tech_id, job_id):
                terms.append(1000 * chosen)
                if tech_id not in receives_new_work:
                    receives_new_work[tech_id] = model.NewBoolVar(f"disturbed_{tech_id}")
                model.Add(receives_new_work[tech_id] >= chosen)
            terms.append((committed[tech_id] // 10) * chosen)
        for travel_terms in route_travel.values():
            terms.extend(travel_terms)
        terms.extend(300 * flag for flag in receives_new_work.values())
        terms.extend(10 * gap for gap in drift.values())
        model.Minimize(sum(terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVER_SECONDS
    # One worker and a fixed seed, so the same board gives the same plan twice.
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = 0
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if status == cp_model.UNKNOWN:
            return _empty("cp_sat_no_solution_in_time", timed_out=True)
        return _empty("cp_sat_infeasible")

    final: Dict[str, Tuple[str, int, int]] = {j: (s["tech"], s["start"], s["end"]) for j, s in fixed.items()}
    for job_id in in_scope:
        chosen_tech = next(t for (t, j), var in assign.items() if j == job_id and solver.BooleanValue(var))
        begins = solver.Value(start[job_id])
        final[job_id] = (chosen_tech, begins, begins + duration[job_id])

    changed = {
        j for j, (t, b, e) in final.items()
        if j not in live or (live[j]["tech"], live[j]["start"], live[j]["end"]) != (t, b, e)
    }

    # Drive time before each slot, from whatever the technician did last.
    travel_before: Dict[str, int] = {}
    by_tech: Dict[str, List[Tuple[int, str]]] = {}
    for j, (t, b, _e) in final.items():
        by_tech.setdefault(t, []).append((b, j))
    for t, rows in by_tech.items():
        rows.sort()
        previous = origin_of(t)
        for _b, j in rows:
            if j in live and j not in changed and live[j].get("travel") is not None:
                travel_before[j] = int(live[j]["travel"])
            else:
                travel_before[j] = drive(previous, cluster_of(j))
            previous = cluster_of(j)

    slots = [
        {
            "jobId": j,
            "technicianId": t,
            "windowStart": _to_iso(date, b),
            "windowEnd": _to_iso(date, e),
            "travelBeforeMinutes": travel_before[j],
        }
        for j, (t, b, e) in sorted(final.items(), key=lambda kv: (kv[1][1], kv[0]))
    ]

    lateness = 0
    for j, (_t, _b, e) in final.items():
        closes = _to_minutes(jobs[j].get("windowEnd"))
        if closes is not None and e > closes:
            lateness += e - closes

    work: Dict[str, int] = {}
    for _j, (t, b, e) in final.items():
        work[t] = work.get(t, 0) + (e - b)
    overtime = sum(max(0, minutes - int(techs[t].get("maxMinutesDay") or 480)) for t, minutes in work.items())

    moved_jobs = sorted(j for j in changed if j in in_scope)
    touched = set(changed)
    if overrun_job:
        touched.add(overrun_job)
    customers = {jobs[j].get("customerId") for j in touched if jobs[j].get("customerId")}

    change_set: List[Dict[str, Any]] = []
    if overrun_job:
        change_set.append({"action": "extend_duration", "jobId": overrun_job, "overrunMinutes": overrun_by})
    for j in moved_jobs:
        t, b, e = final[j]
        before = live.get(j)
        action = "assign" if not before else ("reassign" if before["tech"] != t else "retime")
        change_set.append({
            "action": action,
            "jobId": j,
            "fromTechnicianId": before["tech"] if before else None,
            "technicianId": t,
            "windowStart": _to_iso(date, b),
            "windowEnd": _to_iso(date, e),
        })

    plan = {
        "id": f"plan_{profile}_ortools_{event.get('id', 'evt')}",
        "proposalId": event.get("id", "evt"),
        "sourceSnapshotId": schedule.get("snapshotId", "snap_v1"),
        "profile": profile,
        "assignments": slots,
        "changeSet": change_set,
        "metrics": {
            "slaLatenessMinutes": lateness,
            "travelMinutes": sum(travel_before[j] for j in changed),
            "overtimeMinutes": overtime,
            "jobsMoved": len(moved_jobs),
            "customersAffected": len(customers),
            "unassignedCount": 0,
        },
        # Fail closed. The TypeScript validator is the authority and overwrites
        # this; if anything ever skipped it, an unchecked plan must not pass.
        "validations": {"ok": False, "violations": []},
        "solverTrace": {
            "engine": "ortools_cp_sat",
            "status": solver.StatusName(status),
            "objective": objective_name,
            "objectiveValue": solver.ObjectiveValue(),
            "solveTimeMs": int(solver.WallTime() * 1000),
            "inScope": in_scope,
            "candidates": candidates_by_job,
        },
        "timedOut": False,
        "durationMs": int(solver.WallTime() * 1000),
        "status": "VALIDATED",
        "createdAt": f"{date}T08:00:00+08:00",
    }

    return {"plans": [plan], "engine": "ortools", "timedOut": False}
