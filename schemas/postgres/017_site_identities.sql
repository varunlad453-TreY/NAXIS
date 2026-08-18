-- Migration 017: site identity table (vendor, vendor_site_id) -> site_key
--
-- `sites` carried vendor ids only inside a JSONB blob (`vendor_ids`) with a GIN
-- index and no uniqueness. Combined with a bulk create that minted a fresh
-- gen_random_uuid() per input row and used `ON CONFLICT (site_key)` — a target
-- that can never fire on a fresh key — one site accumulated one row per device
-- at that site (measured: 2,055 rows for 153 real sites; worst single site 345
-- rows, still growing).
--
-- This adds `site_identities` as the sites-side twin of `device_identities`, so
-- (vendor, vendor_site_id) -> site_key is enforced by the database rather than
-- by hope.
--
-- This file is safe to apply against duplicated data: the backfill picks the
-- oldest site_key per (vendor, vendor_site_id) via DISTINCT ON. Collapsing the
-- redundant `sites` rows, and the matching guard for duplicated `devices`, are
-- separate explicit steps (see 018).

-- ---------------------------------------------------------------------------
-- Site identities
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_identities (
    id              BIGSERIAL   PRIMARY KEY,
    site_key        TEXT        NOT NULL REFERENCES sites(site_key) ON DELETE CASCADE,
    vendor          TEXT        NOT NULL,
    vendor_site_id  TEXT        NOT NULL,
    vendor_site_name TEXT       NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_site_identities_vendor_id UNIQUE (vendor, vendor_site_id)
);

CREATE INDEX IF NOT EXISTS idx_site_identities_site_key ON site_identities (site_key);
CREATE INDEX IF NOT EXISTS idx_site_identities_lookup   ON site_identities (vendor, vendor_site_id);

COMMENT ON TABLE site_identities IS
    'Maps (vendor, vendor_site_id) to a canonical site_key. Sites-side twin of device_identities.';

-- Backfill from the existing vendor_ids JSONB. Keeps the OLDEST site_key per
-- (vendor, vendor_site_id) so the winner is stable and matches the dedupe step.
INSERT INTO site_identities (site_key, vendor, vendor_site_id, vendor_site_name)
SELECT DISTINCT ON (kv.key, kv.value)
       s.site_key, kv.key, kv.value, s.name
FROM sites s
CROSS JOIN LATERAL jsonb_each_text(s.vendor_ids) AS kv(key, value)
WHERE kv.value <> ''
ORDER BY kv.key, kv.value, s.created_at, s.site_key
ON CONFLICT (vendor, vendor_site_id) DO NOTHING;
