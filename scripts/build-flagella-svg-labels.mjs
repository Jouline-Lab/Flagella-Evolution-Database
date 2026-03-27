import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = path.join(process.cwd(), "public", "Flagella_figure.svg");
const DEFAULT_OUTPUT = path.join(process.cwd(), "public", "Flagella_figure.labeled.svg");
const DEFAULT_MAP_OUTPUT = path.join(process.cwd(), "public", "Flagella_figure.label-map.json");

const SHAPE_TAGS = ["rect", "ellipse", "circle", "path", "polygon", "polyline"];
const MATCH_DISTANCE_THRESHOLD = 100;

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    mapOutput: DEFAULT_MAP_OUTPUT
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      args.input = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args.output = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--map-output" && argv[i + 1]) {
      args.mapOutput = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseAttributes(tagSource) {
  const attributes = {};
  const regex = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match = regex.exec(tagSource);
  while (match) {
    attributes[match[1]] = match[2];
    match = regex.exec(tagSource);
  }
  return attributes;
}

function parseTranslate(attributes) {
  const transform = attributes.transform ?? "";
  const match = transform.match(/translate\(\s*([-+]?\d*\.?\d+)(?:[\s,]+([-+]?\d*\.?\d+))?/i);
  if (!match) return null;
  const x = toNumber(match[1]);
  const y = toNumber(match[2] ?? "0");
  if (x == null || y == null) return null;
  return { x, y };
}

function textContentFromTextNode(textNode) {
  return textNode
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumericPairs(source) {
  const numbers = Array.from(
    source.matchAll(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi),
    (match) => Number(match[0])
  ).filter((v) => Number.isFinite(v));
  const pairs = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    pairs.push([numbers[i], numbers[i + 1]]);
  }
  return pairs;
}

function bboxCenterFromPairs(pairs) {
  if (pairs.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of pairs) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
}

function centerForShape(tagName, attrs) {
  if (tagName === "rect") {
    const x = toNumber(attrs.x) ?? 0;
    const y = toNumber(attrs.y) ?? 0;
    const width = toNumber(attrs.width);
    const height = toNumber(attrs.height);
    if (width == null || height == null) return null;
    return { x: x + width / 2, y: y + height / 2 };
  }

  if (tagName === "ellipse" || tagName === "circle") {
    const cx = toNumber(attrs.cx);
    const cy = toNumber(attrs.cy);
    if (cx == null || cy == null) return null;
    return { x: cx, y: cy };
  }

  if (tagName === "polygon" || tagName === "polyline") {
    const points = attrs.points ?? "";
    return bboxCenterFromPairs(parseNumericPairs(points));
  }

  if (tagName === "path") {
    const d = attrs.d ?? "";
    return bboxCenterFromPairs(parseNumericPairs(d));
  }

  return null;
}

function normalizeLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function makeSvgSafeId(label, seenIds) {
  const base = normalizeLabel(label);
  const fallback = base || "region";
  let candidate = fallback;
  let suffix = 2;
  while (seenIds.has(candidate)) {
    candidate = `${fallback}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(candidate);
  return candidate;
}

function extractShapes(svgText) {
  const shapeRegex = new RegExp(`<(${SHAPE_TAGS.join("|")})\\b[^>]*\\/?>`, "gi");
  const shapes = [];
  let match = shapeRegex.exec(svgText);
  while (match) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const attrs = parseAttributes(fullTag);
    const center = centerForShape(tagName, attrs);
    if (center) {
      shapes.push({
        index: shapes.length,
        tagName,
        attrs,
        start: match.index,
        end: match.index + fullTag.length,
        fullTag,
        center
      });
    }
    match = shapeRegex.exec(svgText);
  }
  return shapes;
}

function extractTextLabels(svgText) {
  const textRegex = /<text\b[^>]*>[\s\S]*?<\/text>/gi;
  const labels = [];
  let match = textRegex.exec(svgText);
  while (match) {
    const full = match[0];
    const openTagMatch = full.match(/^<text\b[^>]*>/i);
    if (!openTagMatch) {
      match = textRegex.exec(svgText);
      continue;
    }
    const attrs = parseAttributes(openTagMatch[0]);
    const fromTransform = parseTranslate(attrs);
    const xAttr = toNumber(attrs.x);
    const yAttr = toNumber(attrs.y);
    const position = fromTransform ?? (xAttr != null && yAttr != null ? { x: xAttr, y: yAttr } : null);
    if (!position) {
      match = textRegex.exec(svgText);
      continue;
    }
    const text = textContentFromTextNode(full);
    if (!text) {
      match = textRegex.exec(svgText);
      continue;
    }
    labels.push({
      text,
      normalized: normalizeLabel(text),
      x: position.x,
      y: position.y
    });
    match = textRegex.exec(svgText);
  }
  return labels;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function matchLabelsToShapes(labels, shapes) {
  const sortedLabels = [...labels].sort((a, b) => a.y - b.y || a.x - b.x);
  const availableShapeIndexes = new Set(shapes.map((shape) => shape.index));
  const matches = [];
  const unmatchedLabels = [];

  for (const label of sortedLabels) {
    let best = null;
    for (const shape of shapes) {
      if (!availableShapeIndexes.has(shape.index)) continue;
      const d = distance(label, shape.center);
      if (best == null || d < best.distance) {
        best = { shape, distance: d };
      }
    }

    if (!best || best.distance > MATCH_DISTANCE_THRESHOLD) {
      unmatchedLabels.push({ label: label.text, x: label.x, y: label.y });
      continue;
    }

    availableShapeIndexes.delete(best.shape.index);
    matches.push({
      label: label.text,
      normalized: label.normalized,
      shapeIndex: best.shape.index,
      distance: Number(best.distance.toFixed(2))
    });
  }

  return { matches, unmatchedLabels };
}

function injectShapeIds(svgText, shapes, matches) {
  const shapeByIndex = new Map(shapes.map((shape) => [shape.index, shape]));
  const sortedByStartDescending = [...matches]
    .map((entry) => ({ ...entry, shape: shapeByIndex.get(entry.shapeIndex) }))
    .filter((entry) => entry.shape)
    .sort((a, b) => b.shape.start - a.shape.start);

  const seenIds = new Set(["Layer_1"]);
  let nextSvg = svgText;
  const mappingRows = [];

  for (const entry of sortedByStartDescending) {
    const { shape, label, distance } = entry;
    const geneId = makeSvgSafeId(label, seenIds);
    const newTag = shape.fullTag.replace(
      /^<([a-z]+)\b/i,
      `<$1 id="${geneId}" data-gene="${label}" data-match-distance="${distance}"`
    );
    nextSvg = `${nextSvg.slice(0, shape.start)}${newTag}${nextSvg.slice(shape.end)}`;
    mappingRows.push({
      id: geneId,
      label,
      distance,
      tagName: shape.tagName
    });
  }

  return { svgText: nextSvg, mappingRows: mappingRows.reverse() };
}

function injectOverrideStyle(svgText) {
  const overrideStyle = `
  <style id="flagella-auto-style">
    /* Pipeline override: remove colored fills and keep labels dark */
    rect, ellipse, circle, path, polygon, polyline {
      fill: none !important;
    }
    text, tspan {
      fill: #111111 !important;
    }
  </style>`;

  if (svgText.includes("<defs>")) {
    return svgText.replace(/<defs>/i, `<defs>${overrideStyle}`);
  }

  return svgText.replace(/<svg\b[^>]*>/i, (m) => `${m}\n<defs>${overrideStyle}\n</defs>`);
}

async function main() {
  const { input, output, mapOutput } = parseArgs(process.argv.slice(2));
  if (!existsSync(input)) {
    throw new Error(`Input SVG file not found: ${input}`);
  }

  const originalSvg = await readFile(input, "utf8");
  const labels = extractTextLabels(originalSvg);
  const shapes = extractShapes(originalSvg);
  const { matches, unmatchedLabels } = matchLabelsToShapes(labels, shapes);

  const { svgText: labeledSvgWithIds, mappingRows } = injectShapeIds(originalSvg, shapes, matches);
  const outputSvg = injectOverrideStyle(labeledSvgWithIds);

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, outputSvg, "utf8");

  const mapPayload = {
    version: 1,
    input: path.relative(process.cwd(), input).replace(/\\/g, "/"),
    output: path.relative(process.cwd(), output).replace(/\\/g, "/"),
    threshold: MATCH_DISTANCE_THRESHOLD,
    labelCount: labels.length,
    shapeCount: shapes.length,
    matchedCount: mappingRows.length,
    unmatchedCount: unmatchedLabels.length,
    mappings: mappingRows,
    unmatchedLabels
  };

  await mkdir(path.dirname(mapOutput), { recursive: true });
  await writeFile(mapOutput, `${JSON.stringify(mapPayload, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Labeled SVG written: ${output}`);
  // eslint-disable-next-line no-console
  console.log(`Match map written: ${mapOutput}`);
  // eslint-disable-next-line no-console
  console.log(`Labels: ${labels.length}, Shapes: ${shapes.length}, Matched: ${mappingRows.length}`);
  // eslint-disable-next-line no-console
  console.log(`Unmatched labels: ${unmatchedLabels.length}`);
  if (unmatchedLabels.length > 0) {
    // eslint-disable-next-line no-console
    console.log("Unmatched label details:");
    for (const entry of unmatchedLabels) {
      // eslint-disable-next-line no-console
      console.log(`- ${entry.label} at (${entry.x.toFixed(2)}, ${entry.y.toFixed(2)})`);
    }
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
