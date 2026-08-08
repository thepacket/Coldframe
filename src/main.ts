import type { Artifact } from './types';
import { buildView, humanise, type View } from './model';
import { draw, hitTest, layout, type Hit, type Layout } from './panel';
import { readPalette, type Palette } from './theme';

// One locus for now. The artifact name is all the app needs; everything else
// travels inside it.
const LOCUS = 'flc';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const canvas = el<HTMLCanvasElement>('panel');
const stage = canvas.parentElement as HTMLElement;
const status = el<HTMLParagraphElement>('status');
const tooltip = el<HTMLDivElement>('tooltip');
const axisSelect = el<HTMLSelectElement>('axis');
const sitesInput = el<HTMLInputElement>('sites');
const siteCountOut = el<HTMLElement>('site-count');

let artifact: Artifact;
let view: View;
let box: Layout;
let palette: Palette = readPalette();

// --- theme ------------------------------------------------------------------

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset['theme'] = theme;
  localStorage.setItem('coldframe-theme', theme);
  const label = document.querySelector('[data-theme-label]');
  if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
  palette = readPalette();
  if (view) render();
}

applyTheme(
  (localStorage.getItem('coldframe-theme') as 'light' | 'dark' | null) ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
);

el('theme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark');
});

// --- rendering --------------------------------------------------------------

function render() {
  const available = stage.clientWidth - 40; // stage padding
  box = layout(view, available);

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(ctx, view, box, palette, artifact.genotypes, humanise(view.axis));
}

function rebuild() {
  const axis = axisSelect.value;
  const count = Number(sitesInput.value);
  siteCountOut.textContent = String(count);
  view = buildView(artifact, axis, count);
  render();
}

// --- tooltip ----------------------------------------------------------------

const fmt = (v: number, digits = 2) =>
  Number.isInteger(v) ? String(v) : v.toFixed(digits);

const GENOTYPE_NAME: Record<string, string> = {
  '0': 'reference',
  '1': 'heterozygous',
  '2': 'alternate',
  '.': 'not called',
};

function tooltipHtml(hit: Hit): string | null {
  if (!hit) return null;
  const axisLabel = humanise(view.axis);
  const column = hit.kind !== 'cline' ? (hit.col === null ? null : view.columns[hit.col]) : view.columns[hit.col];
  const site = column?.site;
  const where = site ? `${artifact.locus.chrom}:${site.pos.toLocaleString()}` : '';

  if (hit.kind === 'cline' && column && site) {
    return `<div class="tip-title">${where}</div>
      <div class="tip-sub">${site.ref} &rarr; ${site.alt}</div>
      <dl>
        <dt>r vs ${axisLabel}</dt><dd>${column.r.toFixed(3)}</dd>
        <dt>Alt frequency</dt><dd>${fmt(site.altFreq * 100, 1)}%</dd>
        <dt>Called in</dt><dd>${site.called} plants</dd>
      </dl>`;
  }

  if (hit.kind === 'band') {
    const band = view.bands[hit.band];
    if (!band) return null;
    const freq = column && hit.col !== null ? (band.freq[hit.col] ?? null) : null;
    return `<div class="tip-title">Climate band ${hit.band + 1} of ${view.bands.length}</div>
      <div class="tip-sub">${band.n} plants</div>
      <dl>
        <dt>${axisLabel}</dt><dd>${fmt(band.meanAxis)} mean</dd>
        ${site ? `<dt>At ${where}</dt><dd>${freq === null ? '&mdash;' : `${fmt(freq * 100, 1)}% alt`}</dd>` : ''}
      </dl>`;
  }

  if (hit.kind === 'row') {
    const row = view.rows[hit.row];
    if (!row) return null;
    const a = row.accession;
    const gt = site && artifact.genotypes
      ? (artifact.genotypes[column!.siteIndex]?.[row.gtIndex] ?? '.')
      : null;
    // `group` is an admixture group, not a place - a US accession can sit in
    // the Germany group, because North American Arabidopsis was introduced from
    // Europe. Labelling it next to the country would read as a contradiction.
    return `<div class="tip-title">${a.name}</div>
      <div class="tip-sub">${a.country} · accession ${a.id}</div>
      <dl>
        <dt>${axisLabel}</dt><dd>${fmt(row.axisValue)}</dd>
        ${a.group ? `<dt>Ancestry</dt><dd>${a.group}</dd>` : ''}
        <dt>Expression</dt><dd>${a.expression === null ? '&mdash;' : fmt(a.expression, 0)}</dd>
        ${a.lat !== null && a.lng !== null ? `<dt>Origin</dt><dd>${fmt(a.lat, 2)}, ${fmt(a.lng, 2)}</dd>` : ''}
        ${gt ? `<dt>At ${where}</dt><dd>${GENOTYPE_NAME[gt]}</dd>` : ''}
      </dl>`;
  }

  return null;
}

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(view, box, e.clientX - rect.left, e.clientY - rect.top);
  const html = tooltipHtml(hit);

  if (!html) {
    tooltip.hidden = true;
    return;
  }
  tooltip.innerHTML = html;
  tooltip.hidden = false;

  // Keep the card on screen without letting it sit under the cursor.
  const t = tooltip.getBoundingClientRect();
  const x = e.clientX + 16 + t.width > window.innerWidth ? e.clientX - t.width - 16 : e.clientX + 16;
  const y = Math.min(e.clientY + 16, window.innerHeight - t.height - 8);
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
});

canvas.addEventListener('mouseleave', () => { tooltip.hidden = true; });

// --- boot -------------------------------------------------------------------

async function loadArtifact(): Promise<Artifact> {
  for (const name of [`/${LOCUS}.json`, `/${LOCUS}.public.json`]) {
    const res = await fetch(name);
    if (res.ok) return (await res.json()) as Artifact;
  }
  throw new Error(
    `No artifact found.\n\nBuild one first:\n\n  ./scripts/fetch-raw.sh\n  node scripts/build-locus.mjs AT5G10140 5:3170000-3182000 FLC`,
  );
}

async function boot() {
  try {
    artifact = await loadArtifact();
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
    status.classList.add('error');
    return;
  }

  const { locus } = artifact;
  el('locus-label').textContent = locus.label;
  el('locus-gene').textContent = locus.gene;
  el('locus-coords').textContent =
    `${locus.chrom}:${locus.start.toLocaleString()}–${locus.end.toLocaleString()}`;
  el('locus-counts').textContent =
    `${artifact.accessions.length} accessions · ${artifact.sites.length} segregating sites`;

  // Strongest axis first - open on the most legible view rather than whichever
  // variable happens to sort first alphabetically.
  const strength = (axis: string) =>
    Math.max(0, ...(artifact.cline[axis] ?? []).map((r) => (r === null ? 0 : Math.abs(r))));
  const axes = Object.keys(artifact.cline).sort((a, b) => strength(b) - strength(a));

  for (const axis of axes) {
    const option = document.createElement('option');
    option.value = axis;
    option.textContent = `${humanise(axis)}  (max r ${strength(axis).toFixed(2)})`;
    axisSelect.append(option);
  }
  axisSelect.value = axes[0] ?? 'lat';

  status.hidden = true;
  el('locus-bar').hidden = false;
  el('controls').hidden = false;

  axisSelect.addEventListener('change', rebuild);
  sitesInput.addEventListener('input', rebuild);
  new ResizeObserver(() => { if (view) render(); }).observe(stage);

  rebuild();
}

void boot();
