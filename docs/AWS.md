# AWS Deploy — us-west-1

App Runner is **not** available in `us-west-1`, so this project uses:

| Piece | Service |
|--------|---------|
| API + UI | **Elastic Beanstalk** (`deskline-api`) — Node.js 22, serves `/api` and built React `public/` |
| Database | **RDS PostgreSQL** `deskline-db` (private in VPC) |

## Live URLs

- App (HTTPS): https://fivewitsit.com/ (also https://www.fivewitsit.com/)
- Health: https://fivewitsit.com/api/health
- EB origin (direct): http://deskline-api.eba-mvmn7bx3.us-west-1.elasticbeanstalk.com/
- Demo login: `agent@deskline.local` / `deskline123`

Domain routing: Route 53 → CloudFront (`ETXO3AVE1QZVA` / `d1wyd7glme77ue.cloudfront.net`) → EB. ACM cert in `us-east-1` covers apex + `www`.

## Resources

| Resource | Value |
|----------|--------|
| Region | `us-west-1` |
| EB app / env | `deskline` / `deskline-api` |
| RDS endpoint | `deskline-db.c56kyms4smvb.us-west-1.rds.amazonaws.com:5432` |
| DB name / user | `helpdesk` / `deskline` |
| VPC | `vpc-0752813896de17b19` |
| RDS SG | `sg-0d52a681827b9e113` (5432 from VPC CIDR) |
| DB password | `.deploy-db-pass.tmp` (local only, gitignored) |

## Redeploy API+UI

```bash
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"
export REGION=us-west-1
ACCOUNT=895734792322
BUCKET="elasticbeanstalk-${REGION}-${ACCOUNT}"

cd client && VITE_API_URL="" npm run build
rm -rf ../server/public && mkdir -p ../server/public && cp -R dist/* ../server/public/

cd ../server
zip -qr /tmp/deskline-api.zip . -x '*.db' -x 'data/*' -x '*.bak' -x 'node_modules/*'
aws s3 cp /tmp/deskline-api.zip "s3://${BUCKET}/deskline/deskline-api.zip" --region $REGION
LABEL="v$(date +%s)"
aws elasticbeanstalk create-application-version --region $REGION \
  --application-name deskline --version-label "$LABEL" \
  --source-bundle S3Bucket="$BUCKET",S3Key="deskline/deskline-api.zip"
aws elasticbeanstalk update-environment --region $REGION \
  --environment-name deskline-api --version-label "$LABEL"
```

## Migrate local SQLite → RDS

RDS is **not** publicly accessible. Options:

1. Temporarily set RDS publicly accessible, open SG to your IP, run `scripts/migrate-sqlite-to-postgres.sh`, then lock again.
2. Run the migrate script from a host inside the VPC (EB instance / bastion).

```bash
export DATABASE_URL="postgres://deskline:PASSWORD@deskline-db.c56kyms4smvb.us-west-1.rds.amazonaws.com:5432/helpdesk"
export PGSSL=true
./scripts/migrate-sqlite-to-postgres.sh
```

Cloud RDS currently has the **seed demo data** from first boot (not your local SQLite copy), unless you migrate.

## Local development

Unchanged: leave `DATABASE_URL` unset → SQLite at `server/data/helpdesk.db`.
