# CAOP Website Redesign V3.0

A standalone design reference for CAO Partners' website refresh and CRM feature development. This is a snapshot of the latest preview, including the site-wide node animations, saved on 14 September 2026.

**Start here:** [Design language and CRM handoff](DESIGN-LANGUAGE.md)

**Interactive preview:** https://cao-partners-original-copy-preview.michael675624.chatgpt.site/

## Run locally

From this folder, start a static HTTP server:

```sh
python3 -m http.server 4174 --bind 127.0.0.1
```

Open http://127.0.0.1:4174/. Use an HTTP server rather than opening `index.html` directly: the animations use JavaScript modules. Google Fonts needs internet access; local font fallbacks are provided. Three.js and the visual assets are included.

An optional production-style static build requires Node.js:

```sh
npm run build
python3 -m http.server 4174 --bind 127.0.0.1 --directory dist
```

No npm dependency installation is needed for this snapshot. Generated `dist/` output is ignored by Git.

## Source map

| File | Purpose |
|---|---|
| `index.html` | Original business copy, page structure, client/tool logos and demo forms |
| `styles.css` | Colours, typography, responsive layouts and card treatments |
| `app.js` | Navigation, demo forms, floating talent deck and disclosure behaviour |
| `sculpture.js` | Opening five-chapter 3D node experience |
| `founder-swarm.js` | Founder entrances and the shared renderer for later node scenes |
| `point-swarms.js` | Role and process node illustrations |
| `continuity-swarms.js` | Vetting, candidates, insights, tool connections, transitions and footer |
| `reviews.js` | Floating testimonial deck, audience selection and full-review dialog |
| `logo-flight.js` | Client logos moving towards the viewer in the closing section |
| `assets/` | Logos, portraits and other supplied imagery |
| `vendor/` | Bundled Three.js, RoomEnvironment and Three.js licence |

## Reference scope

This folder is self-contained and lives on the `design-reference/caop-website-redesign-v3` branch. Existing website files and the repository's root Netlify configuration are unchanged. The reference commit includes `[skip netlify]` to skip Netlify deployment. It is not merged into `main`.

The preview's forms are demonstrations: they do not send or save submissions. Reuse the presentation in the CRM, then connect it to the CRM's existing authentication, data model and form handling. Client logos, portraits, testimonials and business claims belong to the website context; they are not generic CRM sample data.

Sites hosting configuration, source credentials, local Git metadata and generated output are intentionally excluded. No change to the hosted preview is made by adding this reference folder.

## Snapshot and restore point

- Preview source revision: `f88a531e90292921d067e4e5e63dbecf9bfff073` (the separate preview repository).
- Preview version: 20, after adding the site-wide node continuity.
- Previous design restore point: “Before site-wide node continuity — 14 September 2026,” preview version 19. Its source ZIP and deployable archive remain saved in the original Codex workspace; the previously published version is also retained in Sites.

Keep changes for the CRM in the CRM project. This folder documents the website design at the time of handoff.
