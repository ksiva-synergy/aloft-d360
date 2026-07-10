import { z } from 'zod';

export const TRIGGER_TYPES = ['T1','T2','T3','T4','T5','T6','T7'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TECHNIQUES = [
  'self_examination',
  'evening_review',
  'premeditatio',
  'necessity',
  'dichotomy_epictetus',
  'view_from_above',
] as const;
export type Technique = (typeof TECHNIQUES)[number];

export const SEVERITIES = ['note', 'caution', 'gate'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ['surfaced','withheld','dismissed','acknowledged','acted'] as const;
export type ReflectionStatus = (typeof STATUSES)[number];

export const SUBJECT_KINDS = ['build_session','trajectory'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const SuggestedActionSchema = z.object({
  kind: z.enum(['confirm_assumption','edit_field','answer_question','acknowledge']),
  target: z.string().optional(),
  label:  z.string().optional(),
});
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;

export const ReflectionEvalResultSchema = z.object({
  surface:          z.boolean(),
  trigger:          z.enum(TRIGGER_TYPES).optional(),
  technique:        z.enum(TECHNIQUES).optional(),
  headline:         z.string().optional(),
  body:             z.string().optional(),
  suggested_action: SuggestedActionSchema.nullable().optional(),
  severity:         z.enum(SEVERITIES).optional(),
});
export type ReflectionEvalResult = z.infer<typeof ReflectionEvalResultSchema>;
