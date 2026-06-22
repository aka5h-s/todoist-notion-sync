# todoist-notion-sync

Production-ready one-way synchronization from Todoist to Notion.

Todoist remains the source of truth. Notion is used as a searchable archive and reporting layer. The sync never writes back to Todoist.

## What It Syncs

- Top-level Todoist tasks in the `Work` and `Personal` projects become Notion database rows.
- Subtasks are rendered recursively inside the parent task page under `Subtasks`.
- Comments are rendered under `Comments` with clean local timestamps.
- Comment attachments stay with the comment they belong to. Images are copied into Notion and rendered under the comment; PDFs, sheets, and other files stay as inline links under the comment.
- Deleted Todoist tasks are retained in Notion and marked `Deleted`.
- Completed tasks are marked `Completed` with `Completed Date`.

The page body is generated content. On each sync, the app updates database properties, archives the previous generated page body, and rebuilds:

```text
Description
Comments
Subtasks
Attachments
```

## Notion Database Schema

Create two Notion databases with these exact property names and types:

| Property | Type |
| --- | --- |
| Task | Title |
| Todoist ID | Text |
| Status | Select: Active, Completed, Deleted |
| Labels | Multi-select |
| Priority | Select: Critical, High, Medium, Low |
| Due Date | Date |
| Created Date | Date |
| Completed Date | Date |
| Last Updated | Date |
| Last Synced | Date |
| Description | Text |
| Source | Select: Todoist |

Share both databases with your Notion integration.

## Setup

```bash
npm install
cp .env.example .env
npm run typecheck
npm run lint
npm run sync
```

Fill `.env`:

```bash
TODOIST_API_TOKEN=
NOTION_API_TOKEN=
WORK_DATABASE_ID=387738608a7a80f9b509ceca8fab71e7
PERSONAL_DATABASE_ID=387738608a7a80d09234f5565a35d2c8
LOG_LEVEL=info
COMPLETED_LOOKBACK_DAYS=90
DISPLAY_TIME_ZONE=Asia/Kolkata
MAX_IMAGE_UPLOAD_BYTES=5242880
```

## GitHub Actions

The workflow at `.github/workflows/sync.yml` runs every 30 minutes:

```text
*/30 * * * *
```

Add these repository secrets:

- `TODOIST_API_TOKEN`
- `NOTION_API_TOKEN`
- `WORK_DATABASE_ID`
- `PERSONAL_DATABASE_ID`

The workflow uses `npm install` so it can run before a lockfile exists. After you run `npm install` locally and commit `package-lock.json`, you can switch that step to `npm ci` for stricter reproducible installs. GitHub scheduled workflows can be delayed under platform load, so treat the schedule as best-effort rather than exact wall-clock execution.

## API Notes And Limitations

- Todoist completed-task lookup by completion date is limited to a maximum three-month range. Keep `COMPLETED_LOOKBACK_DAYS` at `90` or lower.
- Todoist active-task APIs omit deleted tasks. This app marks a Notion row as `Deleted` when a previously synced `Active` top-level task no longer appears in Todoist active tasks or the recent completed-task feed.
- Comments for completed tasks may be unavailable depending on Todoist API behavior and account permissions. The sync logs a warning and continues.
- Comment timestamps are displayed using `DISPLAY_TIME_ZONE`.
- Todoist attachments are exposed as comment file metadata. Image attachments are downloaded from Todoist and uploaded directly to Notion when they are within `MAX_IMAGE_UPLOAD_BYTES`. PDFs, sheets, and other files are kept as source links under the related comment.
- Notion direct file uploads are subject to workspace limits. Free workspaces may reject files above 5 MiB; larger paid-workspace files can require multi-part upload, which this app intentionally avoids for now.
- Notion allows roughly three requests per second per connection and returns `429` or `529` with retry guidance. The app uses retries, exponential backoff, and `Retry-After` handling.
- Notion request payloads are limited, including 100 block children per append call and 2000 characters per rich text object. The app chunks generated blocks and long text.

## Maintenance

Useful commands:

```bash
npm run sync
npm run typecheck
npm run lint
npm run build
```

Logs are structured JSON via `pino`, suitable for GitHub Actions logs or forwarding to a log pipeline.
