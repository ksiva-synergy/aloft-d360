/**
 * Whether Inspector should call a real LLM or return the canned warehouse demo stream.
 * EB/EC2 often use an instance profile (no AWS_ACCESS_KEY_ID in env).
 */
export function hasStaticAwsCredentials(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export function hasXaiCredentials(): boolean {
  return !!process.env.XAI_API_KEY?.trim();
}

export function hasFoundryCredentials(): boolean {
  return !!(process.env.FOUNDRY_ENDPOINT?.trim() && process.env.FOUNDRY_API_KEY?.trim());
}

export function hasBedrockMantleCredentials(): boolean {
  return !!process.env.BEDROCK_MANTLE_API_KEY?.trim();
}

export function hasLlmLiteCredentials(): boolean {
  const base =
    process.env.LLMLITE_BASE_URL?.trim() || process.env.llmlite_base_url?.trim();
  const key =
    process.env.LLMLITE_API_KEY?.trim() || process.env.llmlite_api_key?.trim();
  return !!(base && key);
}

/** True when any supported provider can be invoked (not the demo canned stream). */
export function inspectorLlmConfigured(): boolean {
  if (
    hasStaticAwsCredentials() ||
    hasXaiCredentials() ||
    hasFoundryCredentials() ||
    hasBedrockMantleCredentials() ||
    hasLlmLiteCredentials()
  ) {
    return true;
  }
  // Elastic Beanstalk / platform-injected execution env (Docker or Node platform).
  if (process.env.AWS_EXECUTION_ENV === 'AWS_ElasticBeanstalk') {
    return true;
  }
  // Explicit opt-in for EC2 instance profile without static keys (e.g. Bedrock via IAM role).
  if (process.env.INSPECTOR_USE_INSTANCE_PROFILE === 'true') {
    return true;
  }
  return false;
}
