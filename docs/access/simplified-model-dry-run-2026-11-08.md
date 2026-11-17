# Simplified access model: migration dry run

Run: 2026-11-08T03:59:33.438Z · org `cmpm82n5x0000dj0cn3fo9pug` · read-only (no writes).

## Result

- People: 15. Paths checked: 3369 (3366 tables and views).
- Table decisions compared: 101,070 (use and export). Column decisions compared: 0.
- **Differences: 0.** Nobody gains or loses access.
- Bootstrap open (no grants yet): no.
- **After the copy (simulated: copy → new tables → loader → engine): 101,070 decisions, 0 differences.**
- **Real new tables (after the copy was applied): 101,070 decisions, 0 differences.**

## What the migration would do

### Departments → groups

| Department | Members | Archived |
|---|---|---|
| Marine (`marine`) | 0 | no |
| Technical (`technical`) | 0 | no |

### Grants → access rules

| Path | Holder | Today | Becomes |
|---|---|---|---|
| `curated_db` | department → group "Marine" | allow query | Use |
| `curated_db.crew_scorecard` | department → group "Technical" | allow query | Use |

### Labels → protections on paths

| Path | Label | Protection |
|---|---|---|
| `system` | restricted | Restricted |

### Clearances → protection access for that person

None.

### Column protections (unchanged)

2 protection(s), 53 protected column(s), 0 grant(s), 0 person(s) in access groups.

## Per person: tables they can open (today → new)

| Person | App roles | Open | Export |
|---|---|---|---|
| aadesh.shah@synergyship.com | admin | 0 → 0 | 0 → 0 |
| avinash.sakthivel@synergyship.com | member | 0 → 0 | 0 → 0 |
| chandru.k@synergyship.com | member | 0 → 0 | 0 → 0 |
| dhinesh.s@synergyship.com | admin | 0 → 0 | 0 → 0 |
| dinesh.baskaran@synergyship.com | admin | 0 → 0 | 0 → 0 |
| dineshkumar.s@synergyship.com | platform_admin | 0 → 0 | 0 → 0 |
| guru.k@synergyship.com | admin | 0 → 0 | 0 → 0 |
| jegan@glacien.ai | admin | 0 → 0 | 0 → 0 |
| pranavesh.s@synergyship.com | platform_admin | 0 → 0 | 0 → 0 |
| rajmohan.j@synergyship.com | platform_admin | 0 → 0 | 0 → 0 |
| reddivari.s@synergyship.com | admin | 0 → 0 | 0 → 0 |
| senthilnathan.s@synergyship.com | platform_admin | 0 → 0 | 0 → 0 |
| subhasini.d@synergyship.com | member | 0 → 0 | 0 → 0 |
| yadukrishnan@synergyship.com | admin | 0 → 0 | 0 → 0 |
| yukeshkumar.v@synergyship.com | member | 0 → 0 | 0 → 0 |
