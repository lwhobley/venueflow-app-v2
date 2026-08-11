# Stadium F&B database cutover

The stadium deployment uses a new, empty Supabase project. The NestJS API remains the only application data gateway; the Expo app continues to call the existing REST API and must never receive a Supabase service-role key.

## Target

- Supabase project ref: `pxpsjjlrghrtdsbwbbqe`
- Region: `ca-central-1`
- PostgreSQL: 17
- Initial state verified 2026-08-11: no public tables and no migrations

## Secrets

Configure these only in the API/Cloud Run secret environment:

```dotenv
DATABASE_URL="postgresql://postgres.pxpsjjlrghrtdsbwbbqe:<password>@<pooler-host>:5432/postgres?sslmode=require"
DATABASE_DIRECT_URL="postgresql://postgres:<password>@db.pxpsjjlrghrtdsbwbbqe.supabase.co:5432/postgres?sslmode=require"
EXPECTED_SUPABASE_PROJECT_REF="pxpsjjlrghrtdsbwbbqe"
```

Use the Supabase pooler URL for the running Cloud Run service. Use the direct URL for migrations when the deployment network supports it. Never commit either connection string or the database password.

The `service_role` key is not a database connection string and cannot run Prisma migrations. It must not be stored in Expo configuration, source control, EAS public variables, screenshots, or logs. Rotate any service-role key that has been pasted into chat before production use.

## Deployment sequence

1. Rotate the exposed service-role key in Supabase.
2. Copy the pooler and direct database connection strings from Supabase **Connect** and store them as Cloud Run secrets.
3. Set `EXPECTED_SUPABASE_PROJECT_REF=pxpsjjlrghrtdsbwbbqe`; the API safety check rejects any other remote database.
4. From a trusted release environment, run `npm run api:prisma:generate` and `npm run api:prisma:migrate:deploy`.
5. Run `npm run api:prisma:migrate:status` and confirm the full Prisma history, including `20260811120000_stadium_operations_foundation`, is applied.
6. Deploy a new Cloud Run revision with the new database variables but no traffic.
7. Smoke-test health, sign-in, venue membership, F&B overview, scheduling, inventory, documents, and event command endpoints.
8. Shift traffic to the new revision. Keep the old revision/database available for rollback until acceptance is complete.

Do not use `prisma db push` or apply only the final F&B migration to the empty project. The full migration history is required.

## Stadium F&B domain

The additive schema introduces:

- stadium event lifecycle, gates-open timing, attendance targets, and scan counts;
- concession stands, grab-and-go markets, portables, kiosks, commissaries, production kitchens, premium spaces, catering/banquet locations, bars, beverage carts, mobile pickup, retail-linked F&B, and partner pop-ups;
- per-event readiness for every F&B operating location;
- local/vendor partner type, status, contacts, revenue-share basis points, compliance expiry, and brand-standard notes.

Legacy restaurant-named tables remain temporarily for compatibility with existing REST workflows. New mobile work should use the stadium endpoints and F&B language; destructive table renames can follow only after old routes are retired.
