# Fargate renderer deployment

Build the renderer from `renderer/`, push it to private ECR, resolve its digest, then deploy `fargate-renderer.yaml`. Pass `ImageUri` as `ACCOUNT.dkr.ecr.REGION.amazonaws.com/vc-intelligence-renderer@sha256:...`; never deploy a mutable tag.

The API Gateway method is AWS_IAM protected and starts one Fargate task. It is not browser-facing. Vercel issues a random, ten-minute render token, stores only its SHA-256 hash in Prisma Postgres, then submits `{ "jobId": "persisted-job-id", "token": "one-time-secret" }` to `POST /v1/render`.

The task has no inbound listener. It runs in public subnets solely to avoid a NAT Gateway's fixed cost; its security group has no ingress rules and only outbound HTTPS. It receives only the job ID and short-lived token. It redeems them over HTTPS from Vercel for a source URL and allowed-domain policy, blocks localhost/private addresses and off-policy subresources, writes rendered HTML, normalized text, and telemetry to the private S3 `raw/` prefix, then posts artifact metadata back to Vercel. The task never receives a database credential and cannot write database rows directly.

Before deployment, resolve the Node base image to an approved digest in CI and create a committed npm lockfile for `renderer/`. The pinned Playwright package is 1.64.0; its browser runtime must match that version.
