'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from 'd3';
import { withBasePath } from '@/lib/assetPaths';
import { getSpeciesSuggestionsClient } from '@/lib/browserSpecies';
import { formatSpeciesName, normalizeSpeciesQuery } from '@/lib/speciesNaming';

type Sequence = {
  header: string;
  sequence: string;
};

type FilteredAlignment = {
  sequences: Sequence[];
  keptColumnIndices: number[];
};

type PositionLogoData = {
  alignmentColumn: number;
  residueCounts: Record<string, number>;
  totalSequences: number;
  informationContent: number;
  letterHeights: Record<string, number>;
};

type SequenceLogoChartProps = {
  geneName: string;
  alignmentPath?: string | null;
  speciesGeneIdsByName?: Record<string, { gtdb: string[]; ncbi: Array<string | null> }>;
  onLoaded?: () => void;
  height?: number;
};

type SpeciesSuggestion = {
  name: string;
  slug: string;
};

type SelectedSpeciesEntry = {
  name: string;
  slug: string;
  gtdb: string[];
  ncbi: Array<string | null>;
  status: 'loading' | 'ready' | 'missing' | 'error';
  error?: string;
};

const aminoAcidGroups = {
  aromatic: { residues: ['W', 'Y', 'H', 'F'], color: '#FCB315', label: 'Aromatic (WYHF)' },
  polar: { residues: ['S', 'T', 'Q', 'N'], color: '#7D2985', label: 'Polar (STQN)' },
  small: { residues: ['P', 'G', 'A'], color: '#231F20', label: 'Small (PGA)' },
  acidic: { residues: ['E', 'D'], color: '#DD6030', label: 'Acidic (ED)' },
  basic: { residues: ['R', 'K'], color: '#7CAEC4', label: 'Basic (RK)' },
  hydrophobic: { residues: ['V', 'C', 'I', 'M', 'L'], color: '#B4B4B4', label: 'Hydrophobic (VCIML)' }
} as const;

type LetterSvgData = {
  path: string;
  viewBox: string;
  transformAttr?: string;
};

const STANDARD_AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';
const LABEL_WIDTH = 220;
const RIGHT_MARGIN = 20;
const TOP_MARGIN = 4;
const BOTTOM_MARGIN = 24;
const COLUMN_WIDTH = 18;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function parseFasta(fastaText: string): Sequence[] {
  const lines = fastaText.split(/\r?\n/).filter((line) => line.trim());
  const sequences: Sequence[] = [];
  let currentHeader = '';
  let currentSequence = '';

  for (const line of lines) {
    if (line.startsWith('>')) {
      if (currentHeader && currentSequence) {
        sequences.push({
          header: currentHeader.substring(1),
          sequence: currentSequence
        });
      }
      currentHeader = line;
      currentSequence = '';
      continue;
    }

    currentSequence += line.trim();
  }

  if (currentHeader && currentSequence) {
    sequences.push({
      header: currentHeader.substring(1),
      sequence: currentSequence
    });
  }

  return sequences;
}

function filterColumnsByGapThreshold(
  sequences: Sequence[],
  maxGapPercentage: number
): FilteredAlignment {
  if (sequences.length === 0) {
    return {
      sequences: [],
      keptColumnIndices: []
    };
  }

  const maxLength = Math.max(...sequences.map((sequence) => sequence.sequence.length));
  const keepPositions: number[] = [];

  for (let position = 0; position < maxLength; position += 1) {
    let gapCount = 0;
    let residueCount = 0;

    for (const sequence of sequences) {
      const residue = sequence.sequence[position]?.toUpperCase() ?? '-';
      if (STANDARD_AMINO_ACIDS.includes(residue)) {
        residueCount += 1;
      } else {
        gapCount += 1;
      }
    }

    const gapPercentage = (gapCount / sequences.length) * 100;
    if (residueCount > 0 && gapPercentage <= maxGapPercentage) {
      keepPositions.push(position);
    }
  }

  return {
    sequences: sequences.map((sequence) => ({
      ...sequence,
      sequence: keepPositions.map((position) => sequence.sequence[position] ?? '-').join('')
    })),
    keptColumnIndices: keepPositions
  };
}

