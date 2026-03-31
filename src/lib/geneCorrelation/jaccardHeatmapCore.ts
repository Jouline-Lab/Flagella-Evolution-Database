export const GENE_COUNT_SUFFIX = "_count";

export const TAXON_RANK_COLUMNS = [
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species"
] as const;

export type WeightingMode = "none" | "inverse" | "inverse_sqrt";

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export type ClusterNode = {
  id: number;
  members: number[];
  left: ClusterNode | null;
  right: ClusterNode | null;
  height: number;
};

export type JaccardStats = {
  interMatrix: number[][];
  unionMatrix: number[][];
  bothCountMatrix: number[][];
  anyCountMatrix: number[][];
  presentCount: number[];
  weightedPresent: number[];
};

export type JaccardResult = {
  labels: string[];
  sim: number[][];
  countCols: string[];
  stats: JaccardStats;
};

export function parseDelimited(text: string): ParsedTable {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("Input file has no data rows.");
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map((s) => s.trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (parts[j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

export function numberOrZero(v: string): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function buildWeights(
  rows: Record<string, string>[],
  taxonCol: string,
  weighting: WeightingMode,
  alpha: number
): number[] {
  const n = rows.length;
  if (weighting === "none") {
    return new Array(n).fill(1 / n);
  }

  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r[taxonCol] || "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const w = rows.map((r) => {
    const key = r[taxonCol] || "";
    const size = counts.get(key) || 1;
    if (weighting === "inverse") {
      return 1 / Math.pow(size, alpha);
    }
    if (weighting === "inverse_sqrt") {
      return 1 / Math.pow(Math.sqrt(size), alpha);
    }
    return 1;
  });

  const sumW = w.reduce((acc, v) => acc + v, 0);
  return sumW > 0 ? w.map((v) => v / sumW) : new Array(n).fill(1 / n);
}

export function computeJaccardMatrix(
  rows: Record<string, string>[],
  suffix: string,
  weights: number[],
  selectedGenes: Set<string> | null
): JaccardResult {
  const headers = Object.keys(rows[0] || {});
  const allCountCols = headers.filter((c) => c.endsWith(suffix));
  let countCols = allCountCols;
  if (selectedGenes && selectedGenes.size > 0) {
    countCols = allCountCols.filter((c) => selectedGenes.has(c.slice(0, -suffix.length)));
  }
  if (countCols.length === 0) {
    if (selectedGenes && selectedGenes.size > 0) {
      throw new Error(
        `None of the requested genes were found. Requested: ${Array.from(selectedGenes)
          .slice(0, 20)
          .join(", ")}${selectedGenes.size > 20 ? ", ..." : ""}`
      );
    }
    throw new Error(`No columns end with suffix "${suffix}".`);
  }

  const labels = countCols.map((c) => c.slice(0, -suffix.length));
  const nGenes = countCols.length;
  const nRows = rows.length;

  const presence = countCols.map((col) => {
    const arr = new Array<number>(nRows);
    for (let i = 0; i < nRows; i++) {
      arr[i] = numberOrZero(rows[i][col]) > 0 ? 1 : 0;
    }
    return arr;
  });

  const sim: number[][] = Array.from({ length: nGenes }, (_, i) =>
    Array.from({ length: nGenes }, (_, j) => (i === j ? 1 : 0))
  );
  const interMatrix: number[][] = Array.from({ length: nGenes }, () =>
    Array.from({ length: nGenes }, () => NaN)
  );
  const unionMatrix: number[][] = Array.from({ length: nGenes }, () =>
    Array.from({ length: nGenes }, () => NaN)
  );
  const bothCountMatrix: number[][] = Array.from({ length: nGenes }, () =>
    Array.from({ length: nGenes }, () => 0)
  );
  const anyCountMatrix: number[][] = Array.from({ length: nGenes }, () =>
    Array.from({ length: nGenes }, () => 0)
  );
  const presentCount = Array.from({ length: nGenes }, () => 0);
  const weightedPresent = Array.from({ length: nGenes }, () => 0);

  const dropDoubleZero = false;

  for (let i = 0; i < nGenes; i++) {
    let c = 0;
    let wc = 0;
    for (let k = 0; k < nRows; k++) {
      if (presence[i][k]) {
        c += 1;
        wc += weights[k];
      }
    }
    presentCount[i] = c;
    weightedPresent[i] = wc;
    interMatrix[i][i] = wc;
    unionMatrix[i][i] = wc;
    bothCountMatrix[i][i] = c;
    anyCountMatrix[i][i] = c;
  }

  for (let i = 0; i < nGenes; i++) {
    const a = presence[i];
    for (let j = i + 1; j < nGenes; j++) {
      const b = presence[j];
      let inter = 0;
      let uni = 0;
      let bothCount = 0;
      let anyCount = 0;

      if (dropDoubleZero) {
        let hasAny = false;
        for (let k = 0; k < nRows; k++) {
          if (a[k] || b[k]) {
            hasAny = true;
            inter += weights[k] * (a[k] & b[k]);
            uni += weights[k];
            anyCount += 1;
          }
          bothCount += a[k] & b[k];
        }
        if (!hasAny) {
          sim[i][j] = NaN;
          sim[j][i] = NaN;
          interMatrix[i][j] = interMatrix[j][i] = NaN;
          unionMatrix[i][j] = unionMatrix[j][i] = NaN;
          bothCountMatrix[i][j] = bothCountMatrix[j][i] = bothCount;
          anyCountMatrix[i][j] = anyCountMatrix[j][i] = anyCount;
          continue;
        }
      } else {
        for (let k = 0; k < nRows; k++) {
          inter += weights[k] * (a[k] & b[k]);
          uni += weights[k] * (a[k] | b[k]);
          bothCount += a[k] & b[k];
          anyCount += a[k] | b[k];
        }
      }

      const val = uni > 0 ? inter / uni : NaN;
      sim[i][j] = val;
      sim[j][i] = val;
      interMatrix[i][j] = interMatrix[j][i] = inter;
      unionMatrix[i][j] = unionMatrix[j][i] = uni;
      bothCountMatrix[i][j] = bothCountMatrix[j][i] = bothCount;
      anyCountMatrix[i][j] = anyCountMatrix[j][i] = anyCount;
    }
  }

  return {
    labels,
    sim,
    countCols,
    stats: {
      interMatrix,
      unionMatrix,
      bothCountMatrix,
      anyCountMatrix,
      presentCount,
      weightedPresent
    }
  };
}

export function toDistanceMatrix(sim: number[][]): number[][] {
  const n = sim.length;
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        dist[i][j] = 0;
        continue;
      }
      const sij = sim[i][j];
      dist[i][j] = Number.isFinite(sij) ? Math.max(0, 1 - sij) : 1;
    }
  }
  return dist;
}

