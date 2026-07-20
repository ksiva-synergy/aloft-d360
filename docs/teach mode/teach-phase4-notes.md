# Teach — Phase 4 notes: the teaching surface (native, wired to the live loop)

The interactive Teach session surface at `/agent-lab/teach`, wired to the Phase 1–3
loop and composed with the existing Digest as one feature. This note records the reuse
map (element → live event/endpoint), the **theme correction** (prototype palette →
native app tokens), and confirmation that no backend / Phase 1–3 invariant was touched.

## What was at /teach before
`/agent-lab/teach/digest` (Phase-3 read-only hand-off) existed; the parent `/teach`
became the session surface in Phase 4. The Digest route/behavior is unchanged — only a
session→Digest entry link ("Candidate hand-off →") was added from the session view.

## Reuse map — wiring, not inventing
Everything behind the UI is the Phase 1–3 substrate; the surface only binds to it.

| UI element | Live event / endpoint it binds to | Built from |
|---|---|---|
| Thread + composer | `POST /api/inspector/teach` (SSE, Reflect loop) via `useTeachChat` | `TeachThread` |
| Reflect decline | rendered as an ordinary assistant turn (server refuses tasks; no special event) | `MarcusBubble` |
| "What Marcus is learning" rail | `learning_item` SSE events → UPSERT by `learning.id` (never scraped from chat) | `LearningRail` / `LearningCard` |
| State-machine chip | `learning.state` (proposed→verifying→verified/conflict/rejected) | `StateBadge` |
| Verify chip | `verification_result` event (`confirmed` / `unconfirmed` / typed `not_verifiable`) — no fabricated numbers | `VerificationChip` |
| Recall expander | `memory_recall` event / `learning.related_memory_hits` | `MemoryRecallExpander` |
| Conflict resolver | `learning.conflict`; choice advances state **client-transient** (no governed write) | `ConflictResolver` |
| Session-header counters | derived from the rail (`deriveCounters`) — one source of truth | `SessionHeader` |
| Empty state | static seeded starters (degrade without NL-intent substrate) | `ThreadEmptyState` |
| "Open in Build" boundary | INERT by construction — no state-mutating handler | (Digest) |

Rail invariant preserved: cards come from the **typed event payload**, upserted by id —
never parsed out of the streamed chat text.

## Theme correction — prototype palette → native app tokens
Phase 4 first shipped with a scoped `.teach-surface { --tm-* }` palette in `globals.css`
lifted verbatim from `ALOFT Teach.html` (violet `#7c3aed`/`#a78bfa`, GitHub-dark
`#0d1117`) + Spectral/Public Sans fonts. That prototype was an **interaction reference
only** — its tokens were never meant to ship. The surface must be native to
aloft-d360's design system, consuming the app's own light/dark tokens like its sibling
the Digest.

### App theme system
`next-themes` (`attribute="class"`) toggles `.dark`/`.light` on `<html>`; Tailwind
`darkMode: 'class'`. Tokens are CSS vars in `globals.css` `:root` (light) / `.dark`
(dark). NB: the repo's Tailwind config does **not** define shadcn tokens
(`bg-card`/`text-foreground`/`border-border`/`text-muted-foreground` emit no CSS —
verified by compiling Tailwind against the real config); only the standard palette
(`text-sky/emerald/amber/violet-*`) works. So "native" here = consume the app's real
CSS vars via inline `style`, the same architecture the components already used.

### Token map (`--tm-*` → app token) — all defined in BOTH themes
| `--tm-*` | → App token |
|---|---|
| `--tm-bg` | `--background` |
| `--tm-panel` | `--card` |
| `--tm-panel-2`, `--tm-panel-3` | `--muted` |
| `--tm-border` | `--border` |
| `--tm-border-soft` | `--border-subtle` |
| `--tm-text` | `--foreground` |
| `--tm-dim` | `--muted-foreground` |
| `--tm-faint` | `--text-tertiary` |
| `--tm-accent` | `--primary` |
| `--tm-accent-2` | `--secondary` (white-text-safe gradient partner) |
| `--tm-green` (verified) | `--success` |
| `--tm-amber` (conflict) | `--warning` |
| `--tm-shadow` | `0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)` (theme-agnostic) |
| `--tm-glow` | `0 4px 14px color-mix(in srgb, var(--primary) 30%, transparent)` |
| `'#fff'` (on-fill text) | `--primary-foreground` (white in both) |

**Deliberate picks (no natural 1:1 app token):**
- `--tm-blue` (proposed / verifying) → **`--primary`**. The app has no dedicated
  info-blue token; `--primary` is its blue (navy light / blue dark). Proposed-state and
  the Marcus accent therefore share `--primary` — a deliberate consolidation (different
  panes; more native than inventing a token). The Digest's `sky` was a Tailwind palette
  class, not an app CSS var.
- `--tm-orange` (rejected) → **`--destructive`**. Prototype orange had no app analogue;
  `--destructive` fits "discarded" and is never shown in a header tile.

Fonts: `Spectral` → `Source Serif 4`; `Public Sans` → `Inter Tight`; `JetBrains Mono` →
`IBM Plex Mono` (the app's loaded families).

Keyframes kept (pure motion): `tm-spin`/`tm-shimmer`/`tm-pulse`/`tm-up`. `tm-ring`
re-expressed to borrow `--primary` instead of the prototype accent.

Removed from `globals.css`: the `.teach-surface { --tm-* }` and
`.dark .teach-surface { --tm-* }` blocks + the `--tm-scroll` scrollbar. Left a native
`.teach-surface` scrollbar keyed on `--border`.

## No backend / invariant touched (restyle was color-layer only)
- `useTeachChat.ts`, `POST /api/inspector/teach`, the event→card state machine,
  `deriveCounters`, the resolve semantics, the feed query, and the capture path are all
  unchanged. Conflict resolution stays in-session only (no persistence route;
  `resolveCandidateByMemoryId` stays unused — a Build-thread decision).
- Reputation does not fire anywhere in Teach.
- Diff confined to `src/components/teach/**` + `src/app/globals.css`.

## Verification
- grep: no `var(--tm-*)` refs and no hardcoded hex remain in the Teach surface.
- Every app token used is defined in both `:root` and `.dark`.
- `tsc --noEmit` and `eslint` clean for the Teach surface.
- Remaining: live side-by-side of `/agent-lab/teach` vs `/teach/digest` in app light AND
  dark via the global toggle (requires the running app + auth/Bedrock).
