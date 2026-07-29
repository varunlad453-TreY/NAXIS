import asyncio
from shared.database.client import db
async def main():
    await db.connect()
    r = await db.fetchrow("SELECT COUNT(*) AS total FROM events")
    total = r["total"]
    r = await db.fetchrow("SELECT COUNT(*) AS last_24h FROM events WHERE timestamp >= NOW() - INTERVAL '24 hours'")
    last24 = r["last_24h"]
    r = await db.fetchrow("SELECT COUNT(*) AS last_1h FROM events WHERE timestamp >= NOW() - INTERVAL '1 hour'")
    last1h = r["last_1h"]
    print(f"Total events: {total:,}")
    print(f"Last 24h:     {last24:,}")
    print(f"Last 1h:      {last1h:,}")
    await db.disconnect()
asyncio.run(main())
