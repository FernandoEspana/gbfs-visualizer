// Raw feed shapes, confined to this directory: nothing outside core/gbfs/ may
// import them. Every field is `unknown` so the mapper has to narrow it through a
// guard — a provider sending the wrong type is a dropped item, not a crash.

/** A single item as it arrives, covering both dialects. */
export interface RawVehicle {
  bike_id?: unknown; // GBFS 2.2
  vehicle_id?: unknown; // GBFS 3.x
  lat?: unknown;
  lon?: unknown;
  is_reserved?: unknown;
  is_disabled?: unknown;
  vehicle_type_id?: unknown;
  vehicle_type?: unknown; // Lime extension, not in the GBFS spec
  current_range_meters?: unknown;
  last_reported?: unknown; // number (2.2) or RFC3339 string (3.x)
}

/** The envelope. */
export interface RawFeed {
  last_updated?: unknown; // number (2.2) or RFC3339 string (3.x)
  ttl?: unknown; // seconds
  data?: { bikes?: unknown; vehicles?: unknown };
}
