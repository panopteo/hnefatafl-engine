# Hnefatafl Engine (Copenhagen Rules)

Single-page static web implementation of Copenhagen Hnefatafl:

- 11×11 board with standard Copenhagen setup
- Playable in the browser with lichess-inspired UI
- Choose to play attackers or defenders, restart anytime
- Random-move AI (v1) that responds instantly
- Highlighted legal moves, captures, AI moves, and move transcript
- Full rules support: king capture rules, restricted squares, shieldwall capture, encirclement, exit fort detection, no-move losses, repetition loss for defenders

## Local development

No build tools required—open `index.html` in any modern browser. For quick preview with a local server:

```bash
cd hnefatafl-engine
python -m http.server 8000
# visit http://localhost:8000
```

## Deployment (GitHub Pages)

Build is handled via GitHub Actions:

1. Push to `main` → workflow uploads the repository root as the artifact.
2. Pages deploys from the workflow output to the `gh-pages` branch automatically.
3. Site URL: `https://panopteo.github.io/hnefatafl-engine/` (once Pages enabled).

## Repository setup checklist

1. `git init` + add files + commit.
2. Create repo `panopteo/hnefatafl-engine` on GitHub (org admin required).
3. Add remote: `git remote add origin https://github.com/panopteo/hnefatafl-engine.git`.
4. Push `main`.
5. In GitHub → Settings → Pages → Build & deployment: Source = GitHub Actions.
6. Wait for `pages.yml` workflow to finish; confirm published site.
