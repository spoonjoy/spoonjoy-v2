# Account deletion and export

A person can download everything they put into Spoonjoy, and can permanently delete their account. The web account settings page and the iPhone account screen use the same server code: `app/lib/account-export.server.ts` and `app/lib/account-deletion.server.ts`.

## Export

`GET /api/v1/me/export` returns one JSON document, format `spoonjoy.account-export.v1`:

- the account: id, username, email, profile photo URL, creation time and sign-in methods;
- every recipe the person owns, including deleted ones, with steps, ingredients, which steps use another step's output, and every cover (active or archived);
- their cookbooks and the recipes saved in each;
- their shopping list;
- their cooks (spoons), with notes and photos.

Photos are listed as absolute `https://spoonjoy.app/photos/...` URLs. Password hashes, tokens and passkey keys are never included.

## Who can delete

Deleting needs the username typed back, plus proof that the person is the owner right now (`app/lib/account-reauthentication.server.ts`):

| Account | Proof |
| --- | --- |
| Has a password | The current password, on the web and in the app. |
| No password, on the web | A sign-in within the last 10 minutes. The session cookie records when the person signed in; re-issuing the cookie (signing out other sessions, linking another sign-in method) keeps the original time. |
| No password, in the iPhone app | A fresh Sign in with Apple credential for the Apple ID linked to the account. |

`DELETE /api/v1/me` takes `confirmUsername` plus `password`, or `appleIdentityToken` and `appleRawNonce`. It is rate limited like sign-in, so a stolen token cannot be used to guess the password.

## What happens to the data

Deletion is one atomic D1 batch: every step applies, or none does.

**Recipes that other cooks built on stay public, under the "deleted chef" account.** A recipe counts as built on when another cook forked it, saved it in one of their cookbooks, or logged a cook of it. Its chef becomes the `deleted-chef` account (profile `/users/deleted-chef`). Nobody can sign in to that account, and the username `deleted-chef` is reserved.

**Forks stay with the cook who forked them.** A fork keeps pointing at the recipe it came from. If that recipe was one of the deleted person's own forks of their own recipe, the link is cleared.

**Everything else is deleted:**

- the person's other recipes, with their steps, ingredients and covers;
- their cookbooks and shopping list, and anything they saved into a cookbook;
- their cooks (spoons) on any recipe, and covers made from those cooks' photos, including copies a fork made and stylized versions;
- their profile photo;
- every way to act as them: passkeys, linked sign-in providers, API tokens, OAuth grants, refresh tokens, authorization codes and their issuance history, unclaimed agent connections, push subscriptions and app devices;
- notifications to them, and notifications to other cooks that name them;
- the account itself. Browser sessions stop working because the account is gone.

Covers no longer record the person as their creator.

**Photos** of the account are queued for the photo sweep (`docs/photo-lifecycle.md`) in the same batch. The sweep removes each one once nothing references it, so a photo a fork still shows is kept.

## Not covered yet

- Cook-session progress kept in Durable Objects is not cleared. It is keyed by account and recipe and becomes unreachable with the account.
- Analytics events already sent to PostHog stay there until PostHog's retention removes them.
- Sign in with Apple refresh tokens are not stored, so there is nothing to revoke at Apple. The person can remove Spoonjoy from their Apple ID settings.
