---
name: Vendor document onboarding
description: New-only enforcement and store-local product creation boundaries approved by the user.
---
Mandatory document onboarding applies only to new Vendors. Existing Vendors
retain catalog access, even with no documents, and may use the Documents page.

**Why:** The user explicitly chose "New Vendors only" rather than gating existing
operating accounts.

**How to apply:** Preserve the existing-account exemption when changing the
document gate. Uploaded completion, not Admin approval, unlocks new accounts.
Orders, Profile, account settings and logout remain outside this gate.

Admin document completion is informational, not Vendor approval or document verification. Mandatory completion excludes optional documents, and grandfathered catalog access must not be displayed as completed uploads.

**Why:** The user explicitly stated that uploading documents does not mean the Vendor is approved and requested viewing/completion only, without an approval/rejection workflow.

**How to apply:** Preserve private storage and current-version ownership boundaries for Admin reads. Derive visible completion from actual mandatory uploads rather than catalog-access eligibility; do not change Vendor/store status as a side effect of viewing or completion.
