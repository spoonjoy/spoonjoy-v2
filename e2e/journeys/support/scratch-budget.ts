// The sign-in attempts the journeys themselves make across a full run, on top of the "personas"
// project's (3 personas, plus 2 for each scratch file in ../scratch/). QA allows 60 a minute per
// IP; test/scripts/journey-sign-in-budget.test.ts keeps the sum under it, with headroom.
//
// sign-in.journey.ts's 4 login submissions (username, email, wrong-password, and the logout
// test's fresh sign-in) run on both the iphone-webkit and desktop-chrome device projects (it is a
// plain *.journey.ts, not device-suffixed) for 8; round-trips.journey.ts's 1 "log in, then
// redirect back" submission likewise runs on both devices for 2; account-settings.journey.ts's 1
// sign-in with the password it just changed runs on both devices for 2; cooking.mobile.journey.ts's
// 1 /signup runs on iphone-webkit only for 1; sessions.desktop.journey.ts's 1 fresh scratch-6
// sign-in (its second browser) runs on desktop-chrome only for 1; and new-user.journey.ts's 1
// rejected /signup (a too-short username, which still counts as an attempt) runs on both devices
// for 2. cook-session-sync.desktop.journey.ts's second browser reuses its stored session and signs
// in nothing, and neither do households.desktop.journey.ts's two browsers.
export const JOURNEY_SIGN_IN_ATTEMPTS = 8 + 2 + 2 + 1 + 1 + 2;
export const PERSONA_SIGN_INS = 3;
export const QA_SIGN_INS_PER_MINUTE = 60;
