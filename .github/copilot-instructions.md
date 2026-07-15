# SIAM — GitHub Copilot Instructions

Repository custom instructions for Copilot Chat and the coding agent. Full rationale in `../SYSTEM_PROMPT.md` (repo root). Apply every rule below to any suggestion, chat answer, or autonomous PR you produce in this repo. When a rule and a code comment/existing pattern conflict, the rule here wins — flag the discrepancy instead of silently following stale code.

## Repository shape
Monorepo root here is `management-system/` (Next.js + PayloadCMS, single process — admin panel + custom app + REST/GraphQL API). A sibling repo `../scanner-prototype/` (Python) talks to this one over HTTP only; never suggest an import crossing that boundary.

## Git workflow (mandatory)
Flow: `RamaPersonal → PR → dev → PR → main`. Any change you author or suggest is for a PR into `dev`. Never generate a commit directly to `dev`/`main`, never propose merging a branch straight into `main`. When opening a PR as a coding agent, target `dev`.

## AuditLog & Notification Bell — comment, don't build
Neither feature exists in code yet. Do not scaffold a new collection, table, or event bus for either — flag the trigger point with a comment instead.
- On every create/update/delete of an entity or entity group (PayloadCMS collection or domain function) you write or modify, add:
  ```ts
  // AUDIT: emits AuditLogs entry (chain_hash, chained per organization_id) — TODO(audit-feature): wire via domain/audit/builder.ts::addAuditEvent
  ```
- Confirmed triggers already: `organization.deactivate`, `user.invite`, `inventory_snapshot.create`. Same-transaction write, never a separate job.
- On any user-facing event that plausibly needs to alert someone else (invite, role change, deactivation, task assignment, completed assessment), add:
  ```ts
  // NOTIFY: should raise a Notification Bell entry for {audience} — TODO(notification-feature): not scoped yet, comment only
  ```
- Mantine `Notifications` toasts are unrelated (ephemeral UI feedback) — do not treat a toast as satisfying either rule above.

## DRY & the UI ecosystem
- Mantine is the only component library. Do not suggest Chakra/MUI/AntD/unstyled HTML for anything Mantine already provides.
- Icons: `lucide-react` only, direct named imports (`import { Wifi } from 'lucide-react'`). Wrap only when the same size/color combo repeats 3+ times.
- Tables: always through a generic `<DataTable>` in `components/ui/`, built on TanStack Table. Never suggest a raw `useReactTable()` call inside a domain module — extend `<DataTable>` instead.
- `components/ui/` = generic, no domain knowledge, reusable everywhere. `modules/<domain>/components/` = domain-specific presentation.
- Before generating a new component, hook, or util, check `components/ui/`, `lib/`, and `modules/<domain>/` for an existing equivalent — prefer completions that reuse over ones that reimplement.

## State management
One owner per piece of data.
- Server state (from Postgres via Payload) → TanStack Query only. Never suggest copying a query result into `useState` or a Zustand store.
- UI state that outlives a component → Zustand, one store per module (`<domain>.store.ts` → `use<Domain>Store`). Never a single global store, never Redux/Redux Toolkit.
- Never suggest `useQuery`/`useMutation` inside a presentation component — only inside `modules/<domain>/hooks/use-*.ts`; presentation components take `data`/`isLoading`/`onSubmit` as props.
- Query keys are hierarchical arrays (`['assets', officeId, { criticality, status }]`), never string concatenation.
- A PR (including one you open as coding agent) that copies a `useQuery` result into Zustand must not be proposed — this is an explicit review-blocking rule (ADR-007).

## Contracts (Zod is the source of truth)
- `contracts/*.schema.ts` at repo root (outside `modules/`) holds Zod schemas for anything crossing the Scanner↔Platform boundary.
- Pipeline: Zod → JSON Schema (`zod-to-json-schema`) → OpenAPI 3.1 → Pydantic (`datamodel-code-generator`, output in `../scanner-prototype/src/siam_agent/contracts.py`).
- Never generate a hand-written duplicate TS interface (use `z.infer<...>`) or a hand-written duplicate Pydantic model. Never propose a shared npm+PyPI package to bridge Zod and Pydantic.
- Client-side form schema and server-side endpoint schema must be the same Zod schema (or an explicit extension) — never two independent definitions.

## HTTP
- Never generate a direct `fetch()` call inside a component. Required chain: Component → `modules/<domain>/hooks/use-*.ts` → `modules/<domain>/service.ts` → `lib/http-client.ts` → Payload API.
- Scanner↔Platform stays HTTP(S)/JSON only — no GraphQL/gRPC/WebSocket suggestions for that channel. Breaking changes need `/api/v1/...` versioning, never an in-place path change.

## Multi-tenancy & security
- `OrganizationMemberships` is the bridge entity — never suggest a direct FK from `Users` to `Organizations`.
- One active membership per user; `organization`/`user` FKs are immutable post-creation.
- Role-rank escalation checks compare `role.rank` at the hook level — never a static role-name enum.
- Never suggest code that could remove the last active `OrgAdmin` membership of an organization without an explicit guard.
- Row-level tenant scoping (`organization_id`/`office_id`) always applies, independent of and in addition to RBAC's `canDo`.
- `canDo(role, Collection, Action, organizationId)` always takes an explicit `organizationId` from `TenantContext` — never infer it from the user object.
- Auth0 fail-closed in production: no session → `req.user = null`, no fallback path. A dev-only fallback exists strictly behind `NODE_ENV !== 'production'` — never suggest relaxing that gate "to simplify."
- Never auto-create a `User` record just because an Auth0 session is valid — `TenantResolver.resolve` must fail explicitly instead.
- Never suggest client-side RBAC checks (`role === 'OrgAdmin'` in a component). Permissions arrive resolved via `TenantContext`; the frontend only reads.

## Testing (defined here — no prior convention in this repo's docs)
- Unit/integration in `management-system`: Vitest, colocated as `*.test.ts` next to the source file (never a mirrored `__tests__/` tree).
- Unit in `../scanner-prototype`: `pytest`, under `scanner-prototype/tests/`, mirroring module names.
- E2E: Playwright, `management-system/e2e/*.spec.ts`, named by user flow (`org-onboarding.spec.ts`), not by page/route. E2E is for cross-layer flows only — don't propose an E2E spec for something a unit test already covers.
- Always propose a test alongside changes to: AuditLog chain_hash computation, RBAC/tenant scoping, subscription feature reset on deactivation, or the tenant bootstrap creation order — these are explicit invariants, not optional coverage.

## Naming conventions
Collections PascalCase, fields snake_case, N:M FK arrays end in `_ids`. Modules plural (`modules/assets/`). Components `PascalCase.tsx`. Hooks `use*`. Services `<module>.service.ts`. Stores `<module>.store.ts`. Non-component files kebab-case.
