import asyncio
from shared.database.collector_telemetry import list_collector_telemetry
from shared.database.client import db
async def main():
    await db.connect()
    rows = await list_collector_telemetry()
    for r in rows:
        cid = r["collector_id"]
        if "velocloud" in cid and cid != "velocloud-auth":
            e = r.get("last_error") or ""
            print(f"{cid:30s} status={r['last_status']:8s} rows={r['rows_written']:>5} age={r['current_age_seconds']}s  err={e}")
    print("---")
    for r in rows:
        cid = r["collector_id"]
        if cid.startswith("mist-ap") or cid.startswith("mist-client") or cid.startswith("mist-wired") or cid.startswith("mist-radio"):
            print(f"{cid:30s} status={r['last_status']:8s} rows={r['rows_written']:>5} age={r['current_age_seconds']}s")
    await db.disconnect()
asyncio.run(main())
