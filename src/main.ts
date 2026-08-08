import type { Artifact } from './types';
import { buildView, humanise, type View } from './model';
import { ancestryColor, ancestryLabel, ancestryOrder } from './ancestry';
import { drawExpression, expressionHeight } from './expression';
import { drawMap, mapAspect, pickPoint, type MapPoint } from './map';
import { draw, hitTest, layout, type Hit, type Layout } from './panel';
import { readPalette, type Palette } from './theme';

/** One row of data/derived/index.json, written by scripts/build-all.mjs. */
interface IndexEntry {
  label: string;
  gene: string;
  title: string;
  note: string;
  file: string;
  chrom: string;
  start: number;
  end: number;
  accessions: number;
  sites: number;
  best: { axis: string; r: number; pos: number } | null;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const canvas = el<HTMLCanvasElement>('panel');
const mapCanvas = el<HTMLCanvasElement>('map');
const exprCanvas = el<HTMLCanvasElement>('expression');
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
/** Sticky across loci once chosen, so you can hold one axis and compare genes. */
let chosenAxis: string | null = null;
/** Index into artifact.sites - the site the map is drawing. */
let selectedSite: number | null = null;
let mapPoints: MapPoint[] = [];

// --- theme ------------------------------------------------------------------

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset['theme'] = theme;
  localStorage.setItem('coldframe-theme', theme);
  const label = document.querySelector('[data-theme-label]');
  if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
  palette = readPalette();
  if (view) render();
}

// Dark by default, deliberately - not a follow-the-system fallback. The panel
// is a dense field of colour-as-data, and it holds contrast better against a
// dark ground. Light stays available and honours a previous choice.
applyTheme((localStorage.getItem('coldframe-theme') as 'light' | 'dark' | null) ?? 'dark');

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
  draw(ctx, view, box, palette, artifact.genotypes, humanise(view.axis), selectedSite);
  renderMap();
  renderExpression();
}

/**
 * Expression split by genotype at the selected site. Like the map, this needs
 * per-accession calls and so is absent from a --public build.
 */
function renderExpression() {
  const card = el('response');
  if (!artifact.genotypes || selectedSite === null) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const w = Math.max(420, stage.clientWidth - 40);
  const h = expressionHeight;
  const dpr = window.devicePixelRatio || 1;
  exprCanvas.width = Math.round(w * dpr);
  exprCanvas.height = Math.round(h * dpr);
  exprCanvas.style.width = `${w}px`;
  exprCanvas.style.height = `${h}px`;

  const ctx = exprCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const result = drawExpression(
    ctx, w, h, palette,
    artifact.accessions,
    artifact.genotypes[selectedSite],
    view.axis,
  );

  const site = artifact.sites[selectedSite];
  el('response-r').textContent =
    result.r === null ? '' : `dosage vs expression r = ${result.r.toFixed(3)}`;
  el('response-caveat').textContent =
    `${site ? `At ${artifact.locus.chrom}:${site.pos.toLocaleString()}. ` : ''}` +
    'Rosette leaf, measured once under ambient conditions — so this is an ' +
    'association with expression level, not a response: nothing was done to ' +
    'these plants. Dots carry the climate each accession came from, because if ' +
    'one allele is also the cold-origin allele, the confound is the finding. ' +
    'Heterozygotes are near-absent throughout: Arabidopsis is highly selfing.';
}

/**
 * The map needs per-accession calls, so it only exists in a local build. A
 * --public artifact can state the cline but cannot place it on the ground.
 */
