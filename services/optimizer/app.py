"""OR-Tools sidecar. G1 may ignore this beyond /health."""

import ortools
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Dispatch Coordinator optimizer", version="0.1.0")


class ProposeRequest(BaseModel):
    event: dict
    schedule: dict
    profile: str = Field(pattern="^(sla_first|minimal_disruption)$")


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "engine": "stub", "ortools": getattr(ortools, "__version__", True)}


@app.post("/propose")
def propose(body: ProposeRequest) -> dict[str, object]:
    # G3 replaces this with CP-SAT. G1 uses TypeScript insertion in the app.
    return {
        "plans": [],
        "engine": "stub",
        "profile": body.profile,
        "timed_out": False,
        "message": "Sidecar skeleton. App-side insertion is the G1 engine.",
    }
