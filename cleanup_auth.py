import asyncio
from shared.database.client import db
async def main():
    await db.connect()
    r = await db.execute("DELETE FROM collector_run_ledger WHERE collector_id = 'velocloud-auth'")
    print(f"Deleted {r} rows")
    await db.disconnect()
asyncio.run(main())
