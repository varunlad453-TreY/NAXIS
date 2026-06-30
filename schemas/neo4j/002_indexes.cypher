// Neo4j indexes for common topology query patterns.
// These are separate from constraints and can be added after constraints exist.

CREATE INDEX device_site_id IF NOT EXISTS
  FOR (d:Device) ON (d.site_id);

CREATE INDEX device_platform IF NOT EXISTS
  FOR (d:Device) ON (d.platform);

CREATE INDEX device_reachability IF NOT EXISTS
  FOR (d:Device) ON (d.reachability);

CREATE INDEX device_type IF NOT EXISTS
  FOR (d:Device) ON (d.device_type);

CREATE INDEX event_timestamp IF NOT EXISTS
  FOR (e:Event) ON (e.timestamp);

CREATE INDEX link_status IF NOT EXISTS
  FOR ()-[l:CONNECTS]-() ON (l.status);

CREATE INDEX belongs_to_site IF NOT EXISTS
  FOR ()-[r:BELONGS_TO]-() ON (r.since);
