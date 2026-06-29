// Neo4j uniqueness constraints for the Naxis topology graph.
// Run this before indexes when initializing a fresh graph.

CREATE CONSTRAINT device_id_unique IF NOT EXISTS
  FOR (d:Device) REQUIRE d.device_id IS UNIQUE;

CREATE CONSTRAINT site_id_unique IF NOT EXISTS
  FOR (s:Site) REQUIRE s.site_id IS UNIQUE;

CREATE CONSTRAINT client_id_unique IF NOT EXISTS
  FOR (c:Client) REQUIRE c.client_id IS UNIQUE;

CREATE CONSTRAINT interface_id_unique IF NOT EXISTS
  FOR (i:Interface) REQUIRE i.interface_id IS UNIQUE;
