# LocalSign 本地安全签名

[![License: MIT](https://img.shields.io/badge/license-MIT-101820.svg)](LICENSE)
![Local First](https://img.shields.io/badge/local--first-yes-0f5c66.svg)
![No Backend](https://img.shields.io/badge/backend-none-c08b3e.svg)
![Client Side](https://img.shields.io/badge/documents-stay%20in%20browser-224f9c.svg)
![Self Host](https://img.shields.io/badge/self--host-ready-c08b3e.svg)

LocalSign is a lightweight browser app for signing documents locally and safely. It was built for a common workflow: many documents need a handwritten signature, but printing, signing, scanning, and photographing them wastes time. Hosted signing services can be convenient, yet uploading private contracts or forms creates avoidable risk. This project keeps the signing flow local, open source, and easy to self host.

## Demo

Production deployment:

```text
https://online-signature-fawn.vercel.app
```

## Features

- Sign blank pages, images, and PDF files directly in the browser.
- Move the signature box to the exact area of the document.
- Use an enlarged signature pad for smoother mouse signing.
- Save one reusable signature locally for repeated documents.
- Export transparent signature PNGs.
- Export signed image files and signed PDF files.
- Keep document processing client side with no application backend.

## Privacy Model

LocalSign is designed as a local first tool.

- Files are read by the browser with `FileReader`.
- Signatures and PDF overlays are generated in the browser.
- The reusable signature is stored in `localStorage` on the same browser.
- There is no app server, database, analytics SDK, account system, or upload endpoint.

The hosted demo still loads PDF rendering libraries from cdnjs. For stricter offline or internal deployment, vendor those libraries locally and update the script tags in `index.html`.

## Quick Start

Clone the repository and run a static file server:

```bash
git clone https://github.com/cclank/localsign.git
cd localsign
python3 -m http.server 5173
```

Open:

```text
http://127.0.0.1:5173
```

You can also open `index.html` directly in a browser, although serving over `http://127.0.0.1` is more reliable for PDF libraries.

## Self Hosting

This is a static app. Any static host can serve it:

- Vercel
- GitHub Pages
- Netlify
- Cloudflare Pages
- Nginx
- A local intranet file server

No environment variables are required.

## Security Notes

- Do not commit `.env`, `.vercel`, private documents, generated signed files, or browser data.
- Review CDN usage before deploying in sensitive environments.
- Prefer an internal static host when signing confidential business documents.
- Clear the browser's site data if you no longer want to keep the reusable local signature.

## Project Structure

```text
.
├── index.html
├── styles.css
├── app.js
├── vercel.json
├── package.json
└── README.md
```

## Development

```bash
npm run check
npm run dev
```

## Deployment

For Vercel, deploy the repository as a static project. The included `vercel.json` adds basic browser security headers. No build command is required.

## License

MIT
