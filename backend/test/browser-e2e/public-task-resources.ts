import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getGeoGebraBundleCurrentDir } from "../../src/admin/geogebra-bundle.util";

export async function preparePublicTaskResources(): Promise<void> {
  const directory = getGeoGebraBundleCurrentDir();
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "publication-probe.json"),
    '{"available":true}',
  );
  await writeFile(
    join(directory, "publication-probe.js"),
    "export const available = true;",
  );
}

// Exercise actual browser CORS for all three common resource loading mechanisms.
export const publicTaskResourceProbe = Buffer.from(`<script>
(() => {
  const base = new URL('/api/shared-assets/GeoGebra/', document.baseURI).href;
  const xhrRead = new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', base + 'publication-probe.json');
    xhr.onload = () => xhr.status === 200 && JSON.parse(xhr.responseText).available ? resolve(true) : reject();
    xhr.onerror = reject;
    xhr.send();
  });
  Promise.all([
    fetch(base + 'publication-probe.json').then(response => response.json()).then(data => data.available),
    xhrRead,
    import(base + 'publication-probe.js').then(module => module.available)
  ]).then(results => {
    document.documentElement.dataset.publicTaskResources = results.every(Boolean) ? 'ready' : 'failed';
  }).catch(() => { document.documentElement.dataset.publicTaskResources = 'failed'; });
})();
</script>`);
