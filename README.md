# todoist-notion-sync

A production-ready, one-way sync from Todoist to Notion — runs automatically every 30 minutes on GitHub Actions, for free.

Todoist stays your source of truth for task execution. Notion becomes a searchable archive, reporting layer, and long-term history. The sync **never writes back to Todoist**.

---

## How It Works

```
Todoist (source of truth)
        │
        ▼
Todoist Sync API  ──►  Incremental state stored in Notion
        │
        ▼
  Change detection via Sync Hash (unchanged tasks are skipped)
        │
        ▼
Notion task databases (Work + Personal)
```

Each top-level Todoist task becomes one Notion database row. Subtasks, comments, and image attachments are rendered inside the task page — not as separate rows.

---

## Features

- Syncs `Work` and `Personal` Todoist projects into separate Notion databases
- One Notion row per top-level Todoist task
- Subtasks rendered recursively as collapsible Notion toggles inside the parent page
- Comments synced with timestamps; subtask comments placed inside their toggle
- Image attachments uploaded directly into Notion so they render inline
- Non-image attachments (PDFs, spreadsheets, etc.) shown as clickable links
- Completed tasks marked `Completed` with a timestamp; never deleted
- Deleted tasks marked `Deleted`; archive rows are preserved
- Incremental sync via Todoist Sync API — unchanged pages are skipped entirely
- Retry logic with exponential backoff and `Retry-After` header support
- Structured JSON logging via pino
- Runs on GitHub Actions on a 30-minute schedule, no server required

---

## What Gets Synced

| Todoist field | Notion property |
|---|---|
| Task title | `Task` (title) |
| Task ID | `Todoist ID` (text) |
| Labels | `Labels` (multi-select) |
| Priority | `Priority` (select) |
| Due date | `Due Date` (date) |
| Description | `Description` (text) + page body |
| Created timestamp | `Created Date` (date) |
| Updated timestamp | `Last Updated` (date) |
| Completion | `Status = Completed`, `Completed Date` |
| Deletion | `Status = Deleted` |
| Comments | Page body under `Comments` heading |
| Subtask comments | Inside matching subtask toggle |
| Image attachments | Uploaded to Notion, rendered inline |
| Non-image attachments | Clickable link in page body |
| Subtasks | Recursive toggles inside parent page |

---

## Page Layout

Each Notion task page is generated and rebuilt when Todoist data changes:

```
Description
─────────────────────────────────────
Task description text here.

Comments
─────────────────────────────────────
Comment · 23 Jun 2026, 12:46 pm
This is a comment from Todoist.
[image]

Subtasks
─────────────────────────────────────
▸ ☐ Fix login bug  |  due 2026-06-25  |  High
▸ ✓ Write unit tests
```

> **Note:** Do not manually edit generated sections of a page. The next sync will overwrite them.

---

## Priority Mapping

| Todoist | Notion |
|---|---|
| P1 | Critical |
| P2 | High |
| P3 | Medium |
| P4 / unset | Low |

Low priority is intentionally hidden from subtask toggle titles to reduce visual noise.

---

## Requirements

- Node.js 22+
- A Todoist account with API access
- A Notion workspace with an internal integration
- A GitHub repository with Actions enabled (for automated deployment)

---

## Setup Guide

Follow these steps in order. Each step is required before the next one will work.

### Step 1 — Create a Notion integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration**
3. Give it a name (e.g. `Todoist Sync`) and select your workspace
4. Leave the type as **Internal**
5. Click **Save** and copy the **Internal Integration Secret**

This secret is your `NOTION_API_TOKEN`. Keep it private.

---

### Step 2 — Create the Work and Personal task databases

Create **two separate Notion databases** — one for Work tasks and one for Personal tasks.

Each database must have **exactly** these properties with **exactly** these names and types:

| Property name | Type | Notes |
|---|---|---|
| `Task` | Title | Rename the default `Name` column to `Task` |
| `Todoist ID` | Text | Used for idempotency — do not edit values |
| `Status` | Select | Add options: `Active`, `Completed`, `Deleted` |
| `Labels` | Multi-select | Options are created automatically |
| `Priority` | Select | Add options: `Critical`, `High`, `Medium`, `Low` |
| `Due Date` | Date | — |
| `Created Date` | Date | — |
| `Completed Date` | Date | — |
| `Last Updated` | Date | — |
| `Last Synced` | Date | — |
| `Description` | Text | — |
| `Source` | Select | Add option: `Todoist` |
| `Sync Hash` | Text | Used to skip unchanged pages — do not edit values |

**To get the database ID:**
Open the database as a full page in Notion. The URL looks like:
```
https://www.notion.so/your-workspace/abc123def456...?v=...
```
The 32-character string before the `?` is the database ID.

**Share both databases with your integration:**
- Open the database → click `...` (top right) → **Connections** → search for your integration → connect it

---

### Step 3 — Create the Sync State database

Create one more Notion database called (e.g.) `Todoist Sync State`.

It needs only two properties:

| Property name | Type | Notes |
|---|---|---|
| `Key` | Title | Rename the default `Name` column to `Key` |
| `Updated At` | Date | Updated automatically by the app |

Share this database with your integration the same way as above.

Copy its database ID — this is your `SYNC_STATE_DATABASE_ID`.

> **Why this exists:** This database stores the Todoist Sync API token between runs. It enables incremental sync — only tasks that changed since the last run are processed. Without it, the app falls back to a slower full REST sync on every run. It is strongly recommended.

> **Do not edit or delete the row** that the app creates inside this database.

---

### Step 4 — Set up Todoist

Make sure you have two projects in Todoist with **exactly** these names (case-sensitive):

```
Work
Personal
```

Get your Todoist API token:
```
Todoist → Settings → Integrations → Developer → API token
```

