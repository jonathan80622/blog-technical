# Production deployment

`deploy-production.yml` runs on every push to `main`: it migrates PostgreSQL, verifies pgvector and the research tables, then deploys to Vercel.

Set these GitHub Actions secrets before the first push:

- `DATABASE_URL` — the production PostgreSQL connection string.
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` — the Vercel CLI deployment credentials.

Set `DATABASE_URL` and `OPENAI_API_KEY` in Vercel too. They are application runtime secrets; the workflow only needs the database URL to migrate.

Use this workflow as the production deployment owner. If the Vercel project is also connected for automatic Git deployments, disable automatic production deployment there to prevent Vercel racing the migration step.
