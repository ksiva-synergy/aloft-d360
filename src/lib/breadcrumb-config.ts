/**
 * Maps URL path segments to human-readable breadcrumb labels.
 * Dynamic segments (e.g. [jobId]) are handled via the `dynamicLabels` prop
 * passed to AppBreadcrumb at runtime.
 */
export const routeLabels: Record<string, string> = {
  // Top-level sections
  dashboard: 'Dashboard',
  vessels: 'Vessels',
  seafarers: 'Seafarers',
  crew: 'Crew',
  reports: 'Reports',
  compliance: 'Compliance',

  // Vessel operations
  'seafarer-contracts': 'Contracts',
  'travel-management': 'Travel Management',
  'cba-compliance': 'CBA Compliance',

  // Onboard management
  'master-cash': 'Master Cash',
  'a05-extra-overtime': 'A05 Extra Overtime',
  'onboard-work-allowance': 'Onboard Work Allowance',
  'bonded-store': 'Bonded Store',
  'calling-cards': 'Calling Cards',
  'cash-advance': 'Cash Advance',
  allotments: 'Allotments',
  welfare: 'Welfare',
  canteen: 'Canteen',

  // Finance & payroll
  'a01a-earnings': 'A01a Earnings',
  'payroll-sheets': 'Payroll Sheets',
  'wage-components': 'Wage Analytics',

  // Admin section
  admin: 'Admin',
  health: 'Pipeline Health',
  budgets: 'Budgets',
  validate: 'Validation',
  'deep-dive': 'Deep Dive',
  extract: 'Extract',
  track: 'Track',
  tracking: 'Tracking',
  versions: 'Versions',
  onboarding: 'Onboarding',
  payroll: 'Payroll',
  'approval-policies': 'Approval Policies',
  'wage-components-catalog': 'Wage Components Catalog',
  'wage-components-admin': 'Wage Components Admin',
  'user-role-assignments': 'User Role Assignments',
  'component-debugger': 'Component Debugger',
  backfill: 'Backfill',

  // Sync schedules
  'sync-schedules': 'Sync Schedules',
  monitoring: 'Monitoring',
  notifications: 'Notifications',

  // Agent lab
  'agent-lab': 'Agent Lab',
  'agent-staging': 'Agent Staging',
  graph: 'Graph',
  schemas: 'Schemas',
  scenarios: 'Scenarios',
  bandits: 'Bandits',
  workbench: 'Workbench',
  catalog: 'Catalog',
  pipelines: 'Pipelines',
  runs: 'Runs',
  deploy: 'Deploy',
  evals: 'Evals',
  inbox: 'HITL Inbox',
  healing: 'Healing',
  cost: 'Cost',
  policies: 'Policies',
  environments: 'Environments',
  audit: 'Audit Log',

  // Activity tracking
  'activity-tracking': 'Activity Tracking',
  recordings: 'Recordings',

  // Teams bot
  'teams-bot': 'Teams Bot',
  logs: 'Logs',

  // Debug tools
  'debug-tools': 'Debug Tools',
  debug: 'Debug',
  'check-salary-revision': 'Salary Revision Check',
  'find-contract': 'Find Contract',
  'component-categorization': 'Component Categorization',
  'missing-wage-components': 'Missing Wage Components',
  'ocr-compare': 'OCR Compare',
  'payroll-submit': 'Payroll Submit',
  'connectivity-tests': 'Connectivity Tests',

  // Misc
  'bow-testing': 'BOW Testing',
  'bow-migration': 'BOW Migration',
  'style-guide': 'Style Guide',
  'performance-dashboard': 'Performance Dashboard',
  'test-connections': 'Test Connections',
  'debug-onboard-crew': 'Debug Onboard Crew',
  'debug-a01a-vs-payroll': 'A01a vs Payroll Debug',
}

/**
 * Segments that should be hidden from the breadcrumb trail.
 * These are structural URL parts that don't add meaningful context.
 */
export const hiddenSegments = new Set<string>([])

/**
 * Routes where the breadcrumb should NOT be shown at all
 * (auth pages, root, etc.)
 */
export const noBreadcrumbRoutes = new Set<string>([
  '/',
  '/auth/signin',
  '/auth/error',
  '/unauthorized',
  '/dashboard',
])
