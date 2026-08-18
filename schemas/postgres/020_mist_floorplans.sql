-- Migration 020: real Mist floorplans + AP pixel placements.
--
-- A Mist site owns ~20 maps (floorplans), so UNIQUE(vendor, vendor_site_id)
-- allowed only one Naxis location per vendor site and made floor-level mappings
-- impossible. The arbiter becomes (vendor, vendor_site_id, COALESCE(vendor_map_id, ''))
-- so the site-level row (vendor_map_id NULL) and every floor row coexist.

ALTER TABLE location_mappings
    DROP CONSTRAINT IF EXISTS location_mappings_vendor_vendor_site_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loc_mappings_vendor_site_map
    ON location_mappings (vendor, vendor_site_id, COALESCE(vendor_map_id, ''));

CREATE TABLE IF NOT EXISTS ap_placements (
    device_id      TEXT PRIMARY KEY,
    location_id    TEXT NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    vendor         TEXT NOT NULL,
    vendor_site_id TEXT NOT NULL,
    vendor_map_id  TEXT NOT NULL,
    x              DOUBLE PRECISION,
    y              DOUBLE PRECISION,
    x_pct          DOUBLE PRECISION NOT NULL,
    y_pct          DOUBLE PRECISION NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_placements_location ON ap_placements(location_id);
