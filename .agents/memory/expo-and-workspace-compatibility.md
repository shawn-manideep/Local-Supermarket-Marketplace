---
name: Expo and workspace compatibility
description: Compatibility constraints for keeping the Expo starter and existing React preview packages on one React type line.
---

Keep Expo SDK 54 packages aligned through `expo install --check` before relying on a customer-app startup result. The shared React type catalog must stay on the React 19.1 line used by Expo; allowing it to float to a newer line can break existing React preview components.

**Why:** Expo's peer compatibility checks are stricter than TypeScript alone, and newer React type definitions can change ref signatures used by the existing preview package.

**How to apply:** After changing Expo or React dependencies, run the Expo compatibility check and the full workspace typecheck together.