"""Greedy real-sensor placement for the Digital Twin site, with the app's own
coverage grid (backend/app/engine.py: the 20x20 cell-centre grid behind
"next measurement point"). Used by audit_sensor_count.mjs.

The twin site is a 4 x 3 grid of sections; each section is one grid unit and a
sensor sits at its centre. Coverage = share of the 20x20 cell centres within
RADIUS grid units of the nearest real sensor (the app's rule). Each step adds
the section that raises coverage most; ties go to the section nearest the app's
suggested next point (farthest cell from the current sensors), then the lower
index. The order is printed as JSON; its first N ids are the placement for N.

Usage (from the repository root):
    PYTHONPATH=backend .venv/bin/python research/simulation/sensor_placement.py '{"ids": [...], "cols": 4, "rows": 3}'
"""

import json
import sys
from math import hypot
from types import SimpleNamespace

from app.engine import _grid

# Assumption: one real sensor informs its own section and the sections next to it.
RADIUS = 1.0


def greedy_order(ids, cols, rows, radius=RADIUS):
    site = SimpleNamespace(x=0, y=0, width=cols, height=rows, coverage_radius_m=radius)
    centres = [((i % cols) + 0.5, (i // cols) + 0.5) for i in range(len(ids))]
    chosen, steps = [], []

    def fraction(points):
        cells, distances = _grid(site, points)
        return sum(d <= radius for d in distances) / len(cells)

    while len(chosen) < len(ids):
        current = [centres[i] for i in chosen]
        cells, distances = _grid(site, current)
        far = cells[max(range(len(cells)), key=lambda k: distances[k])]
        best = max(
            (i for i in range(len(ids)) if i not in chosen),
            key=lambda i: (round(fraction(current + [centres[i]]), 9), -hypot(centres[i][0] - far[0], centres[i][1] - far[1]), -i),
        )
        chosen.append(best)
        steps.append({"id": ids[best], "coverage": fraction([centres[i] for i in chosen])})
    return {"radius": radius, "order": [ids[i] for i in chosen], "steps": steps}


if __name__ == "__main__":
    spec = json.loads(sys.argv[1])
    print(json.dumps(greedy_order(spec["ids"], spec["cols"], spec["rows"])))
