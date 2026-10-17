# Cursor + Databricks setup (for teammates)

Short guide to work with **Databricks directly from Cursor** (Agent terminal + Databricks plugin). This is **separate** from ALOFT app credentials in `.env` (service principal for Inspector/harvester).

**Time:** ~15 minutes  
**You need:** Databricks workspace access (your user login), Cursor installed

---

## 1. What you get

| Piece | Purpose |
|-------|---------|
| **Databricks CLI** (v0.292+) | Run SQL, list catalogs, jobs, bundles from terminal |
| **Cursor Databricks plugin** | Agent loads Databricks skills and uses the CLI correctly |
| **OAuth profile** in `~/.databrickscfg` | Your personal workspace login (browser) |

There is no separate “Databricks connection” screen in Cursor. Auth is **CLI profiles**.

---

## 2. Install Databricks CLI (Windows)

**Recommended (WinGet):**

```powershell
winget install Databricks.DatabricksCLI
```

Close and reopen the terminal (or Cursor), then check:

```powershell
databricks --version
```

Expect **0.292.0 or higher** (e.g. 1.x).

### If you also have Anaconda

An old `databricks` (Python **0.18.x**) may appear first on PATH. Either:

- Remove/rename `anaconda3\Scripts\databricks.exe`, or  
- Put the WinGet CLI folder **before** Anaconda on PATH, or  
- Call the full path to the WinGet `databricks.exe`.

If you see “Executing CLI v1.x…” after a warning, the newer CLI is still running — OK for daily use.

**macOS:** `brew tap databricks/tap && brew install databricks`  
**Linux:** see [Databricks CLI install](https://docs.databricks.com/en/dev-tools/cli/install.html).

---

## 3. Enable Databricks in Cursor

1. Open **Cursor Settings** → **Plugins** (or Extensions marketplace).
2. Install / enable the official **Databricks** plugin for Cursor (if not already present).
3. No API keys in Cursor settings — the plugin expects the **CLI + profiles** below.

When you ask the Agent Databricks questions, it should use `databricks … --profile <name>` (not ad-hoc PATs unless you choose that path).

---

## 4. Log in (OAuth)

Use a **descriptive profile name** (not `DEFAULT` unless you insist). Example for Synergy workspace:

```powershell
databricks auth login --host https://synergymarinegroup.azuredatabricks.net --profile synergy
```

1. Browser opens → sign in with your **Databricks / Entra** user.  
2. Allow the redirect back to the CLI.  
3. You should see: `Profile synergy was successfully saved`.

**Other workspace?** Replace `--host` with your workspace URL (from Databricks UI: workspace name → copy URL, no trailing path).

Verify:

```powershell
databricks auth profiles
databricks current-user me --profile synergy
```

`auth profiles` should show **Valid: YES** for your profile.

Credentials file (do not commit): `%USERPROFILE%\.databrickscfg` (Windows) or `~/.databrickscfg` (Mac/Linux).

---

## 5. Smoke tests

```powershell
databricks warehouses list --profile synergy
databricks catalogs list --profile synergy
databricks experimental aitools tools query "SELECT 1 AS ok" --profile synergy
```

If any command fails with auth errors, re-run `databricks auth login` for that profile.

---

## 6. Using Cursor Agent

- **Always pass `--profile synergy`** (or your profile) on each CLI command in chat. Agent shells do not keep `export DATABRICKS_CONFIG_PROFILE` between steps.
- **Good:** `databricks jobs list --profile synergy`
- **Risky:** `export DATABRICKS_CONFIG_PROFILE=synergy` in one message and a bare `databricks jobs list` in the next.

Optional: install the **Databricks** VS Code extension in Cursor for UI (SQL warehouses, notebooks) — still uses the same workspace login.

---

## 7. Not the same as ALOFT local dev

| | Cursor + CLI | ALOFT app (`aloft-d360`) |
|--|----------------|---------------------------|
| Who | Your user (OAuth) | Service principal (M2M) |
| Config | `~/.databrickscfg` | `.env`: `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH` |
| Docs | This file | [databricks-auth-and-usage.md](./databricks-auth-and-usage.md) |

You can use both on one machine; they do not replace each other.

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Valid: NO` on profile | `databricks auth login --host … --profile …` again |
| `cannot configure default credentials` | No valid default profile — use `--profile` or log in |
| Wrong CLI version / weird errors | Fix PATH; confirm `databricks --version` ≥ 0.292 |
| Browser callback blocked | Run `auth login` in an external PowerShell, not a restricted sandbox |
| `401` / access denied on SQL | Ask admin for warehouse + Unity Catalog grants for your user |

---

## 9. Checklist (hand to a new teammate)

- [ ] Cursor installed  
- [ ] Databricks CLI ≥ 0.292 (`databricks --version`)  
- [ ] Databricks plugin enabled in Cursor  
- [ ] `databricks auth login` completed; profile shows **Valid: YES**  
- [ ] `SELECT 1` query succeeds with `--profile`  
- [ ] (If working on ALOFT app) separate `.env` M2M vars per [databricks-auth-and-usage.md](./databricks-auth-and-usage.md) — optional for Cursor-only work  

---

**Maintainer:** Platform / data engineering  
**Related:** [databricks-auth-and-usage.md](./databricks-auth-and-usage.md) (ALOFT app only)