function renderMap() {
  const atlas = el('atlas');
  if (!artifact.genotypes || selectedSite === null) {
    atlas.hidden = true;
    return;
  }
  atlas.hidden = false;

  const w = Math.max(320, Math.min(720, stage.clientWidth - 340));
  const h = Math.round(w / mapAspect);
  const dpr = window.devicePixelRatio || 1;
  mapCanvas.width = Math.round(w * dpr);
  mapCanvas.height = Math.round(h * dpr);
  mapCanvas.style.width = `${w}px`;
  mapCanvas.style.height = `${h}px`;

  const ctx = mapCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const site = artifact.sites[selectedSite];
  const result = drawMap(ctx, w, h, palette, artifact.accessions, artifact.genotypes[selectedSite]);
  mapPoints = result.points;
  if (!site) return;

  const r = artifact.cline[view.axis]?.[selectedSite] ?? null;
  el('map-site').innerHTML =
    `${artifact.locus.chrom}:${site.pos.toLocaleString()}<span>${site.ref} &rarr; ${site.alt}</span>`;
  const rWithin = artifact.clineWithin?.[view.axis]?.[selectedSite] ?? null;
  el('map-stats').innerHTML = `
    <dt>r vs ${humanise(view.axis)}</dt><dd>${r === null ? '&mdash;' : r.toFixed(3)}</dd>
    <dt>within ancestry</dt><dd>${
      rWithin === null || r === null
        ? '&mdash;'
        : `${rWithin.toFixed(3)} (${Math.round((rWithin / r) * 100)}% kept)`
    }</dd>
    <dt>r vs expression</dt><dd>${site.exprR === null ? '&mdash;' : site.exprR.toFixed(3)}</dd>
    <dt>Alt frequency</dt><dd>${(site.altFreq * 100).toFixed(1)}%</dd>
    <dt>Called in</dt><dd>${site.called} plants</dd>
    <dt>On the map</dt><dd>${mapPoints.length} plants</dd>`;
  el('map-hint').textContent =
    `Click any column below to change site.` +
    (result.offMap
      ? ` ${result.offMap} accessions fall outside the native range and are not drawn — Arabidopsis in North America is introduced, carrying European genotypes without having adapted locally.`
      : '');
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
        <dt>within ancestry</dt><dd>${
          column.rWithin === null
            ? '&mdash;'
            : `${column.rWithin.toFixed(3)} (${Math.round((column.rWithin / column.r) * 100)}% kept)`
        }</dd>
        <dt>Alt frequency</dt><dd>${fmt(site.altFreq * 100, 1)}%</dd>
        <dt>r vs expression</dt><dd>${site.exprR === null ? '&mdash;' : site.exprR.toFixed(3)}</dd>
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
        ${band.groups.slice(0, 3).map(([g, share]) =>
          `<dt>${ancestryLabel(g)}</dt><dd>${Math.round(share * 100)}%</dd>`).join('')}
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

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(view, box, e.clientX - rect.left, e.clientY - rect.top);
  const col = hit && hit.col !== undefined ? hit.col : null;
  if (col === null) return;
  const column = view.columns[col];
  if (!column) return;
  selectedSite = column.siteIndex;
  render();
});

mapCanvas.addEventListener('mousemove', (e) => {
  const rect = mapCanvas.getBoundingClientRect();
  const point = pickPoint(mapPoints, e.clientX - rect.left, e.clientY - rect.top);
  if (!point) { tooltip.hidden = true; return; }

  const a = point.accession;
  tooltip.innerHTML = `<div class="tip-title">${a.name}</div>
    <div class="tip-sub">${a.country} · accession ${a.id}</div>
    <dl>
      <dt>Genotype</dt><dd>${GENOTYPE_NAME[point.genotype]}</dd>
      ${a.group ? `<dt>Ancestry</dt><dd>${a.group}</dd>` : ''}
      <dt>Origin</dt><dd>${fmt(a.lat as number, 2)}, ${fmt(a.lng as number, 2)}</dd>
      <dt>${humanise(view.axis)}</dt><dd>${
        (view.axis === 'lat' ? a.lat : a.climate[view.axis]) === null
          ? '&mdash;'
          : fmt((view.axis === 'lat' ? a.lat : a.climate[view.axis]) as number)
      }</dd>
    </dl>`;
  tooltip.hidden = false;
  const t = tooltip.getBoundingClientRect();
  const x = e.clientX + 16 + t.width > window.innerWidth ? e.clientX - t.width - 16 : e.clientX + 16;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, Math.min(e.clientY + 16, window.innerHeight - t.height - 8))}px`;
});

mapCanvas.addEventListener('mouseleave', () => { tooltip.hidden = true; });

// --- boot -------------------------------------------------------------------

/**
 * Rebuild the axis list for the loaded locus. Ordered by how strong a cline
 * each axis produces here, so the default opens on something worth looking at
 * rather than whatever sorts first alphabetically.
 */
function populateAxes() {
  const strength = (axis: string) =>
    Math.max(0, ...(artifact.cline[axis] ?? []).map((r) => (r === null ? 0 : Math.abs(r))));
  const axes = Object.keys(artifact.cline).sort((a, b) => strength(b) - strength(a));

  axisSelect.replaceChildren();
  for (const axis of axes) {
    const option = document.createElement('option');
    option.value = axis;
    option.textContent = `${humanise(axis)}  (max r ${strength(axis).toFixed(2)})`;
    axisSelect.append(option);
  }
  axisSelect.value =
    chosenAxis && axes.includes(chosenAxis) ? chosenAxis : (axes[0] ?? 'lat');
}

async function selectLocus(entry: IndexEntry) {
  const res = await fetch(`/${entry.file}`);
  if (!res.ok) throw new Error(`could not load ${entry.file}`);
  artifact = (await res.json()) as Artifact;

  el('locus-label').textContent = entry.label;
  el('locus-gene').textContent = entry.gene;
  el('locus-coords').textContent =
    `${entry.chrom}:${entry.start.toLocaleString()}–${entry.end.toLocaleString()}`;
  el('locus-counts').textContent =
    `${artifact.accessions.length} accessions · ${artifact.sites.length} segregating sites`;

  const note = el('locus-note');
  note.textContent = `${entry.title}. ${entry.note}`;
  note.hidden = false;

  for (const button of document.querySelectorAll<HTMLButtonElement>('.loci button')) {
    button.setAttribute('aria-current', String(button.dataset['label'] === entry.label));
  }

  const legend = el('ancestry-legend');
  legend.replaceChildren();
  for (const group of ancestryOrder(artifact.ancestry ?? [])) {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = ancestryColor(group);
    item.append(swatch, document.createTextNode(ancestryLabel(group)));
    legend.append(item);
  }

  populateAxes();

  // Open on the strongest site for the chosen axis, so the map shows the
  // locus at its most legible rather than at whichever site sorts first.
  const rs = artifact.cline[axisSelect.value] ?? [];
  selectedSite = null;
  rs.forEach((r, i) => {
    if (r === null) return;
    const best = selectedSite === null ? null : rs[selectedSite];
    if (best === null || best === undefined || Math.abs(r) > Math.abs(best)) selectedSite = i;
  });

  rebuild();
}

async function boot() {
  let loci: IndexEntry[];
  try {
    const res = await fetch('/index.json');
    if (!res.ok) throw new Error('no index');
    loci = ((await res.json()) as { loci: IndexEntry[] }).loci;
    if (loci.length === 0) throw new Error('index is empty');
  } catch {
    status.textContent =
      'No loci found.\n\nBuild them first:\n\n  ./scripts/fetch-raw.sh\n  node scripts/build-all.mjs';
    status.classList.add('error');
    return;
  }

  const nav = el('loci');
  for (const entry of loci) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.label;
    button.dataset['label'] = entry.label;
    button.title = entry.title;
    button.addEventListener('click', () => void selectLocus(entry));
    nav.append(button);
  }

  status.hidden = true;
  nav.hidden = false;
  el('locus-bar').hidden = false;
  el('controls').hidden = false;
  el('ancestry-key').hidden = false;

  axisSelect.addEventListener('change', () => {
    chosenAxis = axisSelect.value;
    rebuild();
  });
  sitesInput.addEventListener('input', rebuild);
  new ResizeObserver(() => { if (view) render(); }).observe(stage);

  // build-all sorts the index by strongest cline, so the first entry leads.
  await selectLocus(loci[0] as IndexEntry);
}

void boot();
