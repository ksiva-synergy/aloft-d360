# Knowledge bases: setup

How to switch on knowledge bases (Memory → Knowledge) in an environment: the database change, the S3 bucket, permissions and settings. Phase 1 covers personal and organisation knowledge bases. Teams (Phase 2) and connection folders (Phase 3) come later.

## 1. Apply the database migration

`prisma/migrations/20261028_knowledge_phase0/migration.sql` is additive: it adds columns and tables and drops nothing. Apply it with the usual migration process for the environment. Until it is applied, the Knowledge page shows load errors. Automate and agents carry on without knowledge.

## 2. Create the bucket

Create one bucket per environment in the same AWS account as the app, for example `aloft-knowledge-dev` and `aloft-knowledge-prod`, in the app's region (ap-south-1).

| Setting | Value | Why |
|---|---|---|
| Block all public access | On (all four) | Files are only ever read through the app, which checks access first. |
| Object ownership | Bucket owner enforced (ACLs off) | No per-object ACLs to manage. |
| Default encryption | SSE-S3 (AES-256) | The app also asks for AES-256 on every upload. |
| Versioning | Off | The app keeps every version of a document as its own object (see the layout). With versioning on, files the app deletes stay billable and recoverable. If policy requires it, add a lifecycle rule that expires noncurrent versions after 30 days. |
| Lifecycle | Abort incomplete multipart uploads after 7 days | Housekeeping. |

### Folder layout

```
knowledge/                                  KNOWLEDGE_BUCKET_PREFIX
  <organisation id>/
    <knowledge base id>/                    everything of one knowledge base
      <document id>/                        one document, all its versions
        v1/SMS-Manual-rev-7.pdf
        v2/SMS-Manual-rev-8.pdf             a changed file → a new version folder
```

- **One prefix per knowledge base.** Copying, backing up, measuring or deleting a knowledge base is one prefix operation. The app deletes `knowledge/<org>/<kb>/` when a knowledge base is deleted, and `…/<document id>/` when a document is deleted.
- **One folder per version.** A new upload never overwrites the file that the previous version's search pieces and citations came from.
- **Readable file names:** the original name, made safe. Accents are removed, other characters become `-`, and path parts are dropped. The original name, including its folder when a folder was uploaded, is kept in the database and in the object's metadata.
- **Object metadata** on every file: `knowledge-base`, `document`, `version`, `sha256`, `uploaded-by` and `original-name`. Anyone looking in the console can tell what a file is without the database.

The ids are database ids on purpose. Names change; ids do not. The Knowledge page and the database map them to names.

## 3. Give the app access

Attach this to the ECS task role (and to the role used for local development, if it is different). Replace the bucket name.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "KnowledgeFiles",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::aloft-knowledge-dev/knowledge/*"
    },
    {
      "Sid": "KnowledgeList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::aloft-knowledge-dev",
      "Condition": { "StringLike": { "s3:prefix": ["knowledge/*"] } }
    }
  ]
}
```

Embedding uses Amazon Titan through Bedrock (`bedrock:InvokeModel` on `amazon.titan-embed-text-v2:0`), which the role already needs for search. OCR goes through ALOFT's LiteLLM gateway (`llmlite_base_url` / `llmlite_api_key`), which is already configured.

## 4. Settings

| Variable | Default | Meaning |
|---|---|---|
| `KNOWLEDGE_BUCKET` | none | The bucket. Without it, uploads are refused with a clear message and the page says so. Q&A written in the app still works. |
| `KNOWLEDGE_BUCKET_REGION` | `AWS_REGION`, else ap-south-1 | The bucket's region. |
| `KNOWLEDGE_BUCKET_PREFIX` | `knowledge` | Top folder in the bucket. |
| `KNOWLEDGE_MAX_UPLOAD_MB` | 50 (1–200) | Largest file. If a proxy sits in front of the app, its body limit must be at least this. |
| `KNOWLEDGE_MAX_DOCUMENTS` | 2000 | Documents per knowledge base. |
| `KNOWLEDGE_MAX_PERSONAL` | 20 | Personal knowledge bases per person (archived ones do not count). |
| `KNOWLEDGE_EMBED_REGION` | us-east-1 | Where Titan is called. |
| `KNOWLEDGE_OCR_BATCH_PAGES` | 30 | Scanned pages per OCR request. |
| `KNOWLEDGE_OCR_CONCURRENCY` | 2 | OCR requests at once. |

## 5. Check it works

1. Open Memory → Knowledge, create a personal knowledge base and add a digital PDF, a scanned PDF and a Word file.
2. Each shows *Waiting*, then *Reading*, then *Ready*. A scanned page that OCR cannot read shows as "Ready, n pages unread" with the page numbers.
3. In the console, the files are under `knowledge/<org>/<kb>/<document>/v1/`.
4. **Try a search:** ask something the files answer. The answer shows the document, page and section.
5. **Agents tab:** add a saved agent, then ask it the same question in agent chat. It cites (document, page).
6. **Automate:** add a *Search knowledge* step, tick the knowledge base and use *Try it*.

## Who can do what

| | Personal | Organisation |
|---|---|---|
| See and search | The owner (and platform admins) | Everyone in the organisation |
| Add or remove files and Q&A, rename, link agents | The owner | Admins |
| Create | Anyone | Admins |
| Share with the organisation, or make personal again | Admins | Admins |
| Archive (stops all search, deletes nothing), restore | The owner | Admins |
| Delete for good (archived only) | The owner | Admins |

An agent linked to a knowledge base searches it only for people who may see it. A personal knowledge base linked to a shared agent never answers anyone but its owner.

## What happens to a file

1. **Upload:** one request per file. The type is checked from the bytes, not the name. A file that is the same as the current version is reported as *unchanged* and nothing is stored. A changed file becomes a new version, and the old version stays searchable until the new one is ready.
2. **Reading:** a background job in the app picks it up and survives restarts.
   - Digital PDF pages are read with pdf-inspector; scanned pages and images go to Mistral OCR in batches of 30.
   - Word, Excel, CSV, PowerPoint, text and Markdown are read directly.
   - The text is split along headings and numbered clauses, never across a page.
3. **Embedding:** Titan, reusing the vectors of unchanged pieces.
4. **Ready:** the pieces become searchable in one step, and older versions are retired.
   - Temporary failures retry on their own (after 1, 2 and 4 minutes, up to 60).
   - A permanent failure shows the reason, with Retry.
