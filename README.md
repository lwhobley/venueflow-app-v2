# Venue Wrangler

Venue Wrangler is a native iOS/Android venue ops app built with Expo Router, NestJS, and Prisma.

## Role model

- Admin/owner/manager: full visibility and edit access for schedule, floor plan, staff, requests, and live operations
- Staff: read-only floor/schedule visibility, personal time clock punching, own hours, and request flows

## What works now

- NestJS-backed auth bootstrap
- Venue assignment
- Precise GPS geofenced clock-in and clock-out
- Manager/admin live clock board
- Weekly schedule calendar
- Staff request flows for add/drop shifts, time off, and two-week availability
- Floor plan and table management with drag-and-drop editor for admins/managers
- Staff management screen for admins/managers to add people and assign roles to a venue
- Profile page shortcut to open staff management for privileged roles
- Enterprise licensing (consumer Stripe/RevenueCat checkout is disabled; venues are provisioned as licensed)

## Local setup

1. `npm install` (`.npmrc` already sets `legacy-peer-deps=true`, so no extra flag is needed).
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your local NestJS server endpoint (e.g. `http://localhost:4000/api`).
3. Set up the local NestJS server inside `packages/api` (see `packages/api/README.md`).
4. In another terminal: `npm start` (Expo).
5. Test the sign-in flow, geofenced clock actions, and role-specific screens.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | NestJS API endpoint the client connects to | required |
| `EXPO_PUBLIC_BILLING_ENABLED` | Enables the subscription gate. Keep `false` until Stripe billing or RevenueCat in-app purchase is active. | `false` |

## Quality gates

- `npm run typecheck` — strict TypeScript, must be clean.
- `npm test` — full Vitest unit suite (geofence anti-fraud rules, authorization role checks, billing state mapping). Generates the Prisma client first, which the API specs need.
- `npm run test:ui` — app-only subset (`components/`, `lib/`, and the site, scripts and Metro specs). Skips the API package, so it runs without a generated Prisma client.

## Production deploy

1. **Deploy the NestJS Backend** (for example, to Google Cloud Run):
   - Set `DATABASE_URL` to the Supabase pooler connection, `DATABASE_DIRECT_URL` when available, and `JWT_SECRET` in the service configuration.
   - Set `CORS_ORIGINS` to explicit web origins such as `https://venuewrangler.com,https://www.venuewrangler.com`; do not use `*` with credentialed CORS.
2. **Point the build at prod**: set `EXPO_PUBLIC_API_URL` in `eas.json` to the deployed server URL. Also set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (iOS in-app purchases).
3. **Build & submit**:
   - `eas build -p ios --profile production`
   - `eas build -p android --profile production`
   - `eas submit -p ios --profile production`
   - `eas submit -p android --profile production`

> Auth: run `eas login` for local builds. For CI, set `EXPO_ACCESS_TOKEN` as a
> CI/environment secret — never commit it to `eas.json` (this repo is public).

## Backend

- NestJS server backed by Prisma and PostgreSQL on Supabase, deployed to Cloud Run
- Push notifications registered via `POST /v1/push/token` and stored in the database

## Floor sync

- Seed a sample floor plan from the Floor Editor if you need demo tables
- Admin/manager can save and publish floor changes
- Staff can view the floor but cannot edit it
