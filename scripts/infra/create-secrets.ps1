# create-secrets.ps1
# Creates the two AWS Secrets Manager secrets the harvester task definition
# references (see infra/context/task-definition.json → `secrets`):
#   aloft/aurora      → DATABASE_URL, DIRECT_URL
#   aloft/databricks  → DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET,
#                       DATABRICKS_HOST, DATABRICKS_HTTP_PATH
#
# SECURITY: Do NOT commit real credentials. Fill the placeholders below at run
# time (or source them from a local, git-ignored file / your password manager)
# and run this once per environment. The original aloft-platform copy of this
# script contained live production secrets inline — those have been redacted.
#
# To rotate an existing secret, swap `create-secret` for `put-secret-value`.

$auroraJson = @{
  DATABASE_URL = "postgresql://<USER>:<PASSWORD>@<AURORA_WRITER_HOST>:5432/<DB>?schema=public&sslmode=require"
  DIRECT_URL   = "postgresql://<USER>:<PASSWORD>@<AURORA_WRITER_HOST>:5432/<DB>?schema=public&sslmode=require"
} | ConvertTo-Json -Compress

$databricksJson = @{
  DATABRICKS_CLIENT_ID     = "<DATABRICKS_CLIENT_ID>"
  DATABRICKS_CLIENT_SECRET = "<DATABRICKS_CLIENT_SECRET>"
  DATABRICKS_HOST          = "<workspace>.azuredatabricks.net"
  DATABRICKS_HTTP_PATH     = "/sql/1.0/warehouses/<WAREHOUSE_ID>"
} | ConvertTo-Json -Compress

aws secretsmanager create-secret `
  --name "aloft/aurora" `
  --region ap-south-1 `
  --secret-string $auroraJson

aws secretsmanager create-secret `
  --name "aloft/databricks" `
  --region ap-south-1 `
  --secret-string $databricksJson
