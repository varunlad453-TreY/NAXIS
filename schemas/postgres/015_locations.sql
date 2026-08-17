-- Migration 015: Master Authoritative Physical Locations Registry (WP-5)
-- Establishes Naxis's canonical facility hierarchy (Region -> Site -> Building -> Floor -> Zone)
-- and vendor site mapping table.

CREATE TABLE IF NOT EXISTS locations (
    location_id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES locations(location_id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'region' | 'site' | 'building' | 'floor' | 'zone'
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    address TEXT,
    floorplan_image_url TEXT,
    floor_number INT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);

CREATE TABLE IF NOT EXISTS location_mappings (
    mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id TEXT NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    vendor TEXT NOT NULL,
    vendor_site_id TEXT NOT NULL,
    vendor_map_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vendor, vendor_site_id)
);

CREATE INDEX IF NOT EXISTS idx_loc_mappings_vendor_site ON location_mappings(vendor, vendor_site_id);
