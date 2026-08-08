import lociDef from '../loci.json';
import { getArtifact } from './data/loader';
import type { LocusDef } from './data/compute';
import type { Artifact } from './types';
import { buildView, humanise, type RankBy, type View } from './model';
import { ancestryColor, ancestryLabel, ancestryOrder } from './ancestry';
import { drawExpression, expressionHeight } from './expression';
import { drawMap, mapAspect, pickPoint, type MapPoint } from './map';
import { draw, hitTest, layout, type Hit, type Layout } from './panel';
import { readPalette, type Palette } from './theme';

const LOCI = lociDef as LocusDef[];
const ALL_GENES = LOCI.map((l) => l.gene);
/** Guards against a slow load finishing after the user has moved on. */
let loadSeq = 0;

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
const rankSelect = el<HTMLSelectElement>('rank');
const siteCountOut = el<HTMLElement>('site-count');

let artifact: Artifact;
let view: View;
let box: Layout;
let palette: Palette = readPalette();
/** Sticky across loci once chosen, so you can hold one axis and compare genes. */
let chosenAxis: string | null = null;
/** Index into artifact.sites - the site the map is drawing. */
let selectedSite: number | null = null;
/**
 * The focused plant, held as an accession id rather than a row index: rows are
 * ordered by the current axis, so an index would silently point at a different
 * plant the moment the ordering changed.
 */
let selectedAccession: string | null = null;
/** Focused climate band, when the bands section holds the vertical cursor. */
let selectedBand: number | null = null;
/**
 * Which section up and down move in. Set by whichever you last clicked, so the
 * vertical keys act on the plot you are actually looking at rather than always
 * on the accessions.
 */
let verticalFocus: 'accessions' | 'bands' = 'accessions';
let mapPoints: MapPoint[] = [];
/** Until the slider is touched, it tracks the maximum rather than a fixed count. */
let siteCountTouched = false;

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

/** Where the focused plant sits in the current ordering, or null. */
function focusedRow(): number | null {
  if (selectedAccession === null) return null;
  const at = view.rows.findIndex((r) => r.accession.id === selectedAccession);
  return at === -1 ? null : at;
}

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
  draw(
    ctx, view, box, palette, artifact.genotypes, humanise(view.axis),
    selectedSite, focusedRow(), selectedBand,
  );
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
  const result = drawMap(
    ctx, w, h, palette, artifact.accessions, artifact.genotypes[selectedSite], selectedAccession,
  );
  mapPoints = result.points;
  if (!site) return;

  const r = artifact.cline[view.axis]?.[selectedSite] ?? null;
  el('map-site').innerHTML =
    `${artifact.locus.chrom}:${site.pos.toLocaleString()}<span>${site.ref} &rarr; ${site.alt}</span>`;
  const rWithin = artifact.clineWithin?.[view.axis]?.[selectedSite] ?? null;
  const shift = artifact.shift?.[view.axis]?.[selectedSite] ?? null;
  el('map-stats').innerHTML = `
    <dt>Carriers</dt><dd>${site.carriers} of ${site.called}</dd>
    <dt>${humanise(view.axis)} shift</dt><dd>${
      shift === null ? '&mdash;' : `${shift > 0 ? '+' : ''}${shift.toFixed(2)} SD`
    }</dd>
    <dt>r vs ${humanise(view.axis)}</dt><dd>${r === null ? 'too rare' : r.toFixed(3)}</dd>
    <dt>within ancestry</dt><dd>${kept(rWithin, r)}</dd>
    <dt>r vs expression</dt><dd>${site.exprR === null ? 'too rare' : site.exprR.toFixed(3)}</dd>
    <dt>within ancestry</dt><dd>${kept(site.exprRWithin, site.exprR)}</dd>
    <dt>Alt frequency</dt><dd>${(site.altFreq * 100).toFixed(1)}%</dd>
    <dt>On the map</dt><dd>${mapPoints.length} plants</dd>`;
  const plant = el('map-plant');
  const band = verticalFocus === 'bands' && selectedBand !== null
    ? view.bands[selectedBand]
    : null;

  if (band) {
    const freqAt = view.columns.findIndex((c) => c.siteIndex === selectedSite);
    const freq = freqAt === -1 ? null : (band.freq[freqAt] ?? null);
    plant.innerHTML =
      `<dt>Band</dt><dd>${(selectedBand as number) + 1} of ${view.bands.length}, coldest first</dd>` +
      `<dt>Plants</dt><dd>${band.n}</dd>` +
      `<dt>${humanise(view.axis)}</dt><dd>${fmt(band.meanAxis)} mean</dd>` +
      `<dt>Alt here</dt><dd>${freq === null ? '&mdash;' : `${(freq * 100).toFixed(1)}%`}</dd>` +
      band.groups.slice(0, 2)
        .map(([g, share]) => `<dt>${ancestryLabel(g)}</dt><dd>${Math.round(share * 100)}%</dd>`)
        .join('');
    plant.hidden = false;
  } else {
    const rowAt = focusedRow();
    const focused = rowAt === null ? null : view.rows[rowAt];
    if (focused) {
      const gt = artifact.genotypes[selectedSite]?.[focused.gtIndex] ?? '.';
      plant.innerHTML =
        `<dt>Plant</dt><dd>${focused.accession.name}, ${focused.accession.country}</dd>` +
        `<dt>Rank</dt><dd>${(rowAt as number) + 1} of ${view.rows.length}, coldest first</dd>` +
        `<dt>${humanise(view.axis)}</dt><dd>${fmt(focused.axisValue)}</dd>` +
        `<dt>Carries</dt><dd>${GENOTYPE_NAME[gt]}</dd>`;
      plant.hidden = false;
    } else {
      plant.hidden = true;
    }
  }

  el('map-hint').textContent =
    `Click any column below, or any tick in the all-sites strip, to change site. ` +
    `Left and right move across sites; up and down move through ` +
    `${verticalFocus === 'bands' ? 'the climate bands — click a plant row to move through plants instead' : 'the plants — click a climate band to move through bands instead'}.` +
    (result.offMap
      ? ` ${result.offMap} accessions fall outside the native range and are not drawn — Arabidopsis in North America is introduced, carrying European genotypes without having adapted locally.`
      : '');
}

function rebuild() {
  const axis = axisSelect.value;
  const rankBy = rankSelect.value as RankBy;

  // How many sites could be shown under this ranking. There is no fixed cap:
  // the slider reaches every site the chosen statistic can score, and defaults
  // there. Narrowing is the user's choice, not the tool's.
  const rankable =
    rankBy === 'cline'
      ? (artifact.cline[axis] ?? []).filter((r) => r !== null).length
      : artifact.sites.filter((s) => s.exprR !== null).length;

  sitesInput.max = String(Math.max(6, rankable));
  if (!siteCountTouched || Number(sitesInput.value) > rankable) {
    sitesInput.value = String(Math.max(6, rankable));
  }
  const count = Number(sitesInput.value);
  siteCountOut.textContent = `${count} of ${rankable}`;

  view = buildView(artifact, axis, count, rankBy);

  const testable = (artifact.cline[axis] ?? []).filter((r) => r !== null).length;
  el('locus-counts').textContent =
    `${artifact.accessions.length} accessions · ` +
    `${view.columns.length} of ${testable} testable sites · ` +
    `${artifact.sites.length} segregating`;

  render();
}

// --- tooltip ----------------------------------------------------------------

const fmt = (v: number, digits = 2) =>
  Number.isInteger(v) ? String(v) : v.toFixed(digits);

/**
 * "-0.446 (58% kept)" - the ancestry control next to what it controls.
 *
 * The kept fraction is only meaningful against a correlation large enough to
 * lose something. Below 0.1 the ratio is noise over noise, and reads absurdly:
 * a raw -0.022 against a within of -0.037 is "169% kept", which says nothing.
 */
const kept = (within: number | null, raw: number | null) => {
  if (within === null || raw === null) return '&mdash;';
  if (Math.abs(raw) < 0.1) return within.toFixed(3);
  return `${within.toFixed(3)} (${Math.round((within / raw) * 100)}% kept)`;
};

/**
 * Any site in the region, including one too rare for a correlation. Those get
 * carriers and the environmental shift instead of an r, and say so - the point
 * is that they are reachable and measured, not that they are equivalent.
 */
function overviewTip(index: number): string | null {
  const site = artifact.sites[index];
  if (!site) return null;
  const axisLabel = humanise(view.axis);
  const shift = artifact.shift?.[view.axis]?.[index] ?? null;
  const r = artifact.cline[view.axis]?.[index] ?? null;

  return `<div class="tip-title">${artifact.locus.chrom}:${site.pos.toLocaleString()}</div>
    <div class="tip-sub">${site.ref} &rarr; ${site.alt} · ${
      r === null ? 'too rare to correlate' : 'correlation testable'
    }</div>
    <dl>
      <dt>Carriers</dt><dd>${site.carriers} of ${site.called}</dd>
      <dt>Alt frequency</dt><dd>${fmt(site.altFreq * 100, 1)}%</dd>
      <dt>${axisLabel} shift</dt><dd>${
        shift === null ? '&mdash;' : `${shift > 0 ? '+' : ''}${shift.toFixed(2)} SD`
      }</dd>
      ${r === null ? '' : `<dt>r vs ${axisLabel}</dt><dd>${r.toFixed(3)}</dd>`}
      ${site.exprR === null ? '' : `<dt>r vs expression</dt><dd>${site.exprR.toFixed(3)}</dd>`}
    </dl>`;
}

const GENOTYPE_NAME: Record<string, string> = {
  '0': 'reference',
  '1': 'heterozygous',
  '2': 'alternate',
  '.': 'not called',
};

function tooltipHtml(hit: Hit): string | null {
  if (!hit) return null;
  const axisLabel = humanise(view.axis);

  if (hit.kind === 'overview') return overviewTip(hit.site);

  const col = hit.kind === 'cline' ? hit.col : hit.col;
  const column = col === null ? null : view.columns[col];
  const site = column?.site;
  const where = site ? `${artifact.locus.chrom}:${site.pos.toLocaleString()}` : '';

  if (hit.kind === 'cline' && column && site) {
    return `<div class="tip-title">${where}</div>
      <div class="tip-sub">${site.ref} &rarr; ${site.alt}</div>
      <dl>
        <dt>r vs ${axisLabel}</dt><dd>${column.r === null ? '&mdash;' : column.r.toFixed(3)}</dd>
        <dt>within ancestry</dt><dd>${kept(column.rWithin, column.r)}</dd>
        <dt>r vs expression</dt><dd>${site.exprR === null ? '&mdash;' : site.exprR.toFixed(3)}</dd>
        <dt>within ancestry</dt><dd>${kept(site.exprRWithin, site.exprR)}</dd>
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
  if (!hit) return;

  if (hit.kind === 'overview') {
    selectedSite = hit.site;
    render();
    return;
  }

  // Clicking a section hands it the vertical cursor, and lands that cursor
  // where the click was - so up and down carry on from there.
  if (hit.kind === 'band') {
    verticalFocus = 'bands';
    selectedBand = Math.max(0, Math.min(view.bands.length - 1, hit.band));
  } else if (hit.kind === 'row') {
    verticalFocus = 'accessions';
    const row = view.rows[hit.row];
    if (row) selectedAccession = row.accession.id;
  }

  if (hit.col !== null) {
    const column = view.columns[hit.col];
    if (column) selectedSite = column.siteIndex;
  }
  render();
});

/**
 * Left and right walk the selected site along the panel, in genomic order.
 *
 * They step through the displayed columns rather than every site in the
 * region: the columns are the sites the current statistic can score, and
 * stepping one at a time through a thousand mostly-untestable positions would
 * be tedious. A site picked from the all-sites strip may not be a column, so
 * the first press lands on the nearest one by position.
 */
document.addEventListener('keydown', (e) => {
  const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
  if (!horizontal && !vertical) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Leave the dropdowns and the slider their own arrow behaviour.
  const target = e.target as HTMLElement | null;
  if (target && (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)) {
    return;
  }
  if (!view) return;

  // Up and down walk the plants, in the order the panel already shows them:
  // coldest at the top, so up is colder. Only the accessions section has a
  // vertical data axis, which is where "where applicable" bites - with no rows
  // there is nothing to move through.
  if (vertical) {
    const down = e.key === 'ArrowDown';

    if (verticalFocus === 'bands') {
      if (view.bands.length === 0) return;
      e.preventDefault();
      const next =
        selectedBand === null
          ? (down ? 0 : view.bands.length - 1)
          : Math.max(0, Math.min(view.bands.length - 1, selectedBand + (down ? 1 : -1)));
      if (next === selectedBand) return;
      selectedBand = next;
      render();
      return;
    }

    if (view.rows.length === 0) return;
    e.preventDefault();
    const at = focusedRow();
    const next =
      at === null
        ? (down ? 0 : view.rows.length - 1)
        : Math.max(0, Math.min(view.rows.length - 1, at + (down ? 1 : -1)));
    const row = view.rows[next];
    if (!row || row.accession.id === selectedAccession) return;
    selectedAccession = row.accession.id;
    render();
    return;
  }

  if (view.columns.length === 0) return;
  const step = e.key === 'ArrowRight' ? 1 : -1;
  const at = view.columns.findIndex((c) => c.siteIndex === selectedSite);
  let next: number;

  if (at !== -1) {
    next = at + step;
  } else {
    // Not on a column - the site came from the all-sites strip. Move to the
    // next column in the direction pressed, so right never travels left.
    const here = selectedSite === null ? null : (artifact.sites[selectedSite]?.pos ?? null);
    if (here === null) {
      next = step > 0 ? 0 : view.columns.length - 1;
    } else if (step > 0) {
      next = view.columns.findIndex((c) => c.site.pos > here);
      if (next === -1) next = view.columns.length - 1;
    } else {
      next = -1;
      view.columns.forEach((c, i) => { if (c.site.pos < here) next = i; });
      if (next === -1) next = 0;
    }
  }

  next = Math.max(0, Math.min(view.columns.length - 1, next));
  const column = view.columns[next];
  if (!column || column.siteIndex === selectedSite) return;

  e.preventDefault();
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

async function selectLocus(def: LocusDef) {
  const seq = ++loadSeq;
  status.classList.remove('error');
  status.textContent = `Loading ${def.label}…`;
  status.hidden = false;

  let loaded: Artifact;
  try {
    loaded = await getArtifact(def, ALL_GENES, (message) => {
      if (seq === loadSeq) status.textContent = message;
    });
  } catch (err) {
    if (seq !== loadSeq) return;
    status.textContent =
      `Could not assemble ${def.label}.\n\n${err instanceof Error ? err.message : String(err)}` +
      `\n\nThe data is fetched live from AraCLIM, NCBI GEO and the 1001 Genomes VCFSubset API - ` +
      `one of them may be unreachable right now. Retry by clicking the locus again.`;
    status.classList.add('error');
    return;
  }
  if (seq !== loadSeq) return; // user moved on mid-load
  artifact = loaded;
  status.hidden = true;

  el('locus-label').textContent = def.label;
  el('locus-gene').textContent = def.gene;
  el('locus-coords').textContent =
    `${artifact.locus.chrom}:${artifact.locus.start.toLocaleString()}–${artifact.locus.end.toLocaleString()}`;
  const note = el('locus-note');
  note.textContent = `${def.title}. ${def.note}`;
  note.hidden = false;

  for (const button of document.querySelectorAll<HTMLButtonElement>('.loci button')) {
    button.setAttribute('aria-current', String(button.dataset['label'] === def.label));
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
  const nav = el('loci');
  for (const def of LOCI) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = def.label;
    button.dataset['label'] = def.label;
    button.title = def.title;
    button.addEventListener('click', () => void selectLocus(def));
    nav.append(button);
  }

  nav.hidden = false;
  el('locus-bar').hidden = false;
  el('controls').hidden = false;
  el('ancestry-key').hidden = false;

  axisSelect.addEventListener('change', () => {
    chosenAxis = axisSelect.value;
    rebuild();
  });
  sitesInput.addEventListener('input', () => { siteCountTouched = true; rebuild(); });
  rankSelect.addEventListener('change', () => {
    // Re-open on the strongest site under the new ranking, otherwise switching
    // leaves the map pointing at a site that may no longer be on screen.
    rebuild();
    const first = view.columns.reduce(
      (best, c) => (best === null || Math.abs(c.value) > Math.abs(best.value) ? c : best),
      null as (typeof view.columns)[number] | null,
    );
    if (first) { selectedSite = first.siteIndex; render(); }
  });
  new ResizeObserver(() => { if (view) render(); }).observe(stage);

  await selectLocus(LOCI[0] as LocusDef);
}

void boot();
