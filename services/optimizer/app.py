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
  technician_unavailable  all day: their jobs that have not started are
                          reassigned. Part of the day (`until` / `from`, the
                          shift already cut by the caller): only the jobs
                          outside their new hours, and they stay a candidate
  job_overrun             the job's end moves; that technician's later jobs
                          may be retimed or reassigned if the overrun collides
  urgent_job              the unassigned job is inserted, and the day is
                          rebalanced around it: any booked job that has not
                          started, is not promised or locked, and starts beyond
                          the frozen horizon may change technician. It keeps
                          its customer's booked time; only who does it moves.
  place_waiting           every listed waiting job at once (ADR 014), around
                          booked work, which stays where it is. A job nobody
                          can legally take, or that does not fit, is left
                          waiting with a reason instead of failing the plan;
                          leaving one costs more than any arrangement, and
                          more for urgent jobs.

Balance
-------
Both profiles also minimise the workload gap: the busiest working technician's
share of their day minus the idlest one's. A new job goes where it evens the
day out, and an urgent job can pull a booked job off an overloaded technician
when that pays for the extra move.
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
# A booked job starting sooner than this after the board's "now" is frozen:
# its technician may already be driving to it.
FROZEN_HORIZON_MINUTES = 60

# Leaving a booked job without a technician (partial coverage) costs more than
# any legal arrangement could, so the solver only does it when nothing legal
# exists: the plan covers what it can and names the rest for a call.
UNASSIGN_COST = 1_000_000
# Cost of handing a booked job to someone else while rebalancing around an
# urgent job, in sla_first units (5 per drive minute). A move has to save about
# 12 minutes of driving, or even out the day, to be worth a customer's update.
REBALANCE_MOVE_COST = 60
# Per percentage point of workload gap, per profile. One point is about five
# minutes of a technician's day; sla_first trades it for 1.2 drive minutes.
BALANCE_WEIGHT = {"sla_first": 6, "minimal_disruption": 5}
# insertion's load pressure: a technician who cannot take overtime is 25%
# closer to the edge at the same load. Mirrors loadPressure() in propose.ts.
NO_OT_PRESSURE = 1.25
WORKING_SHIFT_STATUSES = ("clocked_in", "scheduled")


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
    # Booked jobs an urgent job may move to another technician, at their booked time.
    rebalance: set = set()
    unavailable: Optional[str] = None
    overrun_job: Optional[str] = None
    overrun_by = 0

    if event_type == "technician_unavailable":
        unavailable = payload.get("technicianId") or (affected[0] if affected else None)
        if unavailable not in techs:
            return _empty("unavailable_technician_unknown")
        # The caller has already cut the shift (src/matching/disruption.ts).
        # All day: every unstarted job moves and they take nothing new. Part of
        # the day: only the jobs outside their new hours are in play, and they
        # stay a candidate, so a job can wait for them if its window allows.
        whole_day = not (payload.get("from") or payload.get("until"))
        cut = shifts.get(unavailable) or {}
        cut_in, cut_out = _to_minutes(cut.get("clockInAt")), _to_minutes(cut.get("clockOutAt"))

        def outside_hours(s: Dict[str, Any]) -> bool:
            return (
                whole_day
                or (cut_in is not None and s["start"] < cut_in)
                or (cut_out is not None and s["end"] > cut_out)
            )

        in_scope = [
            j for j, s in live.items()
            if s["tech"] == unavailable and not in_progress(j) and outside_hours(s)
        ]
        if not whole_day:
            unavailable = None
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
    elif event_type in ("urgent_job", "place_waiting"):
        if event_type == "urgent_job":
            target = payload.get("jobId") or (affected[0] if affected else None)
            if target not in jobs or target in live:
                return _empty("urgent_job_not_unassigned")
            in_scope = [target]
        else:
            waiting = [j for j in (payload.get("jobIds") or affected) if j in jobs and j not in live]
            if not waiting:
                return _empty("no_waiting_jobs")
            in_scope = list(dict.fromkeys(waiting))
        # The board's "now" is the latest start of work already under way; with
        # nothing started, it is the earliest clock-in. The demo has no wall
        # clock on the board day, so this is read from the board, not the host.
        started = [s["start"] for j, s in live.items() if in_progress(j)]
        clock_ins = [m for m in (_to_minutes(sh.get("clockInAt")) for sh in shifts.values()) if m is not None]
        now = max(started) if started else (min(clock_ins) if clock_ins else 0)
        # Placing many waiting jobs keeps booked work where it is: opening the
        # whole day for each of them made the model too big to solve in time
        # (G-13, nine jobs), and a bulk placement should not reshuffle
        # customers who are already booked.
        for j, s in (live.items() if event_type == "urgent_job" else []):
            job = jobs[j]
            if (
                not in_progress(j)
                and job.get("lockState") in (None, "none")
                and job.get("status") in (None, "assigned")
                and s["start"] >= now + FROZEN_HORIZON_MINUTES
                # Only if its own technician is still legal for it; otherwise
                # opening it up would force a move the event did not cause.
                and s["tech"] in (body.eligibility.get(j) or [])
            ):
                rebalance.add(j)
        in_scope += sorted(rebalance)
    else:
        return _empty("unsupported_event_type")

    for job_id in in_scope:
        fixed.pop(job_id, None)

    # Booked jobs this event put in play may be left unassigned when nobody can
    # legally take them. The urgent job itself may not: a plan that does not
    # place it is no plan.
    droppable = {j for j in in_scope if j in live and j not in rebalance} if event_type not in ("urgent_job", "place_waiting") else set()
    unassigned: Dict[str, str] = {}
    # place_waiting: listed jobs that stay waiting, and why. Not "unassign":
    # they had no booking to lose.
    may_wait = {j for j in in_scope if j not in live} if event_type == "place_waiting" else set()
    left_waiting: Dict[str, str] = {}

    model = cp_model.CpModel()
    assign: Dict[Tuple[str, str], cp_model.IntVar] = {}
    start: Dict[str, cp_model.IntVar] = {}
    duration: Dict[str, int] = {}
    window_open: Dict[str, int] = {}
    candidates_by_job: Dict[str, List[str]] = {}
    unplaceable: List[str] = []
    drop: Dict[str, cp_model.IntVar] = {}

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
        if job_id in rebalance:
            lo = hi = booked["start"]
        if hi < lo:
            if job_id in may_wait:
                left_waiting[job_id] = "window_too_short"
                continue
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
        if not candidates and job_id in may_wait:
            left_waiting[job_id] = "no_legal_technician"
            continue
        if not candidates:
            if job_id in droppable:
                promised = job.get("lockState") == "promised"
                unassigned[job_id] = "promised" if promised else "no_legal_technician"
                continue
            unplaceable.append(job_id)
            continue
        for tech_id in candidates:
            chosen = model.NewBoolVar(f"assign_{tech_id}_{job_id}")
            assign[tech_id, job_id] = chosen
            shift = shifts.get(tech_id) or {}
            clock_in = _to_minutes(shift.get("clockInAt"))
            if clock_in is not None:
                model.Add(start[job_id] >= clock_in).OnlyEnforceIf(chosen)
            clock_out = _to_minutes(shift.get("clockOutAt"))
            if clock_out is not None:
                model.Add(start[job_id] + dur <= clock_out).OnlyEnforceIf(chosen)
        if job_id in droppable or job_id in may_wait:
            drop[job_id] = model.NewBoolVar(f"unassign_{job_id}")
            model.AddExactlyOne([assign[t, job_id] for t in candidates] + [drop[job_id]])
        else:
            model.AddExactlyOne(assign[t, job_id] for t in candidates)

    if unplaceable:
        return _empty("no_legal_technician:" + ",".join(sorted(unplaceable)))
    in_scope = [j for j in in_scope if j not in unassigned and j not in left_waiting]

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
    # Load as booked: what is fixed, plus rebalanceable jobs where they sit now.
    # Those are in play but mostly stay, and leaving them out would make a
    # technician whose afternoon happens to be movable look idle.
    booked_load = dict(committed)
    for j in rebalance:
        booked_load[live[j]["tech"]] += live[j]["end"] - live[j]["start"]

    # Workload gap: busiest minus idlest working technician, in whole percent
    # of each one's day ceiling. Linear because each ceiling is a constant.
    working = [
        t for t, tech in techs.items()
        if t != unavailable and tech.get("isActive", True)
        and (not shifts or (shifts.get(t) or {}).get("status") in WORKING_SHIFT_STATUSES)
    ]
    busiest = model.NewIntVar(0, 1000, "busiest_pct")
    idlest = model.NewIntVar(0, 1000, "idlest_pct")
    for t in working:
        ceiling = int(techs[t].get("maxMinutesDay") or 480)
        load = committed[t] + sum(duration[j] * assign[t, j] for j in in_scope if (t, j) in assign)
        model.Add(busiest * ceiling >= 100 * load)
        model.Add(idlest * ceiling <= 100 * load)
    gap = model.NewIntVar(-1000, 1000, "workload_gap_pct")
    model.Add(gap == busiest - idlest)

    def drop_cost(job_id: str) -> int:
        # An urgent job left waiting costs more than a routine one.
        weight = PRIORITY_WEIGHT.get(jobs[job_id].get("priority"), 2) if job_id in may_wait else 1
        return UNASSIGN_COST * weight

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
        # equal travel were chosen arbitrarily. Weight 1 against 5 per travel
        # minute, so a move still wins whenever it saves any driving. A move can
        # now also win on balance: after a 90-minute overrun this profile hands
        # Hafiz's 14:00 to Wei on purpose, closing a 44-point workload gap.
        for (tech_id, job_id), chosen in assign.items():
            if moves(tech_id, job_id):
                terms.append((REBALANCE_MOVE_COST if job_id in rebalance else 1) * chosen)
        if working:
            terms.append(BALANCE_WEIGHT[profile] * gap)
        terms.extend(drop_cost(j) * flag for j, flag in drop.items())
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
            # The receiving technician's load pressure, as insertion reads it,
            # so the two engines agree on who has room.
            tech = techs[tech_id]
            ceiling = int(tech.get("maxMinutesDay") or 480)
            own = duration[job_id] if job_id in rebalance and live[job_id]["tech"] == tech_id else 0
            pressure = (booked_load[tech_id] - own + duration[job_id]) * 100 / ceiling
            if not tech.get("acceptsOt"):
                pressure *= NO_OT_PRESSURE
            terms.append(round(pressure) * chosen)
        for travel_terms in route_travel.values():
            terms.extend(travel_terms)
        terms.extend(300 * flag for flag in receives_new_work.values())
        terms.extend(10 * shift for shift in drift.values())
        # A job nobody was booked for has no drift to measure, so without this
        # an urgent job could be parked at the end of its window for free.
        for job_id in in_scope:
            if job_id not in live:
                weight = PRIORITY_WEIGHT.get(jobs[job_id].get("priority"), 2)
                terms.append(weight * (start[job_id] - window_open[job_id]))
        if working:
            terms.append(BALANCE_WEIGHT[profile] * gap)
        terms.extend(drop_cost(j) * flag for j, flag in drop.items())
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

    for job_id, flag in drop.items():
        if solver.BooleanValue(flag):
            if job_id in may_wait:
                left_waiting[job_id] = "no_time"
            else:
                unassigned[job_id] = "promised" if jobs[job_id].get("lockState") == "promised" else "no_time"

    final: Dict[str, Tuple[str, int, int]] = {j: (s["tech"], s["start"], s["end"]) for j, s in fixed.items()}
    for job_id in in_scope:
        if job_id in unassigned or job_id in left_waiting:
            continue
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
    touched = set(changed) | set(unassigned)
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
    # Partial coverage: what nobody can take, and why, for the coordinator to call.
    for j in sorted(unassigned):
        change_set.append({
            "action": "unassign",
            "jobId": j,
            "fromTechnicianId": live[j]["tech"],
            "reason": unassigned[j],
        })

    # place_waiting: what stays waiting, and why, for the coordinator.
    for j in sorted(left_waiting):
        change_set.append({"action": "leave_waiting", "jobId": j, "reason": left_waiting[j]})

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
            "unassignedCount": len(unassigned) + len(left_waiting),
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
            "rebalanceable": sorted(rebalance),
            "workloadGapPct": solver.Value(gap) if working else 0,
            "candidates": candidates_by_job,
        },
        "timedOut": False,
        "durationMs": int(solver.WallTime() * 1000),
        "status": "VALIDATED",
        "createdAt": f"{date}T08:00:00+08:00",
    }

    return {"plans": [plan], "engine": "ortools", "timedOut": False}
