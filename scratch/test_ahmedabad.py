import asyncio
import sys
sys.path.insert(0, ".")
from backend.shared.database.client import db

async def test():
    await db.connect()
    rows = await db.fetch("SELECT device_id, hostname, site_id, platform, connected FROM inventory WHERE hostname LIKE '%TMLAHD%' OR site_name LIKE '%Ahmedabad%'")
    print("Found rows:", len(rows))
    for r in rows:
        print(dict(r))

asyncio.run(test())