function calculateLogoData(
  sequences: Sequence[],
  keptColumnIndices: number[]
): PositionLogoData[] {
  if (sequences.length === 0 || keptColumnIndices.length === 0) {
    return [];
  }

  const logoData: PositionLogoData[] = [];

  for (let position = 0; position < keptColumnIndices.length; position += 1) {
    const residueCounts: Record<string, number> = {};
    let gapCount = 0;

    for (const sequence of sequences) {
      const residue = sequence.sequence[position]?.toUpperCase() ?? '-';
      if (STANDARD_AMINO_ACIDS.includes(residue)) {
        residueCounts[residue] = (residueCounts[residue] || 0) + 1;
      } else {
        gapCount += 1;
      }
    }

    const residuesPresent = Object.keys(residueCounts);
    if (residuesPresent.length === 0) {
      continue;
    }

    const totalSequences = sequences.length;
    const frequencies: Record<string, number> = {};
    residuesPresent.forEach((residue) => {
      frequencies[residue] = residueCounts[residue] / totalSequences;
    });
    if (gapCount > 0) {
      frequencies['-'] = gapCount / totalSequences;
    }

    let entropy = 0;
    Object.values(frequencies).forEach((frequency) => {
      if (frequency > 0) {
        entropy -= frequency * Math.log2(frequency);
      }
    });

    const informationContent = Math.max(0, Math.log2(21) - entropy);
    const letterHeights: Record<string, number> = {};
    residuesPresent.forEach((residue) => {
      letterHeights[residue] = frequencies[residue] * informationContent;
    });

    logoData.push({
      alignmentColumn: keptColumnIndices[position] + 1,
      residueCounts,
      totalSequences,
      informationContent,
      letterHeights
    });
  }

  return logoData;
}

function getResidueNumberAtAlignmentColumn(
  rawSequence: string,
  alignmentColumnIndex: number
): number | null {
  const residueAtColumn = rawSequence[alignmentColumnIndex]?.toUpperCase() ?? '-';
  if (!STANDARD_AMINO_ACIDS.includes(residueAtColumn)) {
    return null;
  }

  let residueCount = 0;
  for (let columnIndex = 0; columnIndex <= alignmentColumnIndex; columnIndex += 1) {
    const residue = rawSequence[columnIndex]?.toUpperCase() ?? '-';
    if (STANDARD_AMINO_ACIDS.includes(residue)) {
      residueCount += 1;
    }
  }

  return residueCount;
}

function getNcbiProteinUrl(id: string): string {
  return `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(id)}`;
}

