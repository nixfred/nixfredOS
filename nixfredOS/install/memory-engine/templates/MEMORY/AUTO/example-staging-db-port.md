---
name: example-staging-db-port
description: FAKE EXAMPLE project memory. The staging database for the demo app listens on port 5433. Delete me.
metadata:
  type: project
---

EXAMPLE ONLY. The demo app's staging Postgres moved from 5432 to 5433 on 2030-01-15 (use absolute dates, never "last week").

**Why:** 5432 clashed with a local dev database.
**How to apply:** connection strings for staging use 5433.
