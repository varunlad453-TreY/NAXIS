import asyncio
import asyncpg

async def main():
    conn = await asyncpg.connect('postgresql://naxis:naxis_secure_pass_2026@postgres:5432/naxis_db')
    loc_name = "Ahmedabad: Area Office (PVBU) (B109)"
    tokens = [t.strip(" ()[]:") for t in loc_name.replace(":", " ").replace("(", " ").replace(")", " ").split() if len(t.strip(" ()[]:")) >= 3]
    specific_tokens = [t for t in tokens if t.lower() not in ("site", "building", "floor", "region", "root", "unknown", "office", "area")]
    bld_tokens = [t for t in specific_tokens if any(c.isdigit() for c in t) or t.lower() in ("pvbu", "cvbu", "tss")]
    target_token = bld_tokens[0] if bld_tokens else (specific_tokens[0] if specific_tokens else "")
    search_pattern = f"%{target_token.lower()}%"
    print("search_pattern:", search_pattern)

    rows = await conn.fetch("""
        SELECT device_id, hostname, site_name FROM inventory
        WHERE LOWER(site_name) LIKE $1 OR LOWER(hostname) LIKE $1 OR LOWER(device_id) LIKE $1
        ORDER BY hostname ASC
        LIMIT 4
    """, search_pattern)
    print("Found rows:", len(rows))
    for r in rows:
        print(dict(r))

asyncio.run(main())
