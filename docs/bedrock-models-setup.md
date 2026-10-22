# Bedrock models setup (GPT-6 Luna, Claude Sonnet 5.5, Opus 5.5)

Use this to enable the three models in **AWS** and in **ALOFT D360** (Inspector / Agent Lab). No Azure Foundry required for these three when Mantle + Converse are configured.

---

## 1. AWS Console (once per account)

1. Sign in to **AWS Console** → **Amazon Bedrock** → **Model access** (or **Model catalog**).
2. Request access / enable:
   - **Anthropic** — Claude Sonnet 5.5, Claude Opus 5.5
   - **OpenAI** — GPT-6 Luna (if shown under Bedrock model catalog)
3. **Bedrock API key** (for Mantle / OpenAI path): Bedrock → **API keys** → create key → copy once.

**IAM** (EC2/Beanstalk instance role or your dev IAM user) needs at least:

- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:Converse`
- `bedrock:ConverseStream`

on the inference profiles you use (often `us-east-1`).

---

## 2. Model IDs (what the app uses)

| UI key | Provider | Model ID | Region notes |
|--------|----------|----------|----------------|
| `sonnet-5-5` | Bedrock **Converse** | `us.anthropic.claude-sonnet-5-5` | `BEDROCK_REGION=us-east-1` (or region where enabled) |
| `opus-5-5` | Bedrock **Converse** | `us.anthropic.claude-opus-5-5` | Same |
| `gpt-6-luna` | Bedrock **Mantle** (OpenAI API) | `openai.gpt-6-luna` | **`BEDROCK_MANTLE_REGION=us-east-1`** (N. Virginia) |

Optional global IDs (if your account uses global inference): `global.anthropic.claude-sonnet-5-5`, `global.anthropic.claude-opus-5-5`, `global.openai.gpt-6-luna` on **bedrock-runtime** — ALOFT defaults to **US geo** IDs above.

---

## 3. Environment variables (copy to `.env` / Beanstalk)

```env
# Claude 5.5 via Converse
AWS_REGION=ap-south-1
BEDROCK_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Background jobs (Marcus, FOER, reflect) — optional override
BEDROCK_SONNET_MODEL_ID=us.anthropic.claude-sonnet-5-5

# GPT-6 Luna via Mantle (not Foundry)
BEDROCK_MANTLE_REGION=us-east-1
BEDROCK_MANTLE_API_KEY=<Bedrock API key from console>

# Default Inspector model when XAI is not preferred
INSPECTOR_DEFAULT_MODEL=sonnet-5-5
```

**Common mistake:** Luna on Mantle is **`us-east-1`**, not `us-east-2` (Terra/other models may use other regions).

---

## 4. Verify from your machine

**Claude (Converse)** — needs AWS credentials + `BEDROCK_REGION`:

```powershell
aws bedrock-runtime converse --region us-east-1 --model-id us.anthropic.claude-sonnet-5-5 --messages "[{role=user,content=[{text=Say OK}]}]" --inference-config maxTokens=32
```

**Luna (Mantle)** — OpenAI-compatible endpoint:

```text
POST https://bedrock-mantle.us-east-1.api.aws/openai/v1/chat/completions
Authorization: Bearer <BEDROCK_MANTLE_API_KEY>
Body: { "model": "openai.gpt-6-luna", "messages": [{"role":"user","content":"Say OK"}] }
```

---

## 5. In the app

1. Restart `next dev` or redeploy Beanstalk after env changes.
2. **Inspector** → model picker: **Claude Sonnet 5.5**, **Claude Opus 5.5**, **GPT-6 Luna**.
3. If Luna fails with 401, rotate **Bedrock API key** (`BEDROCK_MANTLE_API_KEY`).
4. If Claude fails with access denied, enable models in console and check IAM + `BEDROCK_REGION`.

---

## 6. Teammate checklist

- [ ] Model access enabled in Bedrock console  
- [ ] IAM allows Converse + Invoke in `us-east-1`  
- [ ] `BEDROCK_REGION=us-east-1`  
- [ ] `BEDROCK_MANTLE_REGION=us-east-1` + valid `BEDROCK_MANTLE_API_KEY` for Luna  
- [ ] `INSPECTOR_DEFAULT_MODEL=sonnet-5-5` (optional)  
- [ ] Smoke test each model from Inspector  

**Related:** [external-apis-and-providers.md](./external-apis-and-providers.md), [ops-failure-log.md](./ops-failure-log.md) (F-001 / F-002)
