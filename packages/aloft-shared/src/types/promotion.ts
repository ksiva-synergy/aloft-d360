// ─── Promotion Contract v1 ───────────────────────────────────────────────────
// Shared between Aloft (caller) and PBC (endpoint).
// Both sides must import from @aloft/shared to prevent contract drift.

export type PromotionTargetTable =
  | 'portage_bill_line_items'
  | 'portage_bill_headers'
  | 'crew_cost_actuals'
  | 'vessel_payroll_summary';

export interface PromotionRequest {
  backfill_job_id: string;
  vessel_id: string;
  promoted_by: string;
  promoted_at: string;
  target_table: PromotionTargetTable;
}

export interface PromotionResponse {
  success: boolean;
  promoted_rows: number;
  target_table: PromotionTargetTable;
  error?: string;
  error_code?: 'DUPLICATE' | 'VESSEL_NOT_FOUND' | 'JOB_NOT_FOUND' | 'VALIDATION_FAILED' | 'INTERNAL';
}

export interface PromotionAuditRecord {
  backfill_job_id: string;
  vessel_id: string;
  target_table: PromotionTargetTable;
  promoted_by: string;
  promoted_at: string;
  promoted_rows: number;
  aloft_signature: string;
}
