# Stadium Wrangler iOS submission checklist

## Release configuration

- Display name: Stadium Wrangler
- Bundle ID: `com.stadiumwrangler.app`
- App Store Connect app ID: create a new record for this bundle ID, then add its Apple ID to `eas.json` before submitting.
- EAS project ID: `eb8d41ff-6e88-48cf-a75a-d4399e442c28`
- Production API: `https://stadium-wrangler-api-c57mm72zpa-ue.a.run.app/api`
- EAS uses remote build-number management with automatic production increments.

## Before first TestFlight submission

1. In App Store Connect, confirm the bundle ID matches `com.venuewrangler.app` and add the Stadium Wrangler display name.
2. Add a public support URL and privacy-policy URL. Do not submit until both are live.
3. Complete App Privacy details for account data, contact information, location used for on-site clock verification, user-generated photos/documents, and diagnostics if enabled.
4. Provide 6.7-inch and 6.5-inch iPhone screenshots from the production build. Include the sign-in, event command center, F&B Ops, and live issues flows.
5. Provide reviewer credentials for the all-access test account through App Store Connect's review-notes field; never place credentials in repository files or screenshots.
6. Verify the Apple Developer team, signing certificate, and provisioning profile using `npx eas-cli@latest credentials -p ios`.

## Build and submit

```powershell
npx expo-doctor
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios --profile production
```

Use TestFlight for the controlled pilot first. Submit the same approved build to App Review only after pilot sign-off.
