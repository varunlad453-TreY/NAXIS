import asyncio
from shared.database.collector_telemetry import list_collector_telemetry
from shared.database.client import db
async def main():
    await db.connect()
    rows = await list_collector_telemetry()
    for r in rows:
        cid = r['collector_id']
        if 'velocloud' in cid:
            print(f"{cid:30s} status={r['last_status']:10s} age={r['current_age_seconds']}s fail={r['failure_count']}")
    await db.disconnect()
asyncio.run(main())
