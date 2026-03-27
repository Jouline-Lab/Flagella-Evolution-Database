"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type { MouseEvent } from "react";
import type {
  OperonGapItem,
  OperonGeneItem,
  SpeciesOperonContent
} from "@/lib/speciesData";

type SpeciesOperonTracksProps = {
  content: SpeciesOperonContent;
};

type OperonTooltipState = {
  visible: boolean;
  x: number;
  y: number;
  geneName: string;
  coordinateLabel: string;
  strandLabel: string;
  contig: string;
  assembly: string;
};

type GeneLayout = {
  type: "gene";
  item: OperonGeneItem;
  leftPx: number;
  widthPx: number;
};

type GapLayout = {
  type: "gap";
  item: OperonGapItem;
  centerPx: number;
};

type TrackLayout = {
  widthPx: number;
  elements: Array<GeneLayout | GapLayout>;
};

const BP_TO_PX = 0.08;
const MIN_GENE_WIDTH_PX = 100;
const TRACK_SIDE_PADDING_PX = 40;
const LARGE_GAP_MARKER_WIDTH_PX = 44;
const MIN_GENE_BOX_GAP_PX = 10;
const GENE_HEIGHT_PX = 28;
const GENE_ARROW_TIP_PX = 12;
const GENE_BORDER_PX = 1;

function toRangeLabel(value: number): string {
  return value.toLocaleString();
}

function buildArrowPoints(
  width: number,
  height: number,
  tip: number,
  direction: "forward" | "reverse",
  inset = 0
): string {
  const safeWidth = Math.max(width - inset * 2, 2);
  const safeHeight = Math.max(height - inset * 2, 2);
  const safeTip = Math.min(Math.max(tip - inset, 1), safeWidth - 1);
  const x0 = inset;
  const y0 = inset;
  const x1 = inset + safeWidth;
  const y1 = inset + safeHeight;
  const ym = inset + safeHeight / 2;

  if (direction === "forward") {
    return [
      `${x0},${y0}`,
      `${x1 - safeTip},${y0}`,
      `${x1},${ym}`,
      `${x1 - safeTip},${y1}`,
      `${x0},${y1}`
    ].join(" ");
  }

  return [
    `${x0 + safeTip},${y0}`,
    `${x1},${y0}`,
    `${x1},${y1}`,
    `${x0 + safeTip},${y1}`,
    `${x0},${ym}`
  ].join(" ");
}

function trackLayout(track: SpeciesOperonContent["tracks"][number]): TrackLayout {
  let cursorPx = TRACK_SIDE_PADDING_PX;
  let lastBp = track.spanStart;
  const elements: TrackLayout["elements"] = [];
  let hasPlacedGene = false;

  for (const item of track.items) {
    if (item.kind === "gene") {
      const gapBp = Math.max(0, item.start - lastBp);
      const gapPx = gapBp * BP_TO_PX;
      cursorPx += hasPlacedGene ? Math.max(gapPx, MIN_GENE_BOX_GAP_PX) : gapPx;
      const widthPx = Math.max((item.stop - item.start) * BP_TO_PX, MIN_GENE_WIDTH_PX);
      elements.push({
        type: "gene",
        item,
        leftPx: cursorPx,
        widthPx
      });
      cursorPx += widthPx;
      lastBp = item.stop;
      hasPlacedGene = true;
      continue;
    }

    cursorPx += LARGE_GAP_MARKER_WIDTH_PX / 2;
    elements.push({
      type: "gap",
      item,
      centerPx: cursorPx
    });
    cursorPx += LARGE_GAP_MARKER_WIDTH_PX / 2;
    lastBp = item.rightBp;
  }

  const tailFlankBp = Math.max(track.spanEnd - lastBp, 0);
  const tailFlankPx = Math.max(tailFlankBp * BP_TO_PX, TRACK_SIDE_PADDING_PX);
  const widthPx = Math.max(cursorPx + tailFlankPx, 600);
  return { widthPx, elements };
}

