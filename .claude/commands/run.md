---
description: Launch the Terrible Traffic app in the default browser
---

Launch the app by opening `index.html` in the user's default browser. It is a
static page (no build step), so just open the file directly:

```
Start-Process "index.html"
```

Run that from the repo root via the PowerShell tool, then confirm it launched.
Do not rebuild, edit, or start a server — opening the file is all that's needed.
