# vendor/

Third-party libraries checked into the repo instead of loaded from a CDN.

## papaparse.min.js

- Version: **5.2.0** (see the license header at the top of the file)
- Source: https://github.com/mholt/PapaParse
- Why vendored: self-hosted so `Papa.parse(..., { worker: true })` constructs
  its Web Worker from a same-origin script. A cross-origin worker's success
  depends on the CDN's CORS headers and isn't guaranteed — see the comment
  above the `<script>` tag in `index.html`.

To update: download the new `papaparse.min.js` from a tagged release at the
URL above, replace this file, and bump the version noted here.
