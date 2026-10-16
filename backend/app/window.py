"""Allowed irrigation window, the same rules as frontend/lib/twin/window.ts.

Hours are local (Asia/Riyadh); the window may cross midnight (e.g. 18 -> 8).
Both implementations are checked against frontend/tests/fixtures/irrigation-windows.json.
"""


def in_window(hour: float, start: int, end: int) -> bool:
    return start <= hour < end if start < end else (hour >= start or hour < end)


def hours_to_window_end(hour: float, start: int, end: int) -> float:
    """Hours from `hour` until the current allowed window closes (0 outside it)."""
    if not in_window(hour, start, end):
        return 0
    return (end - hour + 24) % 24 or 24


def window_length(start: int, end: int) -> int:
    return (end - start + 24) % 24 or 24
