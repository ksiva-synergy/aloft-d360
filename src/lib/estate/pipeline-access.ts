/** Only platform admins may launch, continue, or cancel estate harvest pipelines. */
export function canRunEstatePipeline(role: string | null | undefined): boolean {
  return role === 'platform_admin';
}

export const ESTATE_PIPELINE_FORBIDDEN_MESSAGE =
  'Only platform admins can run estate harvest pipelines.';
