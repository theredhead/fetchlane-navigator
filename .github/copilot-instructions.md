# Copilot Instructions — @theredhead/fetchlane-navigator

**All project conventions, patterns, and architecture are documented in
[AGENTS.md](../AGENTS.md) at the repository root. That file is the single
source of truth — always follow it.**

Read and apply `AGENTS.md` before generating or modifying any code in this
workspace. It covers:

- Component conventions (standalone, OnPush, signal APIs, `Bo<Name>` naming, `bo-` prefix)
- CSS token namespace (`--ui-*` from library, `--bo-*` for app), centralised dark mode
- Class member ordering, access modifiers, Logger usage
- Fetchlane REST API integration patterns
- Keycloak OIDC authentication (APP_INITIALIZER, HTTP interceptor, role guards)
- Docker infrastructure (Compose, Keycloak, Chinook databases, Fetchlane instances)
- Git commit conventions and verification checklist
