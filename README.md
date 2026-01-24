# Cartes

[capecl.fr/cartes](https://capecl.fr/cartes)

Flashcards CapECL

---

## Setup

To run the site locally after cloning:

1. Install Node.js 20+.
2. Install dependencies:
   - `npm ci`

If you plan to regenerate flashcards locally, install Python 3.11+ and the script dependencies:
- `pip install pymupdf pillow numpy`

## Development

- `npm run dev` starts the Vite dev server with HMR (default: http://localhost:3000).
- `npm run build` outputs the production build to `dist/`.
- `npm run preview` serves the built output locally for a production-like check.

## Updating flashcards

Quick path (just push the PDF, GitHub Actions regenerates + deploys):

1. Drop the updated PDF into `flashcards/`.
2. Commit and push to `main`.

Recommended path (verify locally before pushing):

1. Drop the updated PDF into `flashcards/`.
2. Run the generator from the repo root and pick the PDF:
   - `python cartes.py`
3. Review the generated assets in `flashcards/<pdf-name>/` (images + `manifest.json`) and commit.
4. Run `npm run build` then `npm run preview` to verify the site locally.
5. Push to `main`.

## Code quality

- `npm run lint` runs ESLint on `src/`.
- `npm run format` and `npm run format:check` run Prettier on `src/`.

## Deployment

- Only the `dist/` folder is deployed to production.
- `.htaccess` lives in `public/`, so Vite copies it into `dist/` during the build (important).
- GitHub Actions includes a **Deploy Dist** workflow that builds on push to `main` and publishes `dist/` to the `deploy` branch.
- Hosting is linked to the `deploy` branch via webhook, so updates go live automatically.

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
