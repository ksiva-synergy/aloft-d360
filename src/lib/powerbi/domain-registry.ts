/** Built-in domain lexicon (org can extend via `pbi_domains` rows). */
export type DomainDefinition = {
  domain_key: string;
  name: string;
  steward_group: string | null;
  sensitivity: string | null;
  rollout_wave: number;
  lexicon: string[];
};

export const DEFAULT_PBI_DOMAINS: DomainDefinition[] = [
  {
    domain_key: 'qhse',
    name: 'QHSE / Environment',
    steward_group: 'qhse-stewards',
    sensitivity: 'standard',
    rollout_wave: 1,
    lexicon: ['cii', 'co2', 'emission', 'qhse', 'enerva', 'fuel', 'carbon', 'vessel', 'safety'],
  },
  {
    domain_key: 'finance',
    name: 'Finance',
    steward_group: 'finance-stewards',
    sensitivity: 'restricted',
    rollout_wave: 2,
    lexicon: ['opex', 'budget', 'finance', 'accounting', 'variance', 'capex', 'ledger', 'invoice'],
  },
  {
    domain_key: 'technical',
    name: 'Technical / Fleet',
    steward_group: 'technical-stewards',
    sensitivity: 'standard',
    rollout_wave: 2,
    lexicon: ['fleet', 'maintenance', 'technical', 'voyage', 'distance', 'engine'],
  },
  {
    domain_key: 'crewing',
    name: 'Crewing / HR',
    steward_group: 'hr-stewards',
    sensitivity: 'restricted',
    rollout_wave: 3,
    lexicon: ['crew', 'seafarer', 'hr', 'training', 'payroll'],
  },
  {
    domain_key: 'procurement',
    name: 'Procurement',
    steward_group: 'procurement-stewards',
    sensitivity: 'standard',
    rollout_wave: 3,
    lexicon: ['procurement', 'purchase', 'vendor', 'po'],
  },
  {
    domain_key: 'commercial',
    name: 'Commercial',
    steward_group: 'commercial-stewards',
    sensitivity: 'standard',
    rollout_wave: 4,
    lexicon: ['commercial', 'charter', 'revenue', 'client'],
  },
  {
    domain_key: 'it',
    name: 'IT / Other',
    steward_group: null,
    sensitivity: 'standard',
    rollout_wave: 99,
    lexicon: ['usage', 'metrics', 'portal'],
  },
];
