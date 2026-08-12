# Security dependency exceptions

## Metro `image-size` denial of service advisories

As of 2026-08-12, `npm audit --omit=dev --audit-level=high` reports GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq through Expo/Metro's transitive `image-size` dependency. The registry offers no non-breaking patched dependency chain; the suggested forced fix downgrades React Native from 0.86 to 0.72 and is not compatible with this Expo SDK.

Exposure is limited to developer/build-time processing of repository assets. Production clients do not invoke Metro or parse user uploads with `image-size`. Until Expo/Metro ships a patched chain, do not add untrusted ICNS, JXL, HEIF, or HEIC files to the repository or build context. Re-run the audit on every dependency update and remove this exception as soon as a compatible patched release is available.
