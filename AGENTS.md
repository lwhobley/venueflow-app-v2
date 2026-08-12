This project uses an Expo Router mobile app with a NestJS API, Prisma, and
PostgreSQL on Supabase, with the API deployed to Google Cloud Run.

Backend code lives in `packages/api`. Prefer the existing REST API, Prisma
models, and React Query helpers in `lib/railway-hooks.ts` (the filename is
legacy) when adding or
modifying data-backed app features.

### BRANCH ISOLATION RULES
- The `desktop-web` branch is a persistent, standalone branch dedicated exclusively for desktop browser access and testing.
- **CRITICAL**: The `desktop-web` branch must NEVER be merged into `main`.