---

### Step 5 — Configure environment variables

For **GitHub Actions deployment** (recommended), add these as repository secrets:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

| Secret name | Required | Description |
|---|---|---|
| `TODOIST_API_TOKEN` | Yes | Your Todoist API token |
| `NOTION_API_TOKEN` | Yes | Your Notion integration secret |
| `WORK_DATABASE_ID` | Yes | Notion database ID for Work tasks |
| `PERSONAL_DATABASE_ID` | Yes | Notion database ID for Personal tasks |
| `SYNC_STATE_DATABASE_ID` | Recommended | Notion database ID for sync state |

Paste only the value — no quotes, no `KEY=` prefix.

For **local development**, copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Optional variables (with defaults):

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`) |
| `COMPLETED_LOOKBACK_DAYS` | `90` | Days back to fetch completed tasks (REST fallback only) |
| `DISPLAY_TIME_ZONE` | `Asia/Kolkata` | IANA timezone for comment timestamps in Notion |
| `MAX_IMAGE_UPLOAD_BYTES` | `5242880` | Max image upload size in bytes (default 5 MB) |

Find your IANA timezone name at [https://en.wikipedia.org/wiki/List_of_tz_database_time_zones](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

---

### Step 6 — Deploy to GitHub Actions

The workflow file is already included at `.github/workflows/sync.yml`. It runs every 30 minutes automatically.

**Run it manually once first to confirm everything is working:**

```
Actions → Sync Todoist to Notion → Run workflow → Run workflow
```

Check the logs. A successful first run will:
- Create rows in your Work and Personal databases for all existing tasks
- Create a row in the Sync State database
- Print a summary like `todoist to notion sync finished` with created/updated/skipped counts

After that, scheduled runs will pick up changes incrementally.

---

## Local Development

```bash
# Install dependencies
npm install

# Run sync
npm run sync

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

---

## Sync Behavior Reference

### Creates
A new Notion page is created when a Todoist top-level task has no matching row in the database.

### Updates
An existing Notion page is updated **only when its Sync Hash changes** — i.e. when the task content, comments, attachments, due date, labels, priority, or status has changed. Unchanged pages are skipped entirely.

### Completes
When a task is marked complete in Todoist:
```
Status        → Completed
Completed Date → Todoist completion timestamp
```

### Deletes
When a task is deleted in Todoist, it is **not deleted from Notion**. It is marked:
```
Status → Deleted
```
This preserves your archive.

### Subtasks
Subtasks do not become Notion database rows. They are rendered as recursive collapsible toggles inside the parent task's page body.

### Comments
- Top-level task comments appear under the `Comments` heading on the page
- Subtask comments appear inside the matching subtask toggle
- Comment timestamps are formatted in the configured `DISPLAY_TIME_ZONE`

### Image Attachments
Image attachments from Todoist comments are downloaded and uploaded into Notion so they render inline below the comment. If the upload fails (e.g. size limit exceeded), the original source link is kept instead and a warning is logged.

### Non-image Attachments
PDFs, spreadsheets, and other non-image files appear as a clickable filename link below the related comment.

---

## Troubleshooting

### `Could not find database with ID`
The database has not been shared with your Notion integration, or the database ID is wrong.

**Fix:**
- Open the database in Notion
- Click `...` → **Connections** → connect your integration
- Confirm the ID in your secrets/`.env` matches the URL

### `Task is not a property that exists`
The title column in your Notion database is not named `Task`.

**Fix:** Rename the default `Name` column to `Task`.

### `Request failed with status code 401`
The Todoist API token is wrong, expired, or was pasted with extra whitespace.

**Fix:** Regenerate the token in Todoist settings and update the secret.

### `Request failed with status code 403`
The Notion integration does not have access to the database.

**Fix:** Share the database with the integration (see Step 2).

### Workflow says dependency lock file is missing
`actions/setup-node` with `cache: npm` requires a `package-lock.json`.

**Fix:** Either remove `cache: npm` from the workflow, or run `npm install` locally to generate a lockfile and commit it.

### Scheduled workflow does not run at exactly `:00` or `:30`
This is expected behaviour. GitHub scheduled workflows are best-effort and may be delayed during busy periods. The sync is idempotent — a delayed or missed run has no permanent effect.

### Image does not appear in Notion
Check that:
- The image is attached to a Todoist comment (not just pasted inline)
- The task is in a synced project (`Work` or `Personal`)
- The image is under `MAX_IMAGE_UPLOAD_BYTES`
- The GitHub Actions log does not show an image upload warning for that task

### Subtask comment image is missing
Subtask comments are inside collapsible toggles. Expand the matching subtask toggle in Notion.

### A task is not appearing in Notion
Check that:
- The task is a **top-level task** (subtasks do not become rows)
- The task is in a project named exactly `Work` or `Personal`
- The GitHub Actions run for that sync period did not fail

---

## Security

- **Never commit `.env`** — it is in `.gitignore` by default; verify this before your first push
- **Never share API tokens** in issues, screenshots, or chat logs
- If a token is accidentally exposed, rotate it immediately in Todoist/Notion and update the secret
- Use GitHub repository secrets for all deployments — never hardcode tokens
- The sync is strictly one-way and never writes to Todoist

---

## Known Limitations

- Project names `Work` and `Personal` are hardcoded. To use different names, edit `src/types/domain.ts` and `src/config/projects.ts`
- GitHub scheduled workflows are not exact timers — delays of a few minutes are normal
- Notion file uploads have workspace-level size limits independent of `MAX_IMAGE_UPLOAD_BYTES`
- Very large images (multi-part upload) are not supported — files above the limit fall back to a source link
- Generated page body sections are fully replaced on each update — manual edits to those sections will be overwritten

---

## License

MIT
