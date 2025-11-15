# Cartes

[capecl.fr/cartes](https://capecl.fr/cartes)

Flashcards CapECL

---

## Frontend build & caching

- `index.html` stays un-cached thanks to the existing meta headers, but the CSS/JS shipped to browsers now use content-hashed filenames under `assets/`. Those files can be served with very aggressive cache headers (e.g. `Cache-Control: public, max-age=31536000, immutable`).
- Run `npm run build:assets` whenever `styles.css` or `app.js` changes. The script copies the sources to `assets/`, names them with a 12-character hash, updates the auto-managed block inside `index.html`, and refreshes `asset-manifest.json`. Older hashed copies are removed automatically to avoid git conflicts.
- Run `npm run check:assets` to make sure the committed files match the current sources; this exits non-zero if someone forgot to run the build step.
- GitHub Actions now includes **Hashed Asset Guard**, which only triggers for commits/pull requests that touch the CSS/JS/build files. It first runs the check; if it fails (meaning the build was skipped locally) the workflow runs the build in CI purely for diagnostics and then fails with guidance instead of rewriting history.

---

## License

This repository contains two distinct parts under different licenses:

- **Code (everything except `flashcards/`):**  
  Licensed under the [MIT License](./LICENSE).  
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **Flashcards (the contents of the `flashcards/` directory):**  
  Licensed under the [GNU Free Documentation License v1.3](./LICENSE-FLASHCARDS).  
  [![License: FDL 1.3](https://img.shields.io/badge/License-FDL%20v1.3-blue.svg)](https://www.gnu.org/licenses/fdl-1.3)

---

Users and contributors must respect both licenses.  
In particular, any redistribution or modification of the flashcards must comply with the terms of the GNU Free Documentation License.
