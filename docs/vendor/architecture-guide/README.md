# Architecture guide offline vendor cache

Cached CDN files used to build **one offline `architecture-guide.html`** (~13 MB).

- First build downloads missing files (needs network).
- Commit this folder so teammates can rebuild without re-downloading.

Regenerate the guide:

```bash
node scripts/embed-architecture-guides.mjs
```

Open **`architecture-guide.html`** in a browser (file:// or any host). No CDN required.
