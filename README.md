# Signature Trace

Signature Trace turns a pasted or dropped bitmap signature into a clean SVG entirely in the browser. The image is thresholded and cropped locally, then traced by the Potrace algorithm compiled to WebAssembly.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, then paste an image with `Ctrl+V` / `⌘V`, drop it onto the preview, or choose a file.

## Build a portable copy

```bash
npm run build
```

The production build is a single self-contained file at `dist/index.html`. It can be served by any static server. Current Chromium can also open that file directly; using `http://localhost` gives the Paste button full Clipboard API access.

For a simple local server:

```bash
npm run preview
```

## Publish to GitHub Pages

The public site is built into `docs/`, including the custom-domain `CNAME` file:

```bash
npm run build:pages
```

GitHub Pages publishes the `docs/` directory from the `main` branch. The production domain is `https://sigconv.dxsolutions.com`; its DNS CNAME target is `oliver-c1b.github.io`.

## Test

```bash
npm test
npm run build
```

## Privacy and limits

- No image is uploaded. Decoding, preprocessing, tracing, previewing, copying, and downloading happen locally.
- Very large images are reduced to at most 5,000 pixels on an edge and 20 megapixels before tracing.
- Input is limited to 40 MB to avoid exhausting browser memory.
- Potrace produces monochrome vector paths. The output ink colour is selectable and its background is transparent.

## Licensing

This project is distributed under GPL-2.0-or-later because it incorporates Potrace through `esm-potrace-wasm`. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). SVG files generated from your own input are output of the program; the project license does not claim ownership of them.
