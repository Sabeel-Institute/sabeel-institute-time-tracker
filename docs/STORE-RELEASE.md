# Store release: what the stores require, and how this app meets it

The decisions behind putting the Time Tracker through Apple's App Review (and,
when it comes, Google Play): no account creation in the phone apps, the privacy
policy, Sign in with Apple, export compliance, the privacy manifest and the App
Privacy answers. The iPhone build itself is `docs/IOS-BUILD.md`.

The shape is shared with the sibling apps: the Kanban
(`sabeel-institute-kanban/docs/STORE-RELEASE.md`, the original statement of
this design) and the LMS. Where this file and theirs agree, theirs has the
longer argument.

## 1. The rule: the phone apps never create an account

> **The iPhone and Android apps must never cause an account to come into
> existence.** Accounts are made on the website only.

Faisal's standing rule for every Sabeel app, applied here on 2026-10-15.

**Why.** Both stores require in-app account DELETION only if the app supports
account CREATION:

- **Apple 5.1.1(v):** "If your app supports account creation, you must also
  offer account deletion within the app."
- **Google Play:** triggers if a user can create an account in the app, **or if
  the app directs the user to an account creation flow outside it.**

Satisfying neither trigger is what lets the apps ship without a deletion flow
that would have to decide what happens to the hours somebody logged, which are
the institute's records. "They already had a Google account" is no argument:
the app account is the Firebase Auth user and `users/{uid}`, which
`onUserCreate` makes the first time a Google identity signs in.

## 2. How: ask before signing in

Native Google sign-in is pure Google OAuth: it yields an ID token and touches
nothing in this Firebase project. `signInWithCredential` is the line that
creates the account. So the phone app asks first:

```mermaid
sequenceDiagram
  participant P as Phone app
  participant G as Google
  participant F as accountExists (callable)
  participant A as Firebase Auth
  P->>G: GoogleSignin.signIn()
  G-->>P: ID token (nothing created)
  P->>F: { idToken }
  F->>F: verify Google's token (audience = web client id)
  F->>A: getUserByEmail (Admin SDK)
  F-->>P: { exists }
  alt exists
    P->>A: signInWithCredential
  else no account
    P->>P: "This account isn't set up for the app yet. Contact your administrator."
  end
```

- **`functions/src/accountExists.ts`**: unauthenticated (there is no session
  yet), verifies GOOGLE's ID token rather than Firebase's, pinned to the web
  OAuth client id so a token minted for another client cannot be replayed, and
  answers one boolean. It cannot be done on the client:
  `fetchSignInMethodsForEmail` returns nothing under email enumeration
  protection, the default since September 2023.
- **`app/src/auth/google.ts`** `exchangeGoogleIdToken`: no account means no
  `signInWithCredential`, and the remembered Google account is cleared so
  another can be chosen. The emulator dev sign-in goes through the same
  function, so an emulator build on a phone refuses exactly as production does.
- **`app/src/auth/google.web.ts`**: the web keeps creating accounts (an unknown
  `@oursabeel.com` address lands pending, an admin approves). Nothing needs to
  detect a platform: the seam is the platform.
- **The refusal copy names no website.** "Sign in on the website first" is
  Play's second trigger almost word for word. The instruction lives out of
  band: the user manual (1.1) and the support page. One support question per
  newcomer is the price of the exemption.

**Status does not matter, only existence.** A pending or disabled account
exists, so it signs in and sees its gate screen exactly as before; signing in
to an existing account creates nothing.

## 3. What moves, and what does not

**Moves to the web:** creating an account. Nothing new had to be built there:
the web's Google sign-in already was the creation flow.

**Stays in the phone apps:** everything else, including the admin actions
(approve, roles, disable). None of them creates an identity.

## 4. Privacy and support pages

Served by Hosting as static files outside the signed-in app, because a store
crawler and a reviewer read them without signing in:

| Path | File | Linked from |
|---|---|---|
| `/privacy` | `app/public/privacy.html` | the sign-in screen (reachable before signing in, 5.1.1(i)), the bottom of Home, App Store Connect |
| `/support` | `app/public/support.html` | App Store Connect's support URL only |

`firebase.json` rewrites both ahead of the SPA catch-all.
`functions/test/unit/hostingPages.test.ts` holds the rewrites, the files, the
URLs in `@sabeel/shared` and two rules together: the policy links to nothing
but mail, and nothing in the app links to the support page, which tells a
newcomer to sign in on the website first.

The policy states what is collected, who processes it (Google, Google Cloud
and Firebase, Apple for iPhone notifications, Sentry), that hours and
timesheets are kept as the institute's records, and how to ask for deletion:
**privacy@oursabeel.com**, acted on within 30 days. That is the one address for
every Sabeel app (decided 2026-08-18).

