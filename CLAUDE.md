This project uses an Expo Router mobile app with a NestJS API, Prisma, and
PostgreSQL on Supabase, deployed to Google Cloud Run.

Venue Wrangler ships as an enterprise licence: venue access is granted by
contract, not sold self-serve. There is no trial period and no in-app
checkout. Registration writes an active, zero-price `enterprise_licensed`
subscription — do not reintroduce Stripe checkout, trial windows, or per-venue
pricing.

Venue and Facility are the same tenant under two names: `Venue.id` and
`Facility.id` are deliberately the same UUID, and `scope.venueId` is passed
straight into `facilityId` columns by the stadium and VMS modules. Anything
that creates a Venue must create the paired Facility (see
`packages/api/src/common/venue-facility.ts`).

Backend code lives in `packages/api`. Prefer the existing REST API, Prisma
models, and React Query helpers in `lib/railway-hooks.ts` when adding or
modifying data-backed app features. (The `railway-*` filenames predate the
move off Railway and are kept as-is to avoid churn across the app.)
