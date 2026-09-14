# Design language for CRM development

Use this as the visual reference when building a CRM feature that should feel related to the refreshed CAO Partners website. The website is plain HTML, CSS and JavaScript; the visual rules can be adapted to the CRM's framework without importing the entire page.

## Core palette

These are existing values from `styles.css`:

| Use | Value |
|---|---|
| Main background | `#061318` |
| Deep green section surface | `#0b252a` |
| Default text | `#f0f4f1` |
| Mint accent | `#b4e7cf` |
| Muted text | `#9aaeb1` |
| Hairline border | `#ffffff29` |
| Light card ink | `#163b32` |
| Dark card gradient | `#214a43` → `#112d2e` |
| Selected card gradient | `#e0efda` → `#b9d9cc` → `#a9cbbd` |

Use dark green surfaces, mint highlights and restrained borders. The light mint card is a strong selection signal, so reserve it for a focused or selected item. Retain clear text contrast instead of carrying low-opacity decorative styling into labels or data.

## Typography and layout

- **Display:** Barlow Condensed, weights 500–700. Used for bold condensed headings and prominent numbers, often uppercase.
- **Body/UI:** DM Sans, weights 400–600. Used for descriptions, navigation, labels and controls.
- The website imports both from Google Fonts. Follow the CRM's existing font-loading setup rather than adding duplicate imports.
- For CRM screens, use display typography for page titles and headline metrics; use DM Sans for tables, forms, navigation and dense records.
- Keep body text around 14–16px with comfortable line height. Avoid the website's oversized hero scale in everyday CRM controls.
- Use generous spacing around headings, clear alignment and thin dividers. On narrow screens, stack columns and keep copy outside animated areas.

## Cards and controls

- Floating cards use 20–24px corner radii, a faint inset border, subtle gradients and soft shadows. See `.tier-face` and `.review-front` in `styles.css`.
- Active cards move to the front and use mint backgrounds with dark green text; surrounding cards remain darker.
- Pill selectors show the selected state explicitly. Preserve keyboard focus outlines and accessible state labels when adapting them.
- Use at least 44px touch targets for important controls.
- Portraits use 22px rounded corners on desktop and 18px on mobile.
- Logos retain their proportions and transparent backgrounds. `.review-business-mark` shows how monochrome SVG masks inherit the card's text colour; coloured product logos remain recognisable.

## Node appearance

The nodes are small faceted glass/metal forms, connected by fine teal lines. They use the same geometry and lighting family throughout the page.

Reference implementation: `founder-swarm.js` and `continuity-swarms.js`.

```js
new THREE.IcosahedronGeometry(1, 2)
new THREE.MeshPhysicalMaterial({
  color: 0x8eb7b8,
  roughness: 0.28,
  metalness: 0.62,
  clearcoat: 0.65,
  clearcoatRoughness: 0.3
})
```

Highlights use pale mint, secondary nodes use muted teal, and connections stay thin and translucent. The material relies on the included RoomEnvironment and scene lighting; copying the material alone will not reproduce the full appearance.

## Motion language

- Nodes gather, connect, branch, match and settle. Tie these behaviours to the meaning of the feature.
- Opening scene: scroll-driven transformation of one large swarm.
- Founder entrances: a quick swarm push from either side, followed by quiet edge movement.
- Vetting: a formation changes as the reader reaches each checkpoint.
- Talent cards: a 750ms eased selection transition and slow, subtle floating. No automatic tier switching.
- Testimonials: a floating fan with a four-second auto cycle and pause controls.
- Article illustrations: gentle movement, with a stronger response to hover or keyboard focus.

For a CRM, suitable adaptations include a small node formation in an empty state, a brief connection pulse after an actual successful action, or a node path showing real workflow stages. Do not imply that an AI operation or processing step is happening unless it is connected to real application state. Keep decorative motion away from table rows, text inputs and editing surfaces.

## Integration and mobile behaviour

The website's scripts are coupled to its DOM and specific IDs. Treat them as reference implementations, not drop-in CRM components. Rebuild a small component around the CRM's actual lifecycle and keep styling scoped so the website's global selectors do not override CRM controls.

Use one shared renderer where practical. The preview shares the later sections' geometry, material and WebGL canvas, updates only visible scenes, reduces node counts on mobile, and stops motion when the page is hidden. Preserve those behaviours when extracting a component.

Respect `prefers-reduced-motion`. Keep every action and piece of information usable when animation is paused or WebGL is unavailable. Mobile interactions should work with touch and scrolling, not depend on hover. Use dedicated illustration space above text instead of drawing particles across the reading area.

Preserve `vendor/THREE-LICENSE.txt` if redistributing the bundled Three.js files.