## 5. Deploy order

The gate calls `accountExists`, so **the function must be live before any app
build that contains the gate reaches a phone**: deploy functions first, then
cut the release. A build that calls a callable that does not exist fails every
native sign-in.

1. `firebase deploy --only functions` (adds `accountExists`), and `hosting` for
   `/privacy` and `/support`.
2. Then the Android release and the first iPhone build.

Android APKs already installed (0.27.1 and older) do not call it and keep
creating an account on a first native sign-in until they update. That is the
old behaviour, not a new hole; the first release with the gate closes it.

## 6. Apple specifics

### Sign in with Apple (4.8): not required

Guideline 4.8 requires an equivalent privacy-preserving login when an app uses
a third-party login service for the user's primary account. It does not apply
where the app is used with the organisation's own account system, which is
this app: Google sign-in is accepted only for the institute's own
`@oursabeel.com` Google Workspace accounts (enforced by `onUserCreate`, which
deletes any other), and every account is approved by an administrator before
it can do anything. Workspace is the institute's account system; Google is
where it is hosted. Say so in the review notes (§ 7) rather than add Apple
sign-in reflexively.

### Export compliance

`expo.ios.config.usesNonExemptEncryption: false` writes
`ITSAppUsesNonExemptEncryption = NO`. The app uses only the encryption the
operating system provides (HTTPS to Firebase, Google and Sentry), which is
exempt, so no export compliance documentation is needed and builds reach
testers without the questionnaire.

### Privacy manifest

`expo.ios.privacyManifests` (Expo writes `PrivacyInfo.xcprivacy`):
`NSPrivacyTracking` false, no tracking domains, the UserDefaults reason
`CA92.1`, and five collected types, all linked to the user, none for tracking,
purpose App Functionality: email address, name, user ID, other user content,
crash data. At `pod install` React Native merges the pods' own required-reason
APIs into the same file. `npm run check:ios` refuses a manifest that is
missing, declares no types, or tracks.

### Purpose strings

None needed: the app asks for no camera, photos, location, contacts or
microphone. The notification permission has no purpose string on iOS.

### App Privacy answers (App Store Connect)

The questionnaire must agree with the manifest and the policy.

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | Yes |
| Contact Info | **Name**, **Email Address**: App Functionality; linked to the user; not used for tracking |
| User Content | **Other User Content** (hours, notes, timesheets): App Functionality; linked; not tracking |
| Identifiers | **User ID**: App Functionality; linked; not tracking |
| Diagnostics | **Crash Data**: App Functionality; linked (Sentry carries the account id); not tracking |
| Everything else (Health, Financial, Location, Sensitive, Contacts, Browsing, Search, Purchases, Usage Data, Performance Data, Other Data) | Not collected |
| Used to track you | Nothing |

Two judgement calls, written down so they are not re-argued: the user document
stores the **link** to the Google account's avatar, which the app never shows,
so it is not declared as Photos; and the device push token is a delivery
address for the app's own notifications, not a tracking identifier, so it is
not declared as Device ID (the Kanban and LMS answer the same way).

## 7. Review notes

The text for App Store Connect's review notes. How a reviewer signs in is
decided separately and added here with it.

```text
This app does not support account creation. Accounts are created by the
organisation through its web application; the app refuses sign-in for any
identity that does not already have an account, and no account is created
from the app under any circumstance. Guideline 5.1.1(v) is therefore not
engaged.

Sign-in uses the organisation's own Google Workspace accounts
(@oursabeel.com) only, approved by an administrator: the organisation's
existing account system, so Guideline 4.8 does not require Sign in with Apple.

Account deletion is requested by email; the privacy policy states the
address, the process and what is retained. The hours and timesheets people
record are retained as the organisation's business records.
```

## 8. What is verified, and what is not

- `accountExists`: five emulator tests, each "no" also counting the auth users
  afterwards (`functions/test/integration/accountExists.integration.test.ts`).
- The ordering: `app/src/auth/googleGate.test.ts`, the load-bearing assertion
  being that `signInWithCredential` is never called without an account; shown
  red with the exchange moved ahead of the question.
- The iPhone simulator, emulator build (2026-10-15): an unknown address is
  refused with the copy above and the auth user count does not move; once a
  web-style sign-in has created the account, the phone signs in to the pending
  screen.
- The web still creates accounts: the web suites drive sign-up through it.

**Not yet verified: the native round trip against production.** A personal
Google account with no account in the project, on a production build: refused,
and no auth record created; then a Workspace account signs in. It needs a
production build (a Release build on the simulator, or TestFlight on an iPhone)
and a person to sign in with real Google accounts. Do it before submitting for
review.
