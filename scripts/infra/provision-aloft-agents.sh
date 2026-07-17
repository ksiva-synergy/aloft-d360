#!/usr/bin/env bash
# =============================================================
# ALOFT Agent Runner — AWS Infrastructure Provisioning
# =============================================================
# Provisions all AWS resources needed for ECS async agent execution.
# Idempotent — safe to re-run. Skips resources that already exist.
# Writes a full audit log to scripts/infra/audit/provision-TIMESTAMP.json
#
# Usage: bash scripts/infra/provision-aloft-agents.sh
# Requires: aws CLI, jq
# AWS Account: 454073573537
# Region: ap-south-1
# =============================================================

set -euo pipefail

ACCOUNT_ID="454073573537"
REGION="ap-south-1"
CLUSTER_NAME="aloft-agents-prod"
ECR_REPO="aloft-agent-runner"
LOG_GROUP="/ecs/aloft-agent-runner"
SG_NAME="aloft-agent-runner-sg"
VPC_ID="vpc-08f00e78664e1596e"
AURORA_SG_ID="sg-0070ad6c3f4299396"
SUBNET_1A="subnet-03ee2945ebdafd883"
SUBNET_1B="subnet-0a6a530408b9e906a"
EXECUTION_ROLE_ARN="arn:aws:iam::454073573537:role/ecsTaskExecutionRole"
TASK_ROLE_ARN="arn:aws:iam::454073573537:role/ecsTaskExecutionRole"
TASK_FAMILY="aloft-agent-runner"

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
AUDIT_DIR="scripts/infra/audit"
AUDIT_FILE="${AUDIT_DIR}/provision-${TIMESTAMP}.json"
mkdir -p "$AUDIT_DIR"

# Audit log accumulator
AUDIT="{}"

log() {
  echo "[$(date -u +"%H:%M:%S")] $1"
}

audit_step() {
  local step="$1"
  local status="$2"
  local output="$3"
  AUDIT=$(echo "$AUDIT" | jq \
    --arg step "$step" \
    --arg status "$status" \
    --arg output "$output" \
    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '. + {($step): {"status": $status, "output": $output, "timestamp": $ts}}')
}

# =============================================================
# A1 — ECS Cluster
# =============================================================
log "A1: Creating ECS cluster '$CLUSTER_NAME'..."

CLUSTER_STATUS=$(aws ecs describe-clusters \
  --clusters "$CLUSTER_NAME" \
  --region "$REGION" \
  --query "clusters[0].status" \
  --output text 2>/dev/null || echo "MISSING")

