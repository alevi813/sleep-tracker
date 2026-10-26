#!/usr/bin/env python3
"""
Overnight Sleep Schedule Tracker Web Application
Locally hosted server for managing 'up' and 'down' sleep timing events,
persisting CSV data, and generating the downstream sleep schedule visualization.
"""

import csv
import io
import json
import os
import shutil
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = os.path.join(BASE_DIR, "static")
ACTIVE_CSV_PATH = os.path.join(DATA_DIR, "schedule.csv")


def generate_time_labels():
    """Generate 5-minute interval time strings from 9:00 PM (0m) to 7:00 AM (600m)."""
    labels = []
    # 9:00 PM is 21:00 (21 * 60 = 1260 minutes from midnight)
    start_minutes = 21 * 60
    for offset in range(0, 601, 5):
        total_mins = (start_minutes + offset) % (24 * 60)
        hour24 = total_mins // 60
        minute = total_mins % 60
        period = "AM" if hour24 < 12 else "PM"
        hour12 = hour24 % 12
        if hour12 == 0:
            hour12 = 12
        labels.append(f"{hour12}:{minute:02d} {period}")
    return labels


TIME_LABELS = generate_time_labels()
TIME_TO_MIN = {label: i * 5 for i, label in enumerate(TIME_LABELS)}
MIN_TO_TIME = {i * 5: label for i, label in enumerate(TIME_LABELS)}


def normalize_time_str(t_str):
    """Normalize a time string like '09:05 pm' or '9:05 PM' to match TIME_LABELS."""
    if not t_str:
        return None
    s = str(t_str).strip().upper()
    if s in TIME_TO_MIN:
        return s
    # Handle leading zero on hour, e.g. '09:05 PM' -> '9:05 PM'
    if s.startswith("0") and len(s) > 1 and s[1].isdigit():
        s_no_zero = s[1:]
        if s_no_zero in TIME_TO_MIN:
            return s_no_zero
    return None


def compute_blocks(events):
    """
    Replicate the exact block-parsing logic from sleep tracking.ipynb:
    - Default starting state at 0 min (9:00 PM) is 'up' unless an event occurs at 0 min.
    - Each event transitions state at ev_time.
    - Final state extends to 7:00 AM (600 minutes).
    """
    sorted_events = sorted(events, key=lambda x: x["minute"])
    blocks = []
    current_time = 0
    current_state = "up"

    for ev in sorted_events:
        ev_time = int(ev["minute"])
        ev_state = str(ev["state"]).strip().lower()
        if ev_state not in ("up", "down"):
            continue
        if ev_time == 0:
            current_state = ev_state
        elif ev_time > current_time:
            dur = ev_time - current_time
            blocks.append(
                {
                    "state": current_state,
                    "start_min": current_time,
                    "end_min": ev_time,
                    "start_time": MIN_TO_TIME.get(current_time, ""),
                    "end_time": MIN_TO_TIME.get(ev_time, ""),
                    "duration": dur,
                    "label": format_duration(dur),
                }
            )
            current_time = ev_time
            current_state = ev_state
        elif ev_time == current_time:
            current_state = ev_state

    if current_time < 600:
        dur = 600 - current_time
        blocks.append(
            {
                "state": current_state,
                "start_min": current_time,
                "end_min": 600,
                "start_time": MIN_TO_TIME.get(current_time, ""),
                "end_time": MIN_TO_TIME.get(600, "7:00 AM"),
                "duration": dur,
                "label": format_duration(dur),
            }
        )

    return blocks


def format_duration(dur):
    """Format duration in minutes to '2h 25m', '45m', '1h' (exact notebook logic)."""
    h, m = divmod(int(dur), 60)
    if h > 0 and m > 0:
        return f"{h}h {m}m"
    elif h > 0:
        return f"{h}h"
    else:
        return f"{m}m"


def parse_csv_content(csv_text):
    """Parse CSV string in the format of time_schedule_10-19_to_10-25.csv."""
    reader = csv.reader(io.StringIO(csv_text.strip()))
    rows = list(reader)
    if not rows:
        return {"columns": [], "events_by_col": {}}

    header = rows[0]
    columns = [col.strip() for col in header[1:] if col.strip()]
    events_by_col = {col: [] for col in columns}

    for row_idx, row in enumerate(rows[1:]):
        if not row:
            continue
        raw_time = row[0].strip()
        norm_time = normalize_time_str(raw_time)
        if norm_time is not None:
            minute = TIME_TO_MIN[norm_time]
        else:
            # Fallback to row index * 5 if within range
            minute = row_idx * 5
            if minute > 600:
                continue
            norm_time = MIN_TO_TIME[minute]

        for col_idx, col in enumerate(columns):
            cell_idx = col_idx + 1
            if cell_idx < len(row):
                val = str(row[cell_idx]).strip().lower()
                if val in ("up", "down"):
                    events_by_col[col].append(
                        {"minute": minute, "time": norm_time, "state": val}
                    )

    # Sort and deduplicate events by minute for each column
    for col in columns:
        dedup = {}
        for ev in events_by_col[col]:
            dedup[ev["minute"]] = ev
        events_by_col[col] = [dedup[m] for m in sorted(dedup.keys())]

    return {"columns": columns, "events_by_col": events_by_col}


