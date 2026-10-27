/**
 * SQL helpers for `platform_estate_objects`.
 *
 * In Postgres this table stores `source_id` as TEXT (UUID strings), not the uuid
 * type used on `platform_context_objects.source_id`. Raw queries must use text
 * equality (`source_id = $n`), never `source_id = $n::uuid` on the parameter.
 */

/** Predicate fragment for planEstateSplit / inventory counts (org $1, source $2). */
export const ESTATE_OBJECTS_BY_SOURCE_SQL = `source_id = $2`;