export default function SpeciesOperonTracks({ content }: SpeciesOperonTracksProps) {
  const [tooltip, setTooltip] = useState<OperonTooltipState>({
    visible: false,
    x: 0,
    y: 0,
    geneName: "",
    coordinateLabel: "",
    strandLabel: "",
    contig: "",
    assembly: ""
  });

  function showGeneTooltip(
    event: MouseEvent<HTMLDivElement>,
    gene: OperonGeneItem
  ) {
    const x = Math.min(Math.max(event.clientX + 14, 8), window.innerWidth - 280);
    const y = Math.min(Math.max(event.clientY + 14, 8), window.innerHeight - 130);
    setTooltip({
      visible: true,
      x,
      y,
      geneName: gene.geneName,
      coordinateLabel: `${gene.start.toLocaleString()} - ${gene.stop.toLocaleString()} bp`,
      strandLabel: gene.strand === 1 ? "Forward (+1)" : "Reverse (-1)",
      contig: gene.contig,
      assembly: gene.assembly
    });
  }

  function hideTooltip() {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }

  if (content.matchedAssemblies === 0) {
    return (
      <p className="species-operon-note">
        No assemblies were mapped to this species in <code>GTDB214_lineage_ordered.json</code>.
      </p>
    );
  }

  if (content.tracks.length === 0) {
    return (
      <div className="species-operon-notes">
        <p className="species-operon-note">
          No operon coordinate tracks found for this species in <code>public/operon_coords</code>.
        </p>
        {content.missingAssemblies.length > 0 ? (
          <p className="species-operon-note">
            Missing files: {content.missingAssemblies.slice(0, 6).join(", ")}
            {content.missingAssemblies.length > 6 ? " ..." : ""}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="species-operon-panel">
      <p className="species-operon-summary">
        Assemblies with coordinate files: <strong>{content.assemblyCount}</strong> /{" "}
        {content.matchedAssemblies} | Contigs: <strong>{content.contigCount}</strong> | Genes:{" "}
        <strong>{content.geneCount.toLocaleString()}</strong>
      </p>

      {content.missingAssemblies.length > 0 ? (
        <p className="species-operon-note">
          Missing coordinate files for {content.missingAssemblies.length} assemblies.
        </p>
      ) : null}

      <div className="species-operon-tracks">
        {content.tracks.map((track) => (
          (() => {
            const layout = trackLayout(track);
            return (
              <article key={track.id} className="species-operon-track-card">
                <header className="species-operon-track-header">
                  <h3>{track.contig}</h3>
                  <p>{track.assembly}</p>
                </header>

                <div className="species-operon-track-range">
                  <span>{toRangeLabel(track.spanStart)} bp</span>
                  <span>{toRangeLabel(track.spanEnd)} bp</span>
                </div>

                <div className="species-operon-track-scroll">
                  <div className="species-operon-track-canvas" style={{ width: `${layout.widthPx}px` }}>
                    <div className="species-operon-track-baseline" />
                    {layout.elements.map((element) =>
                      element.type === "gene" ? (
                        <div
                          key={element.item.id}
                          className={[
                            "species-operon-gene",
                            element.item.strand === 1
                              ? "species-operon-gene-top"
                              : "species-operon-gene-bottom"
                          ].join(" ")}
                          style={
                            {
                              left: `${element.leftPx}px`,
                              width: `${element.widthPx}px`
                            } satisfies CSSProperties
                          }
                          onMouseEnter={(event) => showGeneTooltip(event, element.item)}
                          onMouseMove={(event) => showGeneTooltip(event, element.item)}
                          onMouseLeave={hideTooltip}
                        >
                          <svg
                            className="species-operon-gene-svg"
                            viewBox={`0 0 ${element.widthPx} ${GENE_HEIGHT_PX}`}
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <polygon
                              className="species-operon-gene-outer"
                              points={buildArrowPoints(
                                element.widthPx,
                                GENE_HEIGHT_PX,
                                GENE_ARROW_TIP_PX,
                                element.item.strand === 1 ? "forward" : "reverse"
                              )}
                            />
                            <polygon
                              className="species-operon-gene-inner-shape"
                              points={buildArrowPoints(
                                element.widthPx,
                                GENE_HEIGHT_PX,
                                GENE_ARROW_TIP_PX,
                                element.item.strand === 1 ? "forward" : "reverse",
                                GENE_BORDER_PX
                              )}
                            />
                            <text
                              className="species-operon-gene-label"
                              x="50%"
                              y="50%"
                              dominantBaseline="middle"
                              textAnchor="middle"
                            >
                              {element.item.geneName}
                            </text>
                          </svg>
                        </div>
                      ) : (
                        <div
                          key={element.item.id}
                          className="species-operon-gap"
                          style={{ left: `${element.centerPx}px` }}
                          title={`Large gap: ${(element.item.rightBp - element.item.leftBp).toLocaleString()} bp`}
                        />
                      )
                    )}
                  </div>
                </div>
              </article>
            );
          })()
        ))}
      </div>

      {tooltip.visible ? (
        <div className="species-operon-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <p className="species-operon-tooltip-title">{tooltip.geneName}</p>
          <p>
            <span className="species-operon-tooltip-key">Coordinates:</span> {tooltip.coordinateLabel}
          </p>
          <p>
            <span className="species-operon-tooltip-key">Strand:</span> {tooltip.strandLabel}
          </p>
          <p>
            <span className="species-operon-tooltip-key">Contig:</span> {tooltip.contig}
          </p>
          <p>
            <span className="species-operon-tooltip-key">Assembly:</span> {tooltip.assembly}
          </p>
        </div>
      ) : null}
    </section>
  );
}