function completeLinkageDistance(
  clusterA: ClusterNode,
  clusterB: ClusterNode,
  distMatrix: number[][]
): number {
  let d = -Infinity;
  for (const i of clusterA.members) {
    for (const j of clusterB.members) {
      d = Math.max(d, distMatrix[i][j]);
    }
  }
  return d;
}

export function hierarchicalClustering(distMatrix: number[][]): ClusterNode {
  const n = distMatrix.length;
  const clusters = new Map<number, ClusterNode>();
  const active = new Set<number>();
  let nextId = n;

  for (let i = 0; i < n; i++) {
    clusters.set(i, { id: i, members: [i], left: null, right: null, height: 0 });
    active.add(i);
  }

  while (active.size > 1) {
    const ids = Array.from(active);
    let bestA: ClusterNode | null = null;
    let bestB: ClusterNode | null = null;
    let bestD = Infinity;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = clusters.get(ids[i])!;
        const b = clusters.get(ids[j])!;
        const d = completeLinkageDistance(a, b, distMatrix);
        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }

    const minA = Math.min(...bestA!.members);
    const minB = Math.min(...bestB!.members);
    const left = minA <= minB ? bestA! : bestB!;
    const right = minA <= minB ? bestB! : bestA!;

    const merged: ClusterNode = {
      id: nextId++,
      members: [...left.members, ...right.members].sort((x, y) => x - y),
      left,
      right,
      height: bestD
    };

    active.delete(bestA!.id);
    active.delete(bestB!.id);
    clusters.set(merged.id, merged);
    active.add(merged.id);
  }

  const rootId = Array.from(active)[0];
  return clusters.get(rootId)!;
}

export function leafOrderFromTree(node: ClusterNode, out: number[] = []): number[] {
  if (!node.left && !node.right) {
    out.push(node.members[0]);
    return out;
  }
  leafOrderFromTree(node.left!, out);
  leafOrderFromTree(node.right!, out);
  return out;
}

export function reorderMatrix<T>(matrix: T[][], order: number[]): T[][] {
  return order.map((i) => order.map((j) => matrix[i][j]));
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmt(v: number, digits = 4): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "NaN";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const x = hex.replace("#", "");
  if (x.length !== 6) {
    return { r: 128, g: 128, b: 128 };
  }
  return {
    r: parseInt(x.slice(0, 2), 16),
    g: parseInt(x.slice(2, 4), 16),
    b: parseInt(x.slice(4, 6), 16)
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const rr = Math.max(0, Math.min(255, Math.round(r)))
    .toString(16)
    .padStart(2, "0");
  const gg = Math.max(0, Math.min(255, Math.round(g)))
    .toString(16)
    .padStart(2, "0");
  const bb = Math.max(0, Math.min(255, Math.round(b)))
    .toString(16)
    .padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function jaccardToColor(v: number, blueHex: string, redHex: string): string {
  const blue = hexToRgb(blueHex);
  const white = { r: 255, g: 255, b: 255 };
  const red = hexToRgb(redHex);
  const t = Math.max(0, Math.min(1, v));
  if (t <= 0.5) {
    const u = t / 0.5;
    return rgbToHex(
      lerp(blue.r, white.r, u),
      lerp(blue.g, white.g, u),
      lerp(blue.b, white.b, u)
    );
  }
  const u = (t - 0.5) / 0.5;
  return rgbToHex(lerp(white.r, red.r, u), lerp(white.g, red.g, u), lerp(white.b, red.b, u));
}

export function taxonColumnCandidates(headers: string[], suffix: string): string[] {
  const nonGeneCols = headers.filter((h) => !h.endsWith(suffix));
  return TAXON_RANK_COLUMNS.filter((c) => nonGeneCols.includes(c));
}

export function pickDefaultTaxonColumn(candidates: string[], previous: string | null): string {
  if (previous && candidates.includes(previous)) {
    return previous;
  }
  if (candidates.includes("species")) {
    return "species";
  }
  if (candidates.includes("taxon")) {
    return "taxon";
  }
  return candidates[0] ?? "";
}
