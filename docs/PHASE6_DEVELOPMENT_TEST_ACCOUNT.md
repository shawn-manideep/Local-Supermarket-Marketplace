# Phase 6 development test account

No Admin Portal or provisioning UI is required. No portal, HTTP route, authorization rule or authentication architecture is changed.

## Password

Save a dedicated secure password (8–128 characters under the existing provisioning rules) as the development Secret `PHASE6_DELIVERY_TEST_PASSWORD`. Do not pass it as a CLI argument or paste it into chat. The command consumes the Secret without printing it or persisting it in application tables.

## Provision / recreate

From the workspace shell:

```sh
NODE_ENV=development pnpm --filter @workspace/api run dev:delivery-test -- provision
```

This uses the existing Phase 6 provisioning service to create **only**:

- Username: `deliverytest1`
- Display name: `Test Delivery Partner`
- Role: `delivery_partner` (`DELIVERY_PARTNER` in UI)
- Status: `ACTIVE`

Matching existing ACTIVE accounts are verified and reused, without resetting credentials. A conflicting role, unexpected profile or inactive account is refused instead of silently changed. Re-running does not create a duplicate. Marked Auth remnants block recreation until cleanup/review.

Sign in at the existing Delivery Partner portal using `deliverytest1` and the password you saved in Secrets. No assignments are created.

## Read-only verification

```sh
NODE_ENV=development pnpm --filter @workspace/api run dev:delivery-test -- verify
```

Checks Supabase Auth, application role, global username uniqueness, matching partner profile and ACTIVE status. No credentials or internal Auth identities are printed.

## Cleanup after manual acceptance

```sh
NODE_ENV=development pnpm --filter @workspace/api run dev:delivery-test -- cleanup
```

Deletes only the exact matching test account with this command's protected Auth ownership marker, then removes its application identity/profile and username mapping. It verifies absence afterward. Already absent is safe to repeat; an Auth-only marked remnant can be removed on retry.

Cleanup refuses unrelated/unmarked accounts and any account with assignments. It never deletes orders or delivery operational records. Interrupted provisioning leaving unexpected application records requires administrator review; do not broaden the deletion criteria.

## Development guard

All commands require explicit `NODE_ENV=development`, reject the documented `REPLIT_DEPLOYMENT=1` published-app flag, and allow only the already-confirmed development Supabase project. Both independent Auth and PostgreSQL targets are checked **before** making connections. There is no configurable production-target override.

`REPLIT_ENVIRONMENT` is not used as the application-deployment indicator: this workspace already sets it to `production`. Published-app detection uses Replit's documented `REPLIT_DEPLOYMENT` flag instead.

No production migration or schema change is needed. The password Secret can be removed manually after cleanup if no longer needed.