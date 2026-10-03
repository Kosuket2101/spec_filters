const state = {
  filters: [],
  filterData: new Map(),
  filterSettings: new Map(),
  spectra: [],
  nextSpectrumId: 1
};

const $ = (id) => document.getElementById(id);
const C_A_PER_S = 2.99792458e18;
const JY_CGS = 1e-23;
const AB_ZERO_JY = 3631.0;

const SPECTRUM_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#e377c2"];
const FILTER_COLORS = ["#00a6d6", "#ef5675", "#7a5195", "#ffa600", "#2f4b7c", "#55a868", "#c44e52", "#8172b3"];

const EMISSION_LINES = [
  { name: "Lyα", nm: 121.567 },
  { name: "C IV", nm: 154.9 },
  { name: "C III]", nm: 190.9 },
  { name: "Mg II", nm: 279.8 },
  { name: "[O II]", nm: 372.7 },
  { name: "Hβ", nm: 486.13 },
  { name: "[O III]", nm: 500.7 },
  { name: "Hα", nm: 656.28 },
  { name: "[N II]", nm: 658.34 },
  { name: "[S II]", nm: 672.4 }
];

function unitToNmFactor(unit) {
  const u = String(unit || "nm").trim().toLowerCase();
  if (["a", "aa", "angstrom", "angstroms", "å"].includes(u)) return 0.1;
  if (["um", "µm", "μm", "micron", "microns"].includes(u)) return 1000;
  return 1;
}

function normalizeFluxUnit(value) {
  const u = String(value || "relative_flam").trim().toLowerCase().replace(/\s+/g, "");
  const aliases = {
    "relative": "relative_flam",
    "relative_flam": "relative_flam",
    "rel_flam": "relative_flam",
    "relativeflambda": "relative_flam",
    "relative_fnu": "relative_fnu",
    "rel_fnu": "relative_fnu",
    "relativefnu": "relative_fnu",
    "erg/s/cm2/a": "flam_cgs_a",
    "erg/s/cm^2/a": "flam_cgs_a",
    "erg/s/cm2/angstrom": "flam_cgs_a",
    "erg/s/cm^2/angstrom": "flam_cgs_a",
    "flam_cgs_a": "flam_cgs_a",
    "erg/s/cm2/nm": "flam_cgs_nm",
    "erg/s/cm^2/nm": "flam_cgs_nm",
    "flam_cgs_nm": "flam_cgs_nm",
    "jy": "fnu_jy",
    "fnu_jy": "fnu_jy",
    "erg/s/cm2/hz": "fnu_cgs",
    "erg/s/cm^2/hz": "fnu_cgs",
    "fnu_cgs": "fnu_cgs"
  };
  return aliases[u] || value || "relative_flam";
}

function isPhysicalFluxUnit(unit) {
  return ["flam_cgs_a", "flam_cgs_nm", "fnu_jy", "fnu_cgs"].includes(unit);
}

function parseMetadata(text) {
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*#\s*([^:]+)\s*:\s*(.+?)\s*$/);
    if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return meta;
}

function parseTwoColumn(text, waveUnit = "nm") {
  const factor = unitToNmFactor(waveUnit);
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cols = line.split(/[,\s;]+/).filter(Boolean);
    if (cols.length < 2) continue;
    const a = Number(cols[0]);
    const b = Number(cols[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) rows.push([a * factor, b]);
  }
  if (rows.length < 2) throw new Error("2列の数値データを読み込めませんでした。");
  rows.sort((a, b) => a[0] - b[0]);
  return { x: rows.map(r => r[0]), y: rows.map(r => r[1]) };
}

function trapz(x, y) {
  let s = 0;
  for (let i = 1; i < x.length; i++) {
    s += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  }
  return s;
}

function interp(x, y, xi) {
  if (x.length < 2 || xi < x[0] || xi > x[x.length - 1]) return NaN;
  let lo = 0, hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= xi) lo = mid; else hi = mid;
  }
  const dx = x[hi] - x[lo];
  if (dx === 0) return y[lo];
  const t = (xi - x[lo]) / dx;
  return y[lo] * (1 - t) + y[hi] * t;
}

