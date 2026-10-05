---
name: Expo and workspace compatibility
description: Compatibility constraints for keeping the Expo starter and existing React preview packages on one React type line.
---

Keep Expo SDK 54 packages aligned through `expo install --check` before relying on a customer-app startup result. The shared React type catalog must stay on the React 19.1 line used by Expo; allowing it to float to a newer line can break existing React preview components.

**Why:** Expo's peer compatibility checks are stricter than TypeScript alone, and newer React type definitions can change ref signatures used by the existing preview package.

**How to apply:** After changing Expo or React dependencies, run the Expo compatibility check and the full workspace typecheck together.

Shared frontend-only token packages use TypeScript source entry points for both runtime imports and types when their build emits declarations only.

**Why:** Metro and Vite can compile that source directly; a declaration-only build does not produce JavaScript, and separating source imports from stale generated types can make runtime and type checks disagree.

**How to apply:** Keep native, web, and type consumers on the same source entry point for frontend-only token packages. Do not extend this convention to packages executed directly by Node.