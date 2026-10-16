# Production deployment

`deploy-production.yml` runs on every push to `main`: it migrates PostgreSQL and verifies pgvector plus the research tables. Vercel's existing Git integration owns deployment.

Set this GitHub Actions secret before the first push:

- `DATABASE_URL` — the production PostgreSQL connection string.

Set `DATABASE_URL` and `OPENAI_API_KEY` in Vercel too. They are application runtime secrets; the workflow only needs the database URL to migrate.

The existing Vercel Git integration deploys each push. The workflow deliberately does not need Vercel credentials or alter that deployment setup.
