import asyncio
import asyncpg

async def test():
    conn = await asyncpg.connect('postgresql://naxis:naxis_secure_pass_2026@localhost:5432/naxis_db')
    rows = await conn.fetch("SELECT device_id, hostname, site_name, site_id FROM inventory WHERE LOWER(hostname) LIKE '%109%' OR LOWER(site_name) LIKE '%b109%' OR LOWER(hostname) LIKE '%tmlahd%'")
    print(f"Match count: {len(rows)}")
    for r in rows:
        print(dict(r))
    await conn.close()

asyncio.run(test())
