"""
Export a slice of live events as a JSON fixture for offline perf/CI work.

Usage (from the worker container or a host with DB access):
    python -m scripts.export_event_fixture --limit 100 --output events_sample.json

Core columns only (no raw_event blobs) so the fixture stays small. The
full-size export (--limit 50000) is generated at WP-1 when the consumer
(perf harness) exists.
"""

import argparse
import asyncio
import json

from shared.database.client import db

_COLUMNS = [
    "event_id", "timestamp", "source", "source_event_id",
    "severity", "category", "event_type", "title",
    "device_id", "device_name", "site_id", "site_name",
    "tags", "metadata",
]


async def main(limit: int, output: str) -> None:
    await db.connect()
    try:
        rows = await db.fetch(
            f"SELECT {', '.join(_COLUMNS)} FROM events ORDER BY timestamp DESC LIMIT {int(limit)}"
        )
    finally:
        await db.disconnect()

    data = []
    for r in rows:
        row = dict(r)
        row["timestamp"] = row["timestamp"].isoformat()
        row["metadata"] = json.loads(row["metadata"]) if isinstance(row["metadata"], str) else row["metadata"]
        data.append(row)

    with open(output, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Exported {len(data)} events to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--output", default="events_fixture.json")
    args = parser.parse_args()
    asyncio.run(main(args.limit, args.output))