if [ "$CLUSTER_STATUS" = "ACTIVE" ]; then
  CLUSTER_ARN=$(aws ecs describe-clusters \
    --clusters "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "clusters[0].clusterArn" \
    --output text)
  log "A1: Cluster already exists — $CLUSTER_ARN"
  audit_step "A1_cluster" "skipped" "$CLUSTER_ARN"
else
  CLUSTER_OUT=$(aws ecs create-cluster \
    --cluster-name "$CLUSTER_NAME" \
    --region "$REGION" \
    --capacity-providers FARGATE FARGATE_SPOT \
    --default-capacity-provider-strategy \
      capacityProvider=FARGATE,weight=1 \
    --output json)
  CLUSTER_ARN=$(echo "$CLUSTER_OUT" | jq -r '.cluster.clusterArn')
  log "A1: Created cluster — $CLUSTER_ARN"
  audit_step "A1_cluster" "created" "$CLUSTER_ARN"
fi

# =============================================================
# A2 — ECR Repository
# =============================================================
log "A2: Creating ECR repository '$ECR_REPO'..."

ECR_URI=$(aws ecr describe-repositories \
  --repository-names "$ECR_REPO" \
  --region "$REGION" \
  --query "repositories[0].repositoryUri" \
  --output text 2>/dev/null || echo "")

if [ -n "$ECR_URI" ] && [ "$ECR_URI" != "None" ]; then
  log "A2: Repository already exists — $ECR_URI"
  audit_step "A2_ecr" "skipped" "$ECR_URI"
else
  ECR_OUT=$(aws ecr create-repository \
    --repository-name "$ECR_REPO" \
    --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --output json)
  ECR_URI=$(echo "$ECR_OUT" | jq -r '.repository.repositoryUri')
  log "A2: Created repository — $ECR_URI"
  audit_step "A2_ecr" "created" "$ECR_URI"
fi

# =============================================================
# A3 — CloudWatch Log Group
# =============================================================
log "A3: Creating CloudWatch log group '$LOG_GROUP'..."

LG_EXISTS=$(aws logs describe-log-groups \
  --log-group-name-prefix "$LOG_GROUP" \
  --region "$REGION" \
  --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" \
  --output text 2>/dev/null || echo "")

if [ -n "$LG_EXISTS" ]; then
  log "A3: Log group already exists"
  audit_step "A3_log_group" "skipped" "$LOG_GROUP"
else
  aws logs create-log-group \
    --log-group-name "$LOG_GROUP" \
    --region "$REGION"
  aws logs put-retention-policy \
    --log-group-name "$LOG_GROUP" \
    --retention-in-days 30 \
    --region "$REGION"
  log "A3: Created log group with 30-day retention"
  audit_step "A3_log_group" "created" "$LOG_GROUP"
fi

# =============================================================
# A4 — Security Group
# =============================================================
log "A4: Creating security group '$SG_NAME'..."

AGENT_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --region "$REGION" \
  --query "SecurityGroups[0].GroupId" \
  --output text 2>/dev/null || echo "None")

if [ "$AGENT_SG_ID" != "None" ] && [ -n "$AGENT_SG_ID" ]; then
  log "A4: Security group already exists — $AGENT_SG_ID"
  audit_step "A4_security_group" "skipped" "$AGENT_SG_ID"
else
  SG_OUT=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "Aloft agent runner Fargate tasks" \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --output json)
  AGENT_SG_ID=$(echo "$SG_OUT" | jq -r '.GroupId')
  log "A4: Created security group — $AGENT_SG_ID"

  # Egress: HTTPS (Bedrock + Azure)
  aws ec2 authorize-security-group-egress \
    --group-id "$AGENT_SG_ID" \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0 \
    --region "$REGION" 2>/dev/null || true

  # Egress: PostgreSQL (Aurora)
  aws ec2 authorize-security-group-egress \
    --group-id "$AGENT_SG_ID" \
    --protocol tcp \
    --port 5432 \
    --cidr 0.0.0.0/0 \
    --region "$REGION" 2>/dev/null || true

  audit_step "A4_security_group" "created" "$AGENT_SG_ID"
fi

# =============================================================
# A5 — Aurora ingress from agent runner SG
# =============================================================
log "A5: Adding agent runner SG to Aurora inbound rules..."

ALREADY_AUTHORIZED=$(aws ec2 describe-security-groups \
  --group-ids "$AURORA_SG_ID" \
  --region "$REGION" \
  --query "SecurityGroups[0].IpPermissions[?UserIdGroupPairs[?GroupId=='$AGENT_SG_ID']]" \
  --output text 2>/dev/null || echo "")

if [ -n "$ALREADY_AUTHORIZED" ]; then
  log "A5: Aurora already allows inbound from $AGENT_SG_ID"
  audit_step "A5_aurora_ingress" "skipped" "$AGENT_SG_ID"
else
  aws ec2 authorize-security-group-ingress \
    --group-id "$AURORA_SG_ID" \
    --protocol tcp \
    --port 5432 \
    --source-group "$AGENT_SG_ID" \
    --region "$REGION"
  log "A5: Added Aurora ingress rule for $AGENT_SG_ID"
  audit_step "A5_aurora_ingress" "created" "$AGENT_SG_ID"
fi

# =============================================================
# A6 — ECS Task Definition
# =============================================================
log "A6: Registering task definition '$TASK_FAMILY'..."

IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:latest"

TD_OUT=$(aws ecs register-task-definition \
  --region "$REGION" \
  --family "$TASK_FAMILY" \
  --network-mode awsvpc \
  --requires-compatibilities FARGATE \
  --cpu 512 \
  --memory 1024 \
  --execution-role-arn "$EXECUTION_ROLE_ARN" \
  --task-role-arn "$TASK_ROLE_ARN" \
  --container-definitions "[{
    \"name\": \"agent-runner\",
    \"image\": \"${IMAGE_URI}\",
    \"essential\": true,
    \"environment\": [],
    \"logConfiguration\": {
      \"logDriver\": \"awslogs\",
      \"options\": {
        \"awslogs-group\": \"${LOG_GROUP}\",
        \"awslogs-region\": \"${REGION}\",
        \"awslogs-stream-prefix\": \"agent\"
      }
    }
  }]" \
  --output json)

TD_ARN=$(echo "$TD_OUT" | jq -r '.taskDefinition.taskDefinitionArn')
log "A6: Registered task definition — $TD_ARN"
audit_step "A6_task_definition" "created" "$TD_ARN"

# =============================================================
# Write env var block for .env.local
# =============================================================
ENV_BLOCK="
# ECS Agent Runner (provisioned ${TIMESTAMP})
ECS_CLUSTER_NAME=${CLUSTER_NAME}
AGENT_RUNNER_SG_ID=${AGENT_SG_ID}
ECS_SUBNET_IDS=${SUBNET_1A},${SUBNET_1B}
ECS_SECURITY_GROUP_IDS=${AGENT_SG_ID}
ECS_EXECUTION_ROLE_ARN=${EXECUTION_ROLE_ARN}
ECS_TASK_ROLE_ARN=${TASK_ROLE_ARN}
AGENT_BASE_IMAGE=${IMAGE_URI}
"

ENV_OUT_FILE="${AUDIT_DIR}/env-block-${TIMESTAMP}.txt"
echo "$ENV_BLOCK" > "$ENV_OUT_FILE"
audit_step "env_block" "written" "$ENV_OUT_FILE"

# =============================================================
# Write audit log
# =============================================================
AUDIT_FINAL=$(echo "$AUDIT" | jq \
  --arg ts "$TIMESTAMP" \
  --arg account "$ACCOUNT_ID" \
  --arg region "$REGION" \
  --arg cluster "$CLUSTER_ARN" \
  --arg ecr "$ECR_URI" \
  --arg sg "$AGENT_SG_ID" \
  --arg td "$TD_ARN" \
  '. + {
    "_meta": {
      "timestamp": $ts,
      "account_id": $account,
      "region": $region,
      "provisioned_by": "provision-aloft-agents.sh"
    },
    "_outputs": {
      "cluster_arn": $cluster,
      "ecr_uri": $ecr,
      "agent_runner_sg_id": $sg,
      "task_definition_arn": $td
    }
  }')

echo "$AUDIT_FINAL" > "$AUDIT_FILE"

log "=================================================="
log "Provisioning complete."
log "Audit log: $AUDIT_FILE"
log "Env block:  $ENV_OUT_FILE"
log ""
log "Next steps:"
log "  1. Copy the env block into .env.local"
log "  2. Build and push the Docker image:"
log "     cd agent-runner && bash build-and-push.sh"
log "  3. Add the audit log to git:"
log "     git add scripts/infra/audit/ && git commit -m 'infra: provision aloft-agents-prod'"
log "=================================================="

# =============================================================
# Emit outputs for agent/CI consumption
# =============================================================
echo ""
echo "PROVISION_OUTPUTS:"
echo "CLUSTER_ARN=${CLUSTER_ARN}"
echo "ECR_URI=${ECR_URI}"
echo "AGENT_RUNNER_SG_ID=${AGENT_SG_ID}"
echo "TASK_DEFINITION_ARN=${TD_ARN}"
