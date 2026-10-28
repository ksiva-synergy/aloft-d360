import type { ConnectionKind } from './types';

/** UI field metadata for creating or editing a storage connection (no credentials in Automate drafts). */
export type ConnectionFieldSpec = {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  multiline?: boolean;
};

export type ConnectionKindFormSpec = {
  kind: ConnectionKind;
  label: string;
  blurb: string;
  config: ConnectionFieldSpec[];
  secret: ConnectionFieldSpec[];
  help: string;
};

export const CONNECTION_FORM_SPECS: ConnectionKindFormSpec[] = [
  {
    kind: 's3',
    label: 'Amazon S3',
    blurb: 'Bucket, region, and access keys.',
    config: [
      { key: 'region', label: 'Region', placeholder: 'ap-south-1' },
      { key: 'bucket', label: 'Bucket', placeholder: 'my-company-documents' },
      {
        key: 'rootFolder',
        label: 'Root folder',
        placeholder: 'certificates/crew',
        optional: true,
        hint: 'Only this folder and below can be read. Leave empty for the whole bucket.',
      },
    ],
    secret: [
      { key: 'accessKeyId', label: 'Access key ID', placeholder: 'AKIA…' },
      { key: 'secretAccessKey', label: 'Secret access key' },
    ],
    help: 'Use an IAM user limited to s3:ListBucket and s3:GetObject on this bucket.',
  },
  {
    kind: 'azure_blob',
    label: 'Azure Blob Storage',
    blurb: 'Container and connection string.',
    config: [
      { key: 'container', label: 'Container', placeholder: 'documents' },
      { key: 'rootFolder', label: 'Root folder', optional: true, hint: 'Only this folder and below can be read.' },
    ],
    secret: [
      {
        key: 'connectionString',
        label: 'Connection string',
        placeholder: 'DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…',
        multiline: true,
      },
    ],
    help: 'Prefer a SAS connection string with Read and List only.',
  },
  {
    kind: 'sharepoint',
    label: 'SharePoint',
    blurb: 'Site URL and Entra app credentials.',
    config: [
      { key: 'tenantId', label: 'Tenant ID', placeholder: '00000000-0000-0000-0000-000000000000' },
      { key: 'clientId', label: 'Application (client) ID', placeholder: '00000000-0000-0000-0000-000000000000' },
      { key: 'siteUrl', label: 'Site URL', placeholder: 'https://contoso.sharepoint.com/sites/Finance' },
      { key: 'library', label: 'Document library', placeholder: 'Documents', optional: true, hint: 'Leave empty for the site’s default library.' },
      { key: 'rootFolder', label: 'Root folder', optional: true },
    ],
    secret: [{ key: 'clientSecret', label: 'Client secret' }],
    help: 'Register an Entra app with Microsoft Graph Sites.Read (or Sites.Selected) and admin consent.',
  },
];

export function connectionFormSpec(kind: ConnectionKind): ConnectionKindFormSpec {
  const spec = CONNECTION_FORM_SPECS.find((s) => s.kind === kind);
  if (!spec) throw new Error(`Unknown connection kind: ${kind}`);
  return spec;
}