const SequenceLogoChart: React.FC<SequenceLogoChartProps> = ({
  geneName,
  alignmentPath,
  speciesGeneIdsByName = {},
  onLoaded,
  height = 140
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const svgPathCache = useRef<Record<string, LetterSvgData>>({});
  const [rawSequences, setRawSequences] = useState<Sequence[]>([]);
  const [loadedLetterTick, setLoadedLetterTick] = useState(0);
  const [gapThreshold, setGapThreshold] = useState(30);
  const [gapThresholdSlider, setGapThresholdSlider] = useState(30);
  const [gapThresholdInput, setGapThresholdInput] = useState('30');
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0);
  const [selectedSpecies, setSelectedSpecies] = useState<SelectedSpeciesEntry[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: string;
  }>({ visible: false, x: 0, y: 0, content: '' });
  const [groupColors, setGroupColors] = useState<Record<string, string>>(() => {
    const colors: Record<string, string> = {};
    Object.entries(aminoAcidGroups).forEach(([groupKey, group]) => {
      colors[groupKey] = group.color;
    });
    return colors;
  });

  const filteredAlignment = useMemo(
    () => filterColumnsByGapThreshold(rawSequences, gapThreshold),
    [rawSequences, gapThreshold]
  );
  const loadedSequences = filteredAlignment.sequences;
  const logoData = useMemo(
    () => calculateLogoData(filteredAlignment.sequences, filteredAlignment.keptColumnIndices),
    [filteredAlignment]
  );
  const chartHeight = height - TOP_MARGIN - BOTTOM_MARGIN;
  const chartWidth = Math.max(logoData.length * COLUMN_WIDTH, 700);
  const logoTrackWidth = chartWidth + RIGHT_MARGIN;
  const rawSequencesByHeader = useMemo(
    () => new Map(rawSequences.map((sequence) => [sequence.header, sequence])),
    [rawSequences]
  );

  const selectedSpeciesTracks = useMemo(
    () =>
      selectedSpecies.map((species) => ({
        ...species,
        matchedSequences: loadedSequences
          .filter((sequence) => species.gtdb.includes(sequence.header))
          .map((sequence) => {
            const rawSequence = rawSequencesByHeader.get(sequence.header)?.sequence ?? sequence.sequence;
            const matchIndex = species.gtdb.indexOf(sequence.header);
            const ncbiId = matchIndex >= 0 ? species.ncbi[matchIndex] ?? null : null;
            return {
              ...sequence,
              alignmentColumns: filteredAlignment.keptColumnIndices,
              rawSequence,
              ncbiId
            };
          })
      })),
    [filteredAlignment.keptColumnIndices, loadedSequences, rawSequencesByHeader, selectedSpecies]
  );
  const logoLabelWidth = selectedSpeciesTracks.length > 0 ? LABEL_WIDTH : 92;
  const totalWidth = logoLabelWidth + chartWidth + RIGHT_MARGIN;

  const commitGapThresholdValue = useCallback((value: number) => {
    const nextValue = Math.max(0, Math.min(100, Math.round(value)));
    setGapThreshold(nextValue);
    setGapThresholdSlider(nextValue);
    setGapThresholdInput(nextValue.toString());
  }, []);

  const commitGapThresholdInput = useCallback(() => {
    const digitsOnly = gapThresholdInput.replace(/[^\d]/g, '');
    const nextValue = digitsOnly === '' ? gapThreshold : Number(digitsOnly);
    commitGapThresholdValue(nextValue);
  }, [commitGapThresholdValue, gapThreshold, gapThresholdInput]);

  useEffect(() => {
    if (!alignmentPath) {
      setRawSequences([]);
      onLoaded?.();
      return;
    }

    fetch(withBasePath(alignmentPath))
      .then((response) => response.text())
      .then((fastaContent) => {
        setRawSequences(parseFasta(fastaContent));
        onLoaded?.();
      })
      .catch((error) => {
        console.error('Error loading alignment:', error);
        setRawSequences([]);
        onLoaded?.();
      });
  }, [alignmentPath, onLoaded]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSuggestions([]);
      setHighlightedSuggestionIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const nextSuggestions = await getSpeciesSuggestionsClient(normalizedQuery, 10);
        setSuggestions(nextSuggestions);
        setHighlightedSuggestionIndex(nextSuggestions.length > 0 ? 0 : -1);
      } catch {
        // Keep previous suggestions if lookup fails.
      }
    }, 140);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setHighlightedSuggestionIndex((current) => {
      if (suggestions.length === 0) {
        return -1;
      }
      if (current < 0 || current >= suggestions.length) {
        return 0;
      }
      return current;
    });
  }, [suggestions]);

  useEffect(() => {
    if (highlightedSuggestionIndex < 0) {
      return;
    }

    suggestionItemRefs.current[highlightedSuggestionIndex]?.scrollIntoView({
      block: 'nearest'
    });
  }, [highlightedSuggestionIndex]);

  useEffect(() => {
    const updateTheme = () => {
      setIsDarkMode(document.documentElement.getAttribute('data-theme') === 'dark');
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, []);

  const getResidueColor = useCallback(
    (residue: string): string => {
      const character = residue.toUpperCase();
      for (const [groupKey, group] of Object.entries(aminoAcidGroups)) {
        if (group.residues.includes(character as never)) {
          if (groupKey === 'small' && groupColors[groupKey] === '#231F20') {
            return isDarkMode ? '#FFFFFF' : '#231F20';
          }
          return groupColors[groupKey];
        }
      }
      return isDarkMode ? '#FFFFFF' : '#000000';
    },
    [groupColors, isDarkMode]
  );

  const resetColors = () => {
    const defaultColors: Record<string, string> = {};
    Object.entries(aminoAcidGroups).forEach(([groupKey, group]) => {
      defaultColors[groupKey] = group.color;
    });
    setGroupColors(defaultColors);
  };

  const addSpecies = useCallback(
    async (species: SpeciesSuggestion) => {
      const normalizedName = species.name.toLowerCase();
      if (selectedSpecies.some((item) => item.name.toLowerCase() === normalizedName)) {
        setQuery('');
        setIsSearchOpen(false);
        return;
      }

      setSelectedSpecies((current) => [
        ...current,
        {
          name: species.name,
          slug: species.slug,
          gtdb: [],
          ncbi: [],
          status: 'loading'
        }
      ]);

      setQuery('');
      setSuggestions([]);
      setHighlightedSuggestionIndex(0);
      setIsSearchOpen(false);

      try {
        const speciesKey = normalizeSpeciesQuery(formatSpeciesName(species.name));
        const record = speciesGeneIdsByName[speciesKey] ?? null;

        setSelectedSpecies((current) =>
          current.map((item) => {
            if (item.name !== species.name) {
              return item;
            }

            if (!record) {
              return {
                ...item,
                status: 'missing',
                error: `No ${geneName} IDs found for this species.`
              };
            }

            return {
              ...item,
              gtdb: record.gtdb,
              ncbi: record.ncbi,
              status: 'ready',
              error: undefined
            };
          })
        );
      } catch (error) {
        setSelectedSpecies((current) =>
          current.map((item) =>
            item.name === species.name
              ? {
                  ...item,
                  status: 'error',
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Failed to load IDs for this species.'
                }
              : item
          )
        );
      }
    },
    [geneName, selectedSpecies, speciesGeneIdsByName]
  );

  const removeSpecies = useCallback((speciesName: string) => {
    setSelectedSpecies((current) => current.filter((item) => item.name !== speciesName));
  }, []);

  const showTooltip = useCallback((event: { clientX: number; clientY: number }, content: string) => {
    setTooltip({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      content
    });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip((current) => ({ ...current, visible: false }));
  }, []);

  const updateTooltipPosition = useCallback((event: { clientX: number; clientY: number }) => {
    setTooltip((current) => ({
      ...current,
      x: event.clientX,
      y: event.clientY
    }));
  }, []);

  const loadCustomSvgLetter = useCallback(async (letter: string): Promise<LetterSvgData | null> => {
    if (svgPathCache.current[letter]) {
      return svgPathCache.current[letter];
    }

    try {
      const response = await fetch(withBasePath(`/tight_caps/${letter}.svg`));
      if (!response.ok) {
        return null;
      }

      const svgContent = await response.text();
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
      const svg = svgDoc.querySelector('svg');
      const path = svgDoc.querySelector('path');

      if (!svg || !path) {
        return null;
      }

      const result = {
        path: path.getAttribute('d') || '',
        viewBox: svg.getAttribute('viewBox') || '0 0 100 100',
        transformAttr: path.getAttribute('transform') || undefined
      };

      svgPathCache.current[letter] = result;
      return result;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const residuesToLoad = Array.from(
      new Set(
        loadedSequences.flatMap((sequence) =>
          Array.from(sequence.sequence.toUpperCase()).filter((residue) =>
            STANDARD_AMINO_ACIDS.includes(residue)
          )
        )
      )
    );

    if (residuesToLoad.length === 0) {
      return;
    }

    let cancelled = false;

    const preloadLetters = async () => {
      await Promise.all(residuesToLoad.map((residue) => loadCustomSvgLetter(residue)));
      if (!cancelled) {
        setLoadedLetterTick((current) => current + 1);
      }
    };

    void preloadLetters();

    return () => {
      cancelled = true;
    };
  }, [loadedSequences, loadCustomSvgLetter]);

  const downloadSVG = async () => {
    const chartContainer = chartContainerRef.current;
    const logoSvg = chartContainer?.querySelector('svg');
    if (!logoSvg) {
      return;
    }

    const residuesToLoad = Array.from(
      new Set(
        loadedSequences.flatMap((sequence) =>
          Array.from(sequence.sequence.toUpperCase()).filter((residue) =>
            STANDARD_AMINO_ACIDS.includes(residue)
          )
        )
      )
    );
    await Promise.all(residuesToLoad.map((residue) => loadCustomSvgLetter(residue)));

    const serializer = new XMLSerializer();
    const labelPadding = 12;
    const sequenceGlyphHeight = 24;
    const sequenceLabelRowHeight = 38;
    const rowGap = 12;
    const exportRows = selectedSpeciesTracks.flatMap((species) =>
      species.status === 'ready'
        ? species.matchedSequences.map((sequence) => ({
            speciesName: species.name,
            header: sequence.ncbiId ?? sequence.header,
            sequence: sequence.sequence
          }))
        : []
    );

    let currentY = 0;
    const svgSections: string[] = [];

    for (const row of exportRows) {
      const labelRightX = LABEL_WIDTH - labelPadding;
      svgSections.push(
        `<text x="${labelRightX}" y="${currentY + 14}" text-anchor="end" font-size="14" font-weight="600" fill="currentColor">${escapeXml(
          row.speciesName
        )}</text>`
      );
      svgSections.push(
        `<text x="${labelRightX}" y="${currentY + 30}" text-anchor="end" font-size="12" fill="#64748b">${escapeXml(
          row.header
        )}</text>`
      );

      Array.from(row.sequence).forEach((residue, positionIndex) => {
        if (residue === '-') {
          return;
        }

        const svgData = svgPathCache.current[residue];
        const color = getResidueColor(residue);
        const glyphCellX = LABEL_WIDTH + positionIndex * COLUMN_WIDTH;
        const glyphY = currentY + 4;

        if (!svgData) {
          svgSections.push(
            `<text x="${glyphCellX + COLUMN_WIDTH / 2}" y="${glyphY + 17}" text-anchor="middle" font-size="16" font-weight="600" fill="${escapeXml(
              color
            )}">${escapeXml(residue)}</text>`
          );
          return;
        }

        const [, , viewBoxWidth, viewBoxHeight] = svgData.viewBox.split(' ').map(Number);
        const targetWidth = residue === 'I' ? COLUMN_WIDTH * 0.2 : COLUMN_WIDTH * 0.9;
        const glyphX = glyphCellX + (COLUMN_WIDTH - targetWidth) / 2;
        svgSections.push(
          `<svg x="${glyphX}" y="${glyphY}" width="${targetWidth}" height="${sequenceGlyphHeight}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" preserveAspectRatio="none" overflow="visible">` +
            `<path d="${escapeXml(svgData.path)}" fill="${escapeXml(color)}"${
              svgData.transformAttr ? ` transform="${escapeXml(svgData.transformAttr)}"` : ''
            } />` +
          `</svg>`
        );
      });

      currentY += sequenceLabelRowHeight + rowGap;
    }

    const logoLabelCenterY = currentY + TOP_MARGIN + chartHeight / 2;
    svgSections.push(
      `<text x="${logoLabelWidth - labelPadding}" y="${logoLabelCenterY - 6}" text-anchor="end" font-size="18" font-weight="700" fill="#000000">Sequence Logo</text>`
    );
    svgSections.push(
      `<text x="${logoLabelWidth - labelPadding}" y="${logoLabelCenterY + 14}" text-anchor="end" font-size="12" fill="#64748b">(n=${loadedSequences.length})</text>`
    );

    const nestedLogoSvg = serializer
      .serializeToString(logoSvg)
      .replace(
        '<svg',
        `<svg x="${logoLabelWidth}" y="${currentY}" overflow="visible"`
      );
    svgSections.push(nestedLogoSvg);

    const exportHeight = currentY + height;
    const svgString =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${exportHeight}" viewBox="0 0 ${totalWidth} ${exportHeight}" fill="none">` +
      svgSections.join('') +
      `</svg>`;

    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`], {
      type: 'image/svg+xml'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sequence_logo.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderResidueGlyph = useCallback(
    (residue: string, key: string, tooltipContent?: string, size = 24) => {
      const isInteractive = Boolean(tooltipContent && residue !== '-');
      const resolvedTooltipContent = tooltipContent ?? '';
      const hoverProps =
        isInteractive
          ? {
              onMouseEnter: (event: React.MouseEvent<HTMLElement>) =>
                showTooltip(event, resolvedTooltipContent),
              onMouseMove: (event: React.MouseEvent<HTMLElement>) => updateTooltipPosition(event),
              onMouseLeave: () => hideTooltip()
            }
          : undefined;

      if (residue === '-') {
        return (
          <span
            key={key}
            className="inline-flex items-center justify-center"
            style={{
              width: `${COLUMN_WIDTH}px`,
              height: `${size}px`,
              fontSize: '16px',
              color: 'transparent',
              cursor: isInteractive ? 'pointer' : 'default'
            }}
            {...hoverProps}
          >
            ·
          </span>
        );
      }

      const svgData = svgPathCache.current[residue];
      const color = getResidueColor(residue);

      if (!svgData) {
        return (
          <span
            key={key}
            className="inline-flex items-center justify-center font-semibold"
            style={{
              width: `${COLUMN_WIDTH}px`,
              height: `${size}px`,
              fontSize: '16px',
              color,
              cursor: isInteractive ? 'pointer' : 'default'
            }}
            {...hoverProps}
          >
            {residue}
          </span>
        );
      }

      const [, , viewBoxWidth, viewBoxHeight] = svgData.viewBox.split(' ').map(Number);
      const targetWidth = residue === 'I' ? COLUMN_WIDTH * 0.2 : COLUMN_WIDTH * 0.9;

      return (
        <span
          key={key}
          className="inline-flex items-center justify-center"
          style={{
            width: `${COLUMN_WIDTH}px`,
            height: `${size}px`,
            cursor: isInteractive ? 'pointer' : 'default'
          }}
          {...hoverProps}
        >
          <svg
            width={targetWidth}
            height={size}
            viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
            preserveAspectRatio="none"
            style={{ display: 'block', overflow: 'visible' }}
          >
            <path
              d={svgData.path}
              fill={color}
              transform={svgData.transformAttr}
            />
          </svg>
        </span>
      );
    },
    [getResidueColor, hideTooltip, showTooltip, updateTooltipPosition]
  );

  useEffect(() => {
    let cancelled = false;
    const chartContainer = chartContainerRef.current;
    if (!chartContainer) {
      return;
    }

    chartContainer.innerHTML = '';
    if (logoData.length === 0) {
      return;
    }

    const renderChart = async () => {
      if (cancelled || !chartContainer) {
        return;
      }

      const totalHeight = height;

      const svg = d3
        .select(chartContainer)
        .append('svg')
        .attr('width', logoTrackWidth)
        .attr('height', totalHeight)
        .attr('viewBox', `0 0 ${logoTrackWidth} ${totalHeight}`)
        .style('display', 'block');

      const chartGroup = svg
        .append('g')
        .attr('transform', `translate(0,${TOP_MARGIN})`);

      const x = d3
        .scaleBand()
        .domain(logoData.map((item) => item.alignmentColumn.toString()))
        .range([0, chartWidth])
        .paddingInner(0.03);

      const maxInformationContent = Math.max(...logoData.map((item) => item.informationContent), 1);
      const y = d3.scaleLinear().domain([0, maxInformationContent]).range([chartHeight, 0]);

      for (const positionData of logoData) {
        const positionX = x(positionData.alignmentColumn.toString());
        if (positionX === undefined) {
          continue;
        }

        const positionWidth = x.bandwidth();
        const sortedResidues = Object.entries(positionData.letterHeights).sort(
          ([, left], [, right]) => left - right
        );
        let stackY = y(0);

        for (const [residue, letterBits] of sortedResidues) {
          if (cancelled || letterBits <= 0) {
            continue;
          }

          const letterHeightPx = y(0) - y(letterBits);
          const letterBaselineY = stackY;
          const letterX = positionX + positionWidth / 2;
          const svgData = await loadCustomSvgLetter(residue);

          if (svgData) {
            const [, , viewBoxWidth, viewBoxHeight] = svgData.viewBox.split(' ').map(Number);
            const targetWidth = residue === 'I' ? positionWidth * 0.2 : positionWidth * 0.9;
            const nestedSvg = chartGroup
              .append('svg')
              .attr('x', letterX - targetWidth / 2)
              .attr('y', letterBaselineY - letterHeightPx)
              .attr('width', targetWidth)
              .attr('height', letterHeightPx)
              .attr('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`)
              .attr('preserveAspectRatio', 'none')
              .style('overflow', 'visible')
              .style('cursor', 'pointer');

            const path = nestedSvg
              .append('path')
              .attr('d', svgData.path)
              .attr('fill', getResidueColor(residue));

            if (svgData.transformAttr) {
              path.attr('transform', svgData.transformAttr);
            }

            nestedSvg
              .on('mouseover', (event: MouseEvent) => {
                const frequency = positionData.residueCounts[residue] / positionData.totalSequences;
                showTooltip(
                  event,
                  `<strong>Alignment Column:</strong> ${positionData.alignmentColumn}<br/>` +
                    `<strong>Residue:</strong> ${residue}<br/>` +
                    `<strong>Frequency:</strong> ${(frequency * 100).toFixed(1)}%<br/>` +
                    `<strong>Information:</strong> ${letterBits.toFixed(2)} bits`
                );
              })
              .on('mousemove', (event: MouseEvent) => updateTooltipPosition(event))
              .on('mouseout', () => hideTooltip());
          }

          stackY -= letterHeightPx;
        }
      }
    };

    void renderChart();

    return () => {
      cancelled = true;
      setTooltip((current) => ({ ...current, visible: false }));
    };
  }, [loadedSequences, height, getResidueColor, hideTooltip, loadCustomSvgLetter, showTooltip, updateTooltipPosition]);

  return (
    <div className="rounded-lg max-w-full overflow-hidden">
      <div className="p-6 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold m-0">Sequence Comparison with Sequence Logo</h2>
        {loadedSequences.length > 0 ? (
          <button
            type="button"
            onClick={downloadSVG}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            Download SVG
          </button>
        ) : null}
      </div>

      <div className="p-6 min-w-0 max-w-full overflow-hidden">
        <div className="grid gap-3 mb-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start w-full">
            <div className="w-full xl:flex-1 min-w-0">
              <div className="autocomplete-shell w-full">
                <span className="search-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <circle
                      cx="11"
                      cy="11"
                      r="7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <line
                      x1="16.65"
                      y1="16.65"
                      x2="21"
                      y2="21"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <input
                  type="text"
                  className="species-search-input"
                  placeholder="Add species to compare against the logo..."
                  value={query}
                  onFocus={() => {
                    if (hideTimerRef.current) {
                      clearTimeout(hideTimerRef.current);
                    }
                    setIsSearchOpen(true);
                  }}
                  onBlur={() => {
                    hideTimerRef.current = setTimeout(() => setIsSearchOpen(false), 120);
                  }}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setIsSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setIsSearchOpen(true);
                      setHighlightedSuggestionIndex((current) =>
                        suggestions.length === 0 ? -1 : (current + 1 + suggestions.length) % suggestions.length
                      );
                      return;
                    }

                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setIsSearchOpen(true);
                      setHighlightedSuggestionIndex((current) =>
                        suggestions.length === 0
                          ? -1
                          : (current - 1 + suggestions.length) % suggestions.length
                      );
                      return;
                    }

                    if (event.key === 'Escape') {
                      setIsSearchOpen(false);
                      return;
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const match =
                        suggestions[highlightedSuggestionIndex] ??
                        suggestions[0];
                      if (match) {
                        void addSpecies(match);
                      }
                    }
                  }}
                  aria-label="Add species sequence"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={isSearchOpen && suggestions.length > 0}
                  aria-controls="species-suggestions-listbox"
                  aria-activedescendant={
                    isSearchOpen && highlightedSuggestionIndex >= 0
                      ? `species-suggestion-${suggestions[highlightedSuggestionIndex]?.slug ?? ''}`
                      : undefined
                  }
                  autoComplete="off"
                />
                {isSearchOpen && suggestions.length > 0 ? (
                  <div
                    id="species-suggestions-listbox"
                    className="autocomplete-dropdown"
                    onMouseDown={(event) => event.preventDefault()}
                    role="listbox"
                  >
                    {suggestions.map((item, index) => (
                      <button
                        ref={(element) => {
                          suggestionItemRefs.current[index] = element;
                        }}
                        key={item.slug}
                        id={`species-suggestion-${item.slug}`}
                        type="button"
                        className={`autocomplete-item${
                          index === highlightedSuggestionIndex ? ' autocomplete-item-active' : ''
                        }`}
                        onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          void addSpecies(item);
                        }}
                        role="option"
                        aria-selected={index === highlightedSuggestionIndex}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="w-full xl:flex-1 min-w-0">
              <label className="block text-sm font-medium mb-2" htmlFor="gap-threshold-slider">
                Maximum Gap Percentage
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="gap-threshold-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={gapThresholdSlider}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setGapThresholdSlider(nextValue);
                    setGapThresholdInput(nextValue.toString());
                  }}
                  onPointerUp={() => commitGapThresholdValue(gapThresholdSlider)}
                  onKeyUp={() => commitGapThresholdValue(gapThresholdSlider)}
                  className="flex-1"
                  style={{ accentColor: 'var(--header-bg-mid)' }}
                  aria-label="Gap filter percentage"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={gapThresholdInput}
                    onChange={(event) => {
                      const digitsOnly = event.target.value.replace(/[^\d]/g, '');
                      if (digitsOnly.length > 3) {
                        return;
                      }
                      setGapThresholdInput(digitsOnly);
                    }}
                    onBlur={commitGapThresholdInput}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitGapThresholdInput();
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-16 rounded-md border border-slate-400 dark:border-slate-500 bg-transparent px-2 py-1 text-sm text-center outline-none focus:border-slate-500 dark:focus:border-slate-300"
                    aria-label="Gap filter percentage value"
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-300">%</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                Show alignment columns with at most {gapThresholdSlider}% gaps
              </p>
            </div>
          </div>

          {selectedSpecies.length > 0 ? (
            <div className="chip-list">
              {selectedSpecies.map((species) => (
                <span key={species.name} className="chip">
                  {species.name}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeSpecies(species.name)}
                    aria-label={`Remove ${species.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {loadedSequences.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            No alignment data is available for this gene yet.
          </p>
        ) : (
          <div className="relative w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden">
            <div
              className="inline-block min-h-[180px] align-top"
              style={{ width: `${totalWidth}px`, minWidth: `${totalWidth}px` }}
            >
              {selectedSpeciesTracks.length > 0 ? (
                <div className="mb-1">
                  <div className="grid gap-3">
                    {selectedSpeciesTracks.map((species) => (
                      <div key={species.name} className="grid gap-2">
                        {species.status === 'loading' ? (
                          <div className="text-sm text-slate-600 dark:text-slate-300">
                            Loading {species.name}...
                          </div>
                        ) : null}

                        {species.status === 'error' || species.status === 'missing' ? (
                          <div className="text-sm text-slate-600 dark:text-slate-300">
                            {species.name}: {species.error}
                          </div>
                        ) : null}

                        {species.status === 'ready' && species.matchedSequences.length === 0 ? (
                          <div className="text-sm text-slate-600 dark:text-slate-300">
                            {species.name}: no aligned sequence matched the available GTDB IDs.
                          </div>
                        ) : null}

                        {species.status === 'ready'
                          ? species.matchedSequences.map((sequence, index) => (
                              <div
                                key={`${species.name}-${sequence.header}-${index}`}
                                className="flex items-start"
                              >
                                <div
                                  className="shrink-0 pr-3 text-right"
                                  style={{ width: `${LABEL_WIDTH}px` }}
                                >
                                  <p className="text-sm font-semibold m-0">{species.name}</p>
                                  {sequence.ncbiId ? (
                                    <a
                                      href={getNcbiProteinUrl(sequence.ncbiId)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="species-id-link text-xs break-all"
                                    >
                                      {sequence.ncbiId}
                                    </a>
                                  ) : (
                                    <p className="text-xs text-slate-600 dark:text-slate-300 m-0 break-all">
                                      {sequence.header}
                                    </p>
                                  )}
                                </div>
                                <div
                                  className="flex shrink-0"
                                  style={{ width: `${chartWidth}px` }}
                                >
                                  {Array.from(sequence.sequence).map((residue, positionIndex) => (
                                    renderResidueGlyph(
                                      residue,
                                      `${sequence.header}-${positionIndex}-${loadedLetterTick}`,
                                      residue === '-'
                                        ? undefined
                                        : `${species.name}<br/>` +
                                          `<strong>Residue Number:</strong> ${
                                            getResidueNumberAtAlignmentColumn(
                                              sequence.rawSequence,
                                              sequence.alignmentColumns[positionIndex]
                                            ) ?? 'n/a'
                                          }<br/>` +
                                          `<strong>Residue:</strong> ${residue}`,
                                      24
                                    )
                                  ))}
                                </div>
                                <div style={{ width: `${RIGHT_MARGIN}px` }} />
                              </div>
                            ))
                          : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-start">
                <div
                  className="shrink-0"
                  style={{
                    width: `${logoLabelWidth}px`,
                    minHeight: `${height}px`,
                    paddingRight: selectedSpeciesTracks.length > 0 ? '0.75rem' : '0.25rem'
                  }}
                >
                  <div
                    className="flex items-center justify-end text-right"
                    style={{
                      height: `${chartHeight}px`,
                      marginTop: `${TOP_MARGIN}px`
                    }}
                  >
                    <div>
                      <p className="text-lg font-bold text-black leading-none m-0">
                        Sequence Logo
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-tight m-0">
                        (n={loadedSequences.length})
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  ref={chartContainerRef}
                  className="min-h-[180px] shrink-0"
                  style={{ width: `${logoTrackWidth}px`, minWidth: `${logoTrackWidth}px` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-6 pt-0">
        <div className="flex flex-wrap gap-4 items-center justify-center">
          {Object.entries(aminoAcidGroups).map(([groupKey, group]) => {
            const color =
              groupKey === 'small' && groupColors[groupKey] === '#231F20' && isDarkMode
                ? '#FFFFFF'
                : groupColors[groupKey];

            return (
              <div key={groupKey} className="flex items-center gap-2">
                <label
                  className="relative block w-5 h-5 rounded border overflow-hidden cursor-pointer"
                  title={`Color for ${group.label}`}
                >
                  <span
                    className="absolute inset-0"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <input
                    type="color"
                    value={color}
                    onChange={(event) =>
                      setGroupColors((current) => ({
                        ...current,
                        [groupKey]: event.target.value
                      }))
                    }
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label={`Color for ${group.label}`}
                  />
                </label>
                <span className="text-sm">{group.label}</span>
              </div>
            );
          })}
          <button
            type="button"
            onClick={resetColors}
            className="px-3 py-1 text-xs rounded border hover:bg-black/5 dark:hover:bg-white/10"
          >
            Reset
          </button>
        </div>
      </div>

      {tooltip.visible && typeof window !== 'undefined'
        ? createPortal(
            <div
              className="fixed z-50 pointer-events-none bg-white text-black dark:bg-black dark:text-white text-xs sm:text-sm rounded border border-gray-300 dark:border-gray-600 px-2 py-1 max-w-sm break-words shadow-lg"
              style={{
                left: Math.min(tooltip.x + 10, window.innerWidth - 220),
                top: Math.max(tooltip.y - 60, 10)
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: tooltip.content }} />
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

export default SequenceLogoChart;