function safeNormalize(y) {
  const finite = y.filter(Number.isFinite).map(Math.abs);
  const scale = finite.length ? Math.max(...finite) : 1;
  return y.map(v => Number.isFinite(v) ? v / (scale || 1) : NaN);
}

function fluxToFnuJy(y, waveObsNm, fluxUnit) {
  const lamA = waveObsNm * 10;
  switch (fluxUnit) {
    case "fnu_jy": return y;
    case "fnu_cgs": return y / JY_CGS;
    case "flam_cgs_a": return (y * lamA * lamA / C_A_PER_S) / JY_CGS;
    case "flam_cgs_nm": {
      const flamPerA = y / 10;
      return (flamPerA * lamA * lamA / C_A_PER_S) / JY_CGS;
    }
    case "relative_fnu": return y;
    case "relative_flam": return y * lamA * lamA;
    default: return y;
  }
}

function fluxToFlamCgsA(y, waveObsNm, fluxUnit) {
  const lamA = waveObsNm * 10;
  switch (fluxUnit) {
    case "flam_cgs_a": return y;
    case "flam_cgs_nm": return y / 10;
    case "fnu_jy": return (y * JY_CGS) * C_A_PER_S / (lamA * lamA);
    case "fnu_cgs": return y * C_A_PER_S / (lamA * lamA);
    case "relative_flam": return y;
    case "relative_fnu": return y / (lamA * lamA);
    default: return y;
  }
}

function blackbodyRestFlam(T) {
  const h = 6.62607015e-34;
  const c = 299792458;
  const k = 1.380649e-23;
  const xRest = [];
  const flam = [];
  const n = 1600;
  const restMin = 80;
  const restMax = 8000;
  const logMin = Math.log(restMin);
  const logMax = Math.log(restMax);

  for (let i = 0; i < n; i++) {
    const nm = Math.exp(logMin + (logMax - logMin) * i / (n - 1));
    const lam = nm * 1e-9;
    const expo = h * c / (lam * k * T);
    const denom = Math.expm1(Math.min(expo, 700));
    const b = (2 * h * c * c) / (Math.pow(lam, 5) * denom);
    xRest.push(nm);
    flam.push(b);
  }
  return { xRest, flam: safeNormalize(flam) };
}

function getSpectrumArrays(spec) {
  const z = Math.max(-0.999, Number(spec.z) || 0);
  let xObs, xRest, sourceY, sourceUnit;

  if (spec.type === "blackbody") {
    const bb = blackbodyRestFlam(Math.max(100, Number(spec.temperature) || 6000));
    xRest = bb.xRest;
    xObs = xRest.map(v => v * (1 + z));
    sourceY = bb.flam;
    sourceUnit = "relative_flam";
  } else {
    sourceY = spec.y;
    sourceUnit = spec.fluxUnit;
    if (spec.inputFrame === "rest") {
      xRest = spec.xNm;
      xObs = spec.xNm.map(v => v * (1 + z));
    } else {
      xObs = spec.xNm;
      xRest = spec.xNm.map(v => v / (1 + z));
    }
  }

  const displayX = $("frameDisplay").value === "rest" ? xRest : xObs;
  const displayMode = $("fluxDisplay").value;
  let displayY;
  if (displayMode === "fnu") {
    displayY = sourceY.map((v, i) => fluxToFnuJy(v, xObs[i], sourceUnit));
  } else {
    displayY = sourceY.map((v, i) => fluxToFlamCgsA(v, xObs[i], sourceUnit));
  }

  const physical = spec.type === "upload" && isPhysicalFluxUnit(sourceUnit);
  if ($("normalizePlot").checked || !physical) displayY = safeNormalize(displayY);

  const fnuJy = sourceY.map((v, i) => fluxToFnuJy(v, xObs[i], sourceUnit));
  return { xObs, xRest, displayX, displayY, fnuJy, physical };
}

function addBlackbodySpectrum(overrides = {}) {
  const id = state.nextSpectrumId++;
  state.spectra.push({
    id,
    type: "blackbody",
    enabled: true,
    name: overrides.name || `Blackbody ${id}`,
    color: overrides.color || SPECTRUM_COLORS[(id - 1) % SPECTRUM_COLORS.length],
    z: overrides.z ?? 0,
    temperature: overrides.temperature ?? 6000
  });
  renderSpectrumList();
  updateReferenceSpectrumOptions();
  updatePlot();
}

function addUploadedSpectrum(file, text) {
  const meta = parseMetadata(text);
  const waveUnit = meta.wavelength_unit || $("uploadWaveUnit").value;
  const parsed = parseTwoColumn(text, waveUnit);
  const fluxUnit = normalizeFluxUnit(meta.flux_unit || $("uploadFluxUnit").value);
  const inputFrame = String(meta.frame || "observed").toLowerCase().startsWith("rest") ? "rest" : "observed";
  const z = Number(meta.redshift ?? meta.z ?? 0);
  const id = state.nextSpectrumId++;

  state.spectra.push({
    id,
    type: "upload",
    enabled: true,
    name: meta.name || file.name.replace(/\.[^.]+$/, ""),
    color: meta.color || SPECTRUM_COLORS[(id - 1) % SPECTRUM_COLORS.length],
    z: Number.isFinite(z) ? z : 0,
    xNm: parsed.x,
    y: parsed.y,
    fluxUnit,
    inputFrame
  });
}

function removeSpectrum(id) {
  state.spectra = state.spectra.filter(s => s.id !== id);
  renderSpectrumList();
  updateReferenceSpectrumOptions();
  updatePlot();
}

function spectrumTypeLabel(spec) {
  if (spec.type === "blackbody") return "Blackbody";
  return isPhysicalFluxUnit(spec.fluxUnit) ? "absolute flux" : "relative flux";
}

function renderSpectrumList() {
  const root = $("spectrumList");
  root.innerHTML = "";

  if (!state.spectra.length) {
    root.innerHTML = `<p class="muted">Blackbodyを追加するか、CSVをuploadしてください。</p>`;
    return;
  }

  for (const spec of state.spectra) {
    const card = document.createElement("div");
    card.className = "spectrum-card";

    const header = document.createElement("div");
    header.className = "spectrum-card-header";

    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = spec.enabled;
    visible.title = "show/hide";
    visible.addEventListener("change", () => {
      spec.enabled = visible.checked;
      updatePlot();
    });

    const color = document.createElement("input");
    color.type = "color";
    color.value = spec.color;
    color.title = "spectrum color";
    color.addEventListener("input", () => {
      spec.color = color.value;
      updatePlot();
    });

    const name = document.createElement("input");
    name.type = "text";
    name.value = spec.name;
    name.addEventListener("change", () => {
      spec.name = name.value.trim() || `Spectrum ${spec.id}`;
      updateReferenceSpectrumOptions();
      updatePlot();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger-button";
    del.textContent = "×";
    del.title = "remove";
    del.addEventListener("click", () => removeSpectrum(spec.id));

    header.append(visible, color, name, del);
    card.appendChild(header);

    const fields = document.createElement("div");
    fields.className = "spectrum-fields";

    fields.appendChild(makeNumberField("redshift z", spec.z, -0.99, 30, 0.01, value => {
      spec.z = value;
      updateReferenceSpectrumOptions();
      updatePlot();
    }));

    if (spec.type === "blackbody") {
      fields.appendChild(makeNumberField("Temperature [K]", spec.temperature, 100, 100000, 100, value => {
        spec.temperature = value;
        updatePlot();
      }));
    } else {
      fields.appendChild(makeSelectField("Input λ frame", [
        ["observed", "observed"],
        ["rest", "rest"]
      ], spec.inputFrame, value => {
        spec.inputFrame = value;
        updatePlot();
      }));

      fields.appendChild(makeSelectField("Flux unit", [
        ["relative_flam", "relative Fλ"],
        ["relative_fnu", "relative Fν"],
        ["flam_cgs_a", "Fλ [erg/s/cm²/Å]"],
        ["flam_cgs_nm", "Fλ [erg/s/cm²/nm]"],
        ["fnu_jy", "Fν [Jy]"],
        ["fnu_cgs", "Fν [erg/s/cm²/Hz]"]
      ], spec.fluxUnit, value => {
        spec.fluxUnit = value;
        updatePlot();
      }));
    }

    const typeBadge = document.createElement("div");
    typeBadge.innerHTML = `<span class="badge">${escapeHtml(spectrumTypeLabel(spec))}</span>`;
    fields.appendChild(typeBadge);

    card.appendChild(fields);
    root.appendChild(card);
  }
}

function makeNumberField(labelText, value, min, max, step, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.value = value;
  input.min = min;
  input.max = max;
  input.step = step;
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  label.appendChild(input);
  return label;
}

function makeSelectField(labelText, options, value, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  for (const [v, text] of options) {
    const option = document.createElement("option");
    option.value = v;
    option.textContent = text;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  label.appendChild(select);
  return label;
}

function updateReferenceSpectrumOptions() {
  const select = $("referenceSpectrum");
  const previous = Number(select.value);
  select.innerHTML = "";
  for (const spec of state.spectra) {
    const opt = document.createElement("option");
    opt.value = String(spec.id);
    opt.textContent = `${spec.name} (z=${Number(spec.z).toFixed(3)})`;
    select.appendChild(opt);
  }
  if (state.spectra.some(s => s.id === previous)) select.value = String(previous);
  else if (state.spectra.length) select.value = String(state.spectra[0].id);
}

function getReferenceSpectrum() {
  const id = Number($("referenceSpectrum").value);
  return state.spectra.find(s => s.id === id) || state.spectra.find(s => s.enabled) || state.spectra[0] || null;
}

async function loadFilterIndex() {
  try {
    const res = await fetch("filters/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.filters = await res.json();
    state.filters.forEach((f, i) => {
      state.filterSettings.set(f.path, {
        enabled: false,
        color: f.color || FILTER_COLORS[i % FILTER_COLORS.length]
      });
    });
    renderFilterList();
  } catch (err) {
    $("filterList").innerHTML = `<p class="muted">filter一覧を取得できません。GitHub PagesまたはHTTPサーバー経由で開いてください。</p>`;
    console.error(err);
  }
}

async function ensureFilterLoaded(info) {
  if (state.filterData.has(info.path)) return state.filterData.get(info.path);
  const res = await fetch(info.path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${info.path}`);
  const text = await res.text();
  const meta = parseMetadata(text);
  const unit = meta.wavelength_unit || info.wavelength_unit || "nm";
  const parsed = parseTwoColumn(text, unit);
  const data = {
    ...parsed,
    path: info.path,
    name: meta.name || info.name || info.path.split("/").pop(),
    wavelengthUnit: unit
  };
  state.filterData.set(info.path, data);
  return data;
}

function renderFilterList() {
  if (!state.filters.length) {
    $("filterList").innerHTML = `<p class="muted">filters/ にCSVを追加してください。</p>`;
    return;
  }

  $("filterList").innerHTML = "";
  for (const f of state.filters) {
    const settings = state.filterSettings.get(f.path);
    const row = document.createElement("label");
    row.className = "filter-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = settings.enabled;
    cb.addEventListener("change", () => {
      settings.enabled = cb.checked;
      updatePlot();
    });

    const color = document.createElement("input");
    color.type = "color";
    color.value = settings.color;
    color.title = "filter color";
    color.addEventListener("input", () => {
      settings.color = color.value;
      updatePlot();
    });

    const txt = document.createElement("span");
    txt.textContent = f.name || f.path.replace(/^filters\//, "");
    row.append(cb, color, txt);
    $("filterList").appendChild(row);
  }
}

function filterPivotNm(filter) {
  const a = trapz(filter.x, filter.x.map((v, i) => v * filter.y[i]));
  const b = trapz(filter.x, filter.x.map((v, i) => filter.y[i] / v));
  return a > 0 && b > 0 ? Math.sqrt(a / b) : NaN;
}

function syntheticABMag(filter, specArrays) {
  if (!specArrays.physical) return { mag: NaN, coverage: 0, reason: "relative flux" };

  const denomY = filter.x.map((lam, i) => filter.y[i] / lam);
  const denom = trapz(filter.x, denomY);
  if (!(denom > 0)) return { mag: NaN, coverage: 0, reason: "invalid filter" };

  const xs = [];
  const numY = [];
  const coverY = [];
  for (let i = 0; i < filter.x.length; i++) {
    const lam = filter.x[i];
    const fnu = interp(specArrays.xObs, specArrays.fnuJy, lam);
    if (Number.isFinite(fnu)) {
      xs.push(lam);
      numY.push(fnu * filter.y[i] / lam);
      coverY.push(filter.y[i] / lam);
    }
  }

  if (xs.length < 2) return { mag: NaN, coverage: 0, reason: "no overlap" };
  const coveredDenom = trapz(xs, coverY);
  const coverage = coveredDenom / denom;
  if (coverage < 0.95) return { mag: NaN, coverage, reason: "insufficient coverage" };

  const avgFnuJy = trapz(xs, numY) / coveredDenom;
  if (!(avgFnuJy > 0)) return { mag: NaN, coverage, reason: "non-positive flux" };
  const mag = -2.5 * Math.log10(avgFnuJy / AB_ZERO_JY);
  return { mag, coverage, avgFnuJy, reason: "" };
}

function buildEmissionLineDecorations() {
  if (!$("showEmissionLines").checked) return { shapes: [], annotations: [] };
  const ref = getReferenceSpectrum();
  const z = ref ? Number(ref.z) || 0 : 0;
  const observed = $("frameDisplay").value === "observed";
  const shapes = [];
  const annotations = [];

  for (const line of EMISSION_LINES) {
    const x = observed ? line.nm * (1 + z) : line.nm;
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: x, x1: x,
      y0: 0, y1: 1,
      line: { color: "rgba(80,80,80,0.32)", width: 1, dash: "dot" }
    });
    annotations.push({
      x, y: 1,
      xref: "x", yref: "paper",
      text: line.name,
      showarrow: false,
      textangle: -90,
      yanchor: "bottom",
      font: { size: 10, color: "#4a5568" }
    });
  }
  return { shapes, annotations };
}

async function updatePlot() {
  const traces = [];
  const enabledSpectra = state.spectra.filter(s => s.enabled);
  const spectrumCache = new Map();

  for (const spec of enabledSpectra) {
    const arrays = getSpectrumArrays(spec);
    spectrumCache.set(spec.id, arrays);
    traces.push({
      x: arrays.displayX,
      y: arrays.displayY,
      name: spec.name,
      mode: "lines",
      type: "scatter",
      line: { width: 2, color: spec.color },
      yaxis: "y"
    });
  }

  const selectedFilters = [];
  const ref = getReferenceSpectrum();
  const refZ = ref ? Number(ref.z) || 0 : 0;
  const frame = $("frameDisplay").value;

  for (const f of state.filters) {
    const settings = state.filterSettings.get(f.path);
    if (!settings?.enabled) continue;
    try {
      const data = await ensureFilterLoaded(f);
      selectedFilters.push({ info: f, data, settings });
      const x = frame === "rest" ? data.x.map(v => v / (1 + refZ)) : data.x;
      traces.push({
        x,
        y: data.y,
        name: data.name,
        mode: "lines",
        type: "scatter",
        yaxis: "y2",
        line: { width: 2, color: settings.color }
      });
    } catch (e) {
      console.error(e);
    }
  }

  const normalized = $("normalizePlot").checked;
  const fluxMode = $("fluxDisplay").value;
  const yTitle = normalized
    ? `Normalized ${fluxMode === "fnu" ? "Fν" : "Fλ"}`
    : (fluxMode === "fnu" ? "Fν [Jy] / relative" : "Fλ [erg s⁻¹ cm⁻² Å⁻¹] / relative");

  const emission = buildEmissionLineDecorations();
  const layout = {
    margin: { l: 78, r: 76, t: 48, b: 64 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { color: "#18233e" },
    xaxis: {
      title: `${frame === "rest" ? "Rest-frame" : "Observed-frame"} wavelength [nm]`,
      rangeslider: { visible: false }
    },
    yaxis: {
      title: yTitle,
      type: $("logY").checked ? "log" : "linear"
    },
    yaxis2: {
      title: "Filter throughput",
      overlaying: "y",
      side: "right",
      range: [0, 1.05],
      showgrid: false
    },
    legend: { orientation: "h", y: 1.13 },
    hovermode: "x unified",
    shapes: emission.shapes,
    annotations: emission.annotations,
    uirevision: "keep-zoom"
  };

  await Plotly.react("plot", traces, layout, {
    responsive: true,
    displaylogo: false,
    scrollZoom: true
  });

  updateFrameNote(ref, enabledSpectra);
  updateSummary(selectedFilters, enabledSpectra, spectrumCache);
}

function updateFrameNote(ref, enabledSpectra) {
  const frame = $("frameDisplay").value;
  const notes = [];
  if (frame === "rest") {
    notes.push("各スペクトルはそれぞれの z でrest-frameへ変換します。");
    if (ref) notes.push(`filterは reference spectrum「${ref.name}」の z=${Number(ref.z).toFixed(3)} でrest-frame表示します。`);
  } else if ($("showEmissionLines").checked && ref) {
    notes.push(`emission line位置は reference spectrum「${ref.name}」の z=${Number(ref.z).toFixed(3)} を使用します。`);
  }
  if (enabledSpectra.some(s => s.type === "upload" && s.inputFrame === "rest" && isPhysicalFluxUnit(s.fluxUnit))) {
    notes.push("rest-frame入力のabsolute fluxは、波長座標のみredshift変換し、flux density自体はobserver-frame量として扱います。");
  }
  $("frameNote").textContent = notes.join(" ");
}

function updateSummary(selectedFilters, enabledSpectra, spectrumCache) {
  const root = $("summary");
  if (!selectedFilters.length) {
    root.innerHTML = `<span class="muted">filterを選択してください。</span>`;
    return;
  }

  root.innerHTML = "";
  for (const { data: filter, settings } of selectedFilters) {
    const card = document.createElement("div");
    card.className = "summary-card";

    const pivot = filterPivotNm(filter);
    const title = document.createElement("div");
    title.className = "summary-title";
    title.innerHTML = `<span class="color-dot" style="background:${escapeHtml(settings.color)}"></span>${escapeHtml(filter.name)}`;
    card.appendChild(title);

    card.appendChild(summaryRow("Pivot λ (obs)", Number.isFinite(pivot) ? `${pivot.toFixed(2)} nm` : "N/A"));

    if ($("showABMag").checked) {
      for (const spec of enabledSpectra) {
        const arrays = spectrumCache.get(spec.id);
        const result = syntheticABMag(filter, arrays);
        let text;
        if (Number.isFinite(result.mag)) {
          text = `${result.mag.toFixed(4)} mag`;
        } else if (!arrays.physical) {
          text = "N/A (relative flux)";
        } else if (result.reason === "insufficient coverage") {
          text = `N/A (coverage ${(100 * result.coverage).toFixed(1)}%)`;
        } else {
          text = `N/A (${result.reason})`;
        }
        card.appendChild(summaryRow(`AB · ${spec.name}`, text));
      }
    }

    root.appendChild(card);
  }
}

function summaryRow(label, value) {
  const row = document.createElement("div");
  row.className = "summary-row";
  const a = document.createElement("span");
  const b = document.createElement("span");
  a.textContent = label;
  b.textContent = value;
  row.append(a, b);
  return row;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

$("addBlackbody").addEventListener("click", () => addBlackbodySpectrum());

$("spectrumFiles").addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])];
  for (const file of files) {
    try {
      const text = await file.text();
      addUploadedSpectrum(file, text);
    } catch (err) {
      alert(`${file.name}: ${err.message}`);
    }
  }
  e.target.value = "";
  renderSpectrumList();
  updateReferenceSpectrumOptions();
  updatePlot();
});

for (const id of ["fluxDisplay", "frameDisplay", "referenceSpectrum", "showABMag", "showEmissionLines", "normalizePlot", "logY"]) {
  $(id).addEventListener("change", updatePlot);
}

$("resetView").addEventListener("click", async () => {
  await Plotly.relayout("plot", { "xaxis.autorange": true, "yaxis.autorange": true });
});

addBlackbodySpectrum({ name: "Blackbody 6000 K", temperature: 6000, z: 0 });
loadFilterIndex().then(updatePlot);
