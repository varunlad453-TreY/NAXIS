import asyncio, sys
sys.path.insert(0, '/app')
from shared.database.collector_telemetry import list_collector_telemetry
from shared.database.client import db
async def main():
    await db.connect()
    rows = await list_collector_telemetry()
    for r in rows:
        cid = r.get('collector_id','')
        if any(x in cid for x in ['mist-ap','mist-client','mist-wired','mist-radio','mist-topology']):
            print(f"{cid:30s} status={r.get('last_status',''):10s} age={r.get('current_age_seconds')}s fail={r.get('failure_count',0)}")
    await db.disconnect()
asyncio.run(main())
