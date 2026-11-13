-- SIRE_Fin parity SQL (scripts/powerbi/validate-sire-fin.ts)
-- Audits: PQ filters on bi_vw_internalaudit (status, manager_group, ReferenceNo).
-- SIRE 2_0: DATE IS NOT NULL, NO_OF_FINDINGS > 10, IMO as text (matches PBI import).
-- SIRE_Check key: TRIM(IMO_NO) || "-" || yyyMMdd (PBI KeyConcatenate calc column).
-- Measure: COUNT(DISTINCT sire_check) non-blank (PBI DISTINCTCOUNTNOBLANK).

WITH audits_base AS (
  SELECT
    TRIM(CAST(imono AS STRING)) AS imo,
    AuditToDate AS aud_to,
    AuditFromDate AS aud_from,
    ReferenceNo,
    status,
    manager_group
  FROM reporting_layer.qhse.bi_vw_internalaudit
  WHERE 1 = 1
  
      AND status <> 'Rejected'
      AND manager_group <> 'SMIC'
      AND ReferenceNo IS NOT NULL
),
audits_with_next AS (
  SELECT
    a.*,
    (
      SELECT MIN(b.aud_from)
      FROM audits_base b
      WHERE b.imo = a.imo AND b.aud_from > a.aud_to
    ) AS next_aud_from
  FROM audits_base a
),
with_sire_check AS (
  SELECT
    a.*,
    (
      SELECT MAX(CONCAT(TRIM(s.IMO_NO), '-', DATE_FORMAT(s.DATE, 'yyyyMMdd')))
      FROM reporting_layer.qhse.bi_synergypool_vw_sire_2_0 s
      WHERE TRIM(CAST(s.IMO_NO AS STRING)) = a.imo
        AND s.DATE IS NOT NULL
        AND CAST(s.NO_OF_FINDINGS AS BIGINT) > 10
        AND s.DATE > a.aud_to
        AND a.next_aud_from IS NOT NULL
        AND s.DATE < a.next_aud_from
    ) AS sire_check
  FROM audits_with_next a
)
SELECT COUNT(DISTINCT sire_check) AS sire_fin
FROM with_sire_check
WHERE sire_check IS NOT NULL AND TRIM(CAST(sire_check AS STRING)) <> ''