def serialize_to_csv(columns, events_by_col):
    """Serialize columns and events_by_col back to the exact CSV format."""
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["Time"] + list(columns))

    # Build lookup (col, minute) -> state
    lookup = {}
    for col in columns:
        for ev in events_by_col.get(col, []):
            m = int(ev["minute"])
            state = str(ev["state"]).strip().lower()
            if state in ("up", "down"):
                lookup[(col, m)] = state

    for label in TIME_LABELS:
        m = TIME_TO_MIN[label]
        row = [label]
        for col in columns:
            row.append(lookup.get((col, m), ""))
        writer.writerow(row)

    return output.getvalue()


def ensure_data_initialized():
    """Ensure data/schedule.csv exists."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(ACTIVE_CSV_PATH):
        default_csv = serialize_to_csv(["20-Oct"], {"20-Oct": []})
        with open(ACTIVE_CSV_PATH, "w", encoding="utf-8") as f:
            f.write(default_csv)


def load_schedule():
    """Load current schedule from disk and compute blocks + summary stats."""
    ensure_data_initialized()
    with open(ACTIVE_CSV_PATH, "r", encoding="utf-8") as f:
        csv_text = f.read()
    parsed = parse_csv_content(csv_text)
    return build_response_payload(parsed["columns"], parsed["events_by_col"])


def save_schedule(columns, events_by_col):
    """Normalize, save to disk, and return updated schedule payload."""
    ensure_data_initialized()
    clean_cols = []
    seen = set()
    for c in columns:
        c_str = str(c).strip()
        if c_str and c_str not in seen:
            clean_cols.append(c_str)
            seen.add(c_str)

    clean_events = {}
    for col in clean_cols:
        raw_list = events_by_col.get(col, [])
        dedup = {}
        for ev in raw_list:
            m = ev.get("minute")
            t = ev.get("time")
            state = str(ev.get("state", "")).strip().lower()
            if state not in ("up", "down"):
                continue
            if m is not None and int(m) in MIN_TO_TIME:
                m_int = int(m)
            else:
                norm_t = normalize_time_str(t)
                if norm_t is None:
                    continue
                m_int = TIME_TO_MIN[norm_t]
            dedup[m_int] = {
                "minute": m_int,
                "time": MIN_TO_TIME[m_int],
                "state": state,
            }
        clean_events[col] = [dedup[k] for k in sorted(dedup.keys())]

    csv_text = serialize_to_csv(clean_cols, clean_events)
    with open(ACTIVE_CSV_PATH, "w", encoding="utf-8") as f:
        f.write(csv_text)

    return build_response_payload(clean_cols, clean_events)


def build_response_payload(columns, events_by_col):
    """Build full JSON payload with blocks, stats, and time labels."""
    blocks_by_col = {}
    stats_by_col = {}

    for col in columns:
        evs = events_by_col.get(col, [])
        blocks = compute_blocks(evs)
        blocks_by_col[col] = blocks

        down_mins = sum(b["duration"] for b in blocks if b["state"] == "down")
        up_mins = sum(b["duration"] for b in blocks if b["state"] == "up")
        longest_down = max(
            [b["duration"] for b in blocks if b["state"] == "down"], default=0
        )
        down_blocks_count = sum(1 for b in blocks if b["state"] == "down")

        stats_by_col[col] = {
            "down_minutes": down_mins,
            "down_label": format_duration(down_mins),
            "up_minutes": up_mins,
            "up_label": format_duration(up_mins),
            "sleep_pct": round((down_mins / 600.0) * 100, 1),
            "longest_down_minutes": longest_down,
            "longest_down_label": format_duration(longest_down),
            "down_stretches": down_blocks_count,
            "event_count": len(evs),
        }

    return {
        "columns": columns,
        "events_by_col": events_by_col,
        "blocks_by_col": blocks_by_col,
        "stats_by_col": stats_by_col,
        "time_labels": TIME_LABELS,
    }


def generate_matplotlib_png(columns, blocks_by_col):
    """
    Generate PNG using Matplotlib (exact code from sleep tracking.ipynb) if Matplotlib is available.
    Returns bytes or None if Matplotlib is not installed in this Python environment.
    """
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.patches as patches
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        return None

    n_cols = max(len(columns), 1)
    fig, ax = plt.subplots(figsize=(max(11, n_cols * 1.6), 15), dpi=200)

    for col_idx, col in enumerate(columns):
        for block in blocks_by_col.get(col, []):
            state = block["state"]
            t_start = block["start_min"]
            dur = block["duration"]
            dur_str = block["label"]

            facecolor = "black" if state == "down" else "white"
            textcolor = "white" if state == "down" else "black"

            rect = patches.Rectangle(
                (col_idx - 0.5, t_start),
                1.0,
                dur,
                facecolor=facecolor,
                edgecolor="none",
                zorder=1,
            )
            ax.add_patch(rect)

            center_y = t_start + dur / 2.0

            if dur >= 30:
                fontsize = 10.5
            elif dur >= 20:
                fontsize = 9.0
            elif dur >= 15:
                fontsize = 8.0
            else:
                fontsize = 7.5

            ax.text(
                col_idx,
                center_y,
                dur_str,
                color=textcolor,
                ha="center",
                va="center",
                fontweight="bold",
                fontsize=fontsize,
                zorder=3,
            )

    for t in range(0, 601, 15):
        ax.axhline(
            t, color="#888888", linestyle=":", linewidth=0.75, alpha=0.55, zorder=2
        )

    for x in np.arange(0.5, n_cols - 0.5, 1):
        ax.axvline(x, color="#666666", linewidth=1.1, linestyle="-", zorder=2)

    ax.set_xlim(-0.5, n_cols - 0.5)
    ax.set_ylim(600, 0)

    ax.set_xticks(range(n_cols))
    ax.set_xticklabels(columns, fontsize=12, fontweight="bold")
    ax.xaxis.tick_top()
    ax.xaxis.set_label_position("top")

    hourly_ticks = list(range(0, 601, 60))
    hourly_labels = [
        "9:00 PM",
        "10:00 PM",
        "11:00 PM",
        "12:00 AM",
        "1:00 AM",
        "2:00 AM",
        "3:00 AM",
        "4:00 AM",
        "5:00 AM",
        "6:00 AM",
        "7:00 AM",
    ]
    ax.set_yticks(hourly_ticks)
    ax.set_yticklabels(hourly_labels, fontsize=10.5, fontweight="medium")

    for spine in ax.spines.values():
        spine.set_edgecolor("black")
        spine.set_linewidth(1.2)

    ax.set_title(
        "Overnight sleep tracker\n[Black = Down, White = Up]",
        fontsize=14,
        pad=22,
        fontweight="bold",
    )

    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=200, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


class SleepTrackerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/schedule":
            payload = load_schedule()
            return self.send_json(payload)

        if parsed.path == "/api/export/csv":
            payload = load_schedule()
            csv_text = serialize_to_csv(payload["columns"], payload["events_by_col"])
            body = csv_text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header(
                "Content-Disposition",
                'attachment; filename="time_schedule_export.csv"',
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/export/matplotlib-png":
            payload = load_schedule()
            png_bytes = generate_matplotlib_png(
                payload["columns"], payload["blocks_by_col"]
            )
            if png_bytes is None:
                return self.send_json(
                    {"error": "Matplotlib not available in this Python runtime"},
                    status=501,
                )
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header(
                "Content-Disposition",
                'attachment; filename="schedule_durations_visualization.png"',
            )
            self.send_header("Content-Length", str(len(png_bytes)))
            self.end_headers()
            self.wfile.write(png_bytes)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"

        if parsed.path == "/api/schedule":
            try:
                body = json.loads(raw_body)
                columns = body.get("columns", [])
                events_by_col = body.get("events_by_col", {})
                payload = save_schedule(columns, events_by_col)
                return self.send_json(payload)
            except Exception as e:
                return self.send_json({"error": str(e)}, status=400)

        if parsed.path == "/api/import/csv":
            try:
                body = json.loads(raw_body)
                csv_text = body.get("csv_text", "")
                parsed_csv = parse_csv_content(csv_text)
                if not parsed_csv["columns"]:
                    return self.send_json(
                        {"error": "No valid date columns found in CSV."}, status=400
                    )
                payload = save_schedule(
                    parsed_csv["columns"], parsed_csv["events_by_col"]
                )
                return self.send_json(payload)
            except Exception as e:
                return self.send_json({"error": str(e)}, status=400)

        if parsed.path == "/api/reset":
            try:
                payload = load_schedule()
                return self.send_json(payload)
            except Exception as e:
                return self.send_json({"error": str(e)}, status=500)

        return self.send_json({"error": "Not found"}, status=404)


def run_server(port=8080):
    ensure_data_initialized()
    server_address = ("127.0.0.1", port)
    httpd = HTTPServer(server_address, SleepTrackerHandler)
    print(f"Sleep Schedule Tracker running at http://127.0.0.1:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    run_server(port)
