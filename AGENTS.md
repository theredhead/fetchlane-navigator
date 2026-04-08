# AGENTS.md — @theredhead/fetchlane-navigator

> **This is the single source of truth for all AI agents working in this
> repository.** Every convention, pattern, and architectural decision is
> documented here. When in doubt, follow this file.

---

## Project Overview

This is an **Angular 21** zoneless application (`@theredhead/fetchlane-navigator`)
that lets users browse and inspect database tables and records across multiple
database engines (PostgreSQL, MySQL, SQL Server) through **Fetchlane** REST
API backends, secured by **Keycloak** OIDC authentication.

The app consumes the `@theredhead` component libraries via tsconfig path
mappings to their source:

| Package                  | Scope      | Purpose                                                         |
| ------------------------ | ---------- | --------------------------------------------------------------- |
| `@theredhead/foundation` | Core       | Logger, type utilities, base classes, UISurface directive       |
| `@theredhead/ui-kit`     | Primitives | Button, Input, Select, Table View, Tabs, Icon, Pagination, etc. |
| `@theredhead/ui-blocks`  | Composites | Master-Detail View, Property Sheet, Navigation Page             |
| `@theredhead/ui-theme`   | Theming    | ThemeService, SCSS Material 3 theme mixin, design tokens        |
| `@theredhead/ui-forms`   | Forms      | JSON-driven form engine, validation, field registry             |

### Infrastructure

| Service            | Purpose                       | Local Port |
| ------------------ | ----------------------------- | ---------- |
| Keycloak           | OIDC identity provider        | 8080       |
| Fetchlane Postgres | REST API → PostgreSQL Chinook | 3001       |
| Fetchlane MySQL    | REST API → MySQL Chinook      | 3002       |
| Fetchlane MSSQL    | REST API → SQL Server Chinook | 3003       |
| Chinook Postgres   | PostgreSQL database           | 5432       |
| Chinook MySQL      | MySQL database                | 3306       |
| Chinook MSSQL      | SQL Server database           | 1433       |
| Angular dev server | `ng serve`                    | 4200       |

---

## Toolchain

| Tool       | Version          | Notes                                                   |
| ---------- | ---------------- | ------------------------------------------------------- |
| Angular    | 21               | Standalone components, signal APIs, OnPush everywhere   |
| TypeScript | 5.9+             | `strict: true`, `noImplicitOverride`, `isolatedModules` |
| Build      | `@angular/build` | Application build via `ng build`                        |
| Tests      | Vitest 4         | `npx vitest run`                                        |
| Styles     | SCSS             | Component-scoped, CSS custom property tokens            |
| Docker     | Compose v2       | `docker compose -f docker/docker-compose.yml up -d`     |

> **Zoneless architecture** — this app is fully zoneless (Angular 21 default).
> **Never** import or inject `NgZone`. All change detection is driven by
> Angular signals and `ChangeDetectionStrategy.OnPush`.

---

## Component Conventions

### Decorator pattern

```ts
@Component({
  selector: 'bo-<name>',
  imports: [/* only what the template needs */],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './<name>.component.html',
  styleUrl: './<name>.component.scss',
  host: {
    class: 'bo-<name>',
    '[class.bo-<name>--<variant>]': "variant() === '<variant>'",
  },
})
```

### Naming

- **Selector prefix:** `bo-` (backoffice)
- **Class name:** `Bo<PascalName>` — no `Component` suffix (e.g. `BoTableBrowser`, `BoRecordInspector`)
- **File name:** `<name>.component.ts`, `<name>.component.html`, `<name>.component.scss`

### Signal API (always use modern signal APIs — never legacy decorators)

| API                   | Use for                | Example                                                    |
| --------------------- | ---------------------- | ---------------------------------------------------------- |
| `input<T>()`          | Optional inputs        | `readonly variant = input<string>('default')`              |
| `input.required<T>()` | Required inputs        | `readonly tableName = input.required<string>()`            |
| `model<T>()`          | Two-way binding        | `readonly value = model<string>('')`                       |
| `output<T>()`         | Events                 | `readonly rowSelected = output<Record<string, unknown>>()` |
| `signal<T>()`         | Internal mutable state | `protected readonly loading = signal(false)`               |
| `computed()`          | Derived state          | `protected readonly filtered = computed(() => ...)`        |
| `effect()`            | Side effects           | `effect(() => { ... })`                                    |

All input/model/signal fields are declared `readonly`.
Host bindings use declarative `host: {}` metadata — never `@HostBinding` / `@HostListener`.

### Accessibility

- Always provide an `ariaLabel` input where appropriate
- Forward it to the native element: `[attr.aria-label]="ariaLabel()"`
- Use proper ARIA roles and patterns

---

## Access Modifiers

Every method and field in **every** class **must** have an explicit access
modifier (`public`, `protected`, or `private`). Never rely on TypeScript's
implicit `public`. This applies to constructors as well.

---

## Logging

**Never call `console.log` / `console.warn` / `console.error` directly.**
Use the `Logger` from `@theredhead/foundation` instead.

```ts
import { LoggerFactory } from '@theredhead/foundation';

export class BoTableBrowser {
  private readonly log = inject(LoggerFactory).createLogger('BoTableBrowser');

  public loadTables(): void {
    this.log.debug('loading tables');
    this.log.error('load failed', [err]);
  }
}
```

---

## Icons — No Emoji or Unicode Glyphs

**Never use emoji or Unicode symbol characters as visual icons in templates.**
Use the `UIIcon` component with SVG content from the `UIIcons` registry:

```ts
import { UIIcon, UIIcons } from '@theredhead/ui-kit';
```

---

## Colour Pairing — Always Set Both Foreground and Background

Whenever you set a `color` (foreground) you **must** also set a `background`
(or `background-color`), and vice-versa. Aim for WCAG AA contrast.

- No BEM-style CSS class names
- No inline `style` attributes in templates

---

## CSS / SCSS Conventions

### Token namespace

| Namespace | Scope                             | Examples                            |
| --------- | --------------------------------- | ----------------------------------- |
| `--ui-*`  | Design tokens from the UI library | `--ui-text`, `--ui-surface`         |
| `--bo-*`  | App-specific tokens               | `--bo-sidebar-width`, `--bo-nav-bg` |

Dark mode is handled globally by `@theredhead/ui-theme`. Components consume
tokens via `var(--ui-text)` etc. — never declare per-component dark mode blocks.

---

## Class Member Ordering

1. **Signal inputs / outputs / models**
2. **Queries** — `viewChild()`, `contentChild()`, etc.
3. **Computed signals**
4. **Public fields**
5. **Protected fields**
6. **Private fields**
7. **Constructor**
8. **Static / factory methods**
9. **Lifecycle hooks**
10. **Public methods**
11. **Protected methods**
12. **Private methods**

---

## Services

- Use `inject()` function — not constructor injection
- Use `providedIn: 'root'` for singletons
- Design around a single responsibility

---

## Fetchlane Integration

The app communicates with three Fetchlane backends (one per database engine).
Each backend exposes the same REST API:

| Endpoint                                 | Purpose                |
| ---------------------------------------- | ---------------------- |
| `GET /api/data-access/table-names`       | List tables            |
| `GET /api/data-access/:table`            | Browse records (paged) |
| `GET /api/data-access/:table/info`       | Table metadata         |
| `GET /api/data-access/:table/schema`     | Column schema          |
| `GET /api/data-access/:table/record/:pk` | Single record          |
| `POST /api/data-access/fetch`            | Advanced FetchRequest  |

All requests require a Bearer token from Keycloak.

---

## Keycloak Authentication

- **Realm:** `backoffice`
- **Client ID:** `backoffice-app` (public client, PKCE S256)
- **Roles:** `admin` (full CRUD), `guest` (read-only, no Customer table)
- Auth is initialized via `APP_INITIALIZER` before the app renders
- An HTTP interceptor attaches the Bearer token to all Fetchlane API calls
- Demo accounts: `admin:admin`, `guest:guest`

---

## Docker Infrastructure

```sh
# Start all infrastructure (Keycloak + 3 DBs + 3 Fetchlanes)
npm run docker:up

# Start Angular dev server
npm start

# Full demo (includes containerized Angular app)
npm run docker:demo
```

Configuration files live in source:

- `src/fetchlane-config/` — Fetchlane JSON configs (copied into containers)
- `src/keycloak/` — Keycloak realm export (mounted on startup)

---

## Templates

- Use native control flow (`@if`, `@for`, `@switch`)
- Keep templates simple — no complex logic
- Do not use `ngClass` or `ngStyle` — use `class` and `style` bindings

---

## Git Conventions

- **Commit messages:** conventional commits — `feat:`, `fix:`, `chore:`, `refactor:`
- **Scope:** matches feature area — `feat(table-browser):`, `fix(auth):`

---

## Verification Checklist

Before committing, always run:

1. `npx tsc --noEmit` — must be clean
2. `npm run build` — must succeed
3. Check for IDE lint errors in modified files
