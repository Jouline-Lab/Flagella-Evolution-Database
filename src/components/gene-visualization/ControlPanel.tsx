'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { RefreshCw, ChevronDown, Info } from 'lucide-react'
import type { TaxonomicLevel } from '@/types/gene-visualization'

/** ~18rem max width; keep tooltips on-screen when the info icon is near an edge. */
const VIZ_HINT_MAX_W_PX = 288

function VizControlHint({
  id,
  label,
  children,
  tooltipMaxWidthPx = VIZ_HINT_MAX_W_PX,
  tooltipFixedWidth = false,
}: {
  id: string
  label: string
  children: React.ReactNode
  /** Wider tooltips (e.g. example table) need matching clamp math */
  tooltipMaxWidthPx?: number
  /** Use fixed width so nested grids/tables get a real containing block (e.g. TSV example). */
  tooltipFixedWidth?: boolean
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const updatePos = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    const vw = typeof window !== 'undefined' ? window.innerWidth : tooltipMaxWidthPx
    const maxW = Math.min(tooltipMaxWidthPx, vw - 2 * margin)
    const half = maxW / 2
    const centerX = r.left + r.width / 2
    const left = Math.min(vw - margin - half, Math.max(margin + half, centerX))
    setPos({ top: Math.round(r.bottom + 6), left: Math.round(left) })
  }, [tooltipMaxWidthPx])

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, updatePos])

  const tooltip =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <span
        id={id}
        role="tooltip"
        style={
          tooltipFixedWidth
            ? {
                top: pos.top,
                left: pos.left,
                width: `min(${tooltipMaxWidthPx}px, calc(100vw - 1rem))`,
              }
            : {
                top: pos.top,
                left: pos.left,
                maxWidth: `min(${tooltipMaxWidthPx}px, calc(100vw - 1rem))`,
              }
        }
        className={
          tooltipFixedWidth
            ? 'viz-opaque-menu pointer-events-none fixed z-[100110] box-border min-w-0 -translate-x-1/2 break-words rounded-md border border-gray-300 bg-white px-2 py-1.5 text-left text-[11px] font-normal leading-snug text-gray-900 shadow-lg'
            : 'viz-opaque-menu pointer-events-none fixed z-[100110] box-border w-max min-w-0 max-w-[calc(100vw-1rem)] -translate-x-1/2 break-words rounded-md border border-gray-300 bg-white px-2 py-1.5 text-left text-[11px] font-normal leading-snug text-gray-900 shadow-lg'
        }
      >
        {children}
      </span>,
      document.body
    )

  return (
    <span className="inline-flex shrink-0 align-middle">
      <button
        ref={btnRef}
        type="button"
        className="rounded-full p-0.5 text-gray-500 outline-none hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => { setOpen(true); updatePos() }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => { setOpen(true); updatePos() }}
        onBlur={() => setOpen(false)}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </button>
      {tooltip}
    </span>
  )
}

interface ControlPanelProps {
  onLoadTSV: () => void
  selectedLevels: TaxonomicLevel[]
  onSelectedLevelsChange: (levels: TaxonomicLevel[]) => void
  onResetFilter: () => void
  geneNames: string[]
  onAddDifference: (gene1: string, gene2: string, useCounts: boolean) => void
  normalizeLevel: TaxonomicLevel | '__ALL__' | null
  onNormalizeLevel: (level: TaxonomicLevel | '__ALL__' | null) => void
  onFilterAssemblies: () => void
  onFilterBySize: (level: TaxonomicLevel, threshold: number) => void
  onFilterByRugMin: (min: number, rugKey?: string | 'ANY') => void
  mode: 'all' | 'display' | 'filters' | 'analysis'

  // Dataset selection
  datasetOptions: readonly string[]
  selectedDataset: string
  onDatasetChange: (dataset: string) => void
  datasetLabels?: Record<string, string>

  // Autocomplete component
  SearchLineageInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.ReactElement

  // Rug mode selector
  rugMode: 'normalized' | 'binary' | 'heatmap'
  onRugModeChange: (mode: 'normalized' | 'binary' | 'heatmap') => void
  showTopTree: boolean
  onShowTopTreeChange: (show: boolean) => void
  canShowTopTree: boolean
  treeLayoutMode: 'phlogram' | 'cladogram'
  onTreeLayoutModeChange: (mode: 'phlogram' | 'cladogram') => void
  tipExtensionMode: 'none' | 'solid' | 'dashed'
  onTipExtensionModeChange: (mode: 'none' | 'solid' | 'dashed') => void
}

const allLevels: TaxonomicLevel[] = ['phylum', 'class', 'order', 'family', 'genus', 'species']

export function ControlPanel({
  onLoadTSV,
  selectedLevels,
  onSelectedLevelsChange,
  onResetFilter,
  geneNames,
  onAddDifference,
  normalizeLevel,
  onNormalizeLevel,
  onFilterAssemblies,
  onFilterBySize,
  onFilterByRugMin,
  datasetOptions,
  selectedDataset,
  onDatasetChange,
  datasetLabels,
  SearchLineageInput,
  rugMode,
  onRugModeChange,
  showTopTree,
  onShowTopTreeChange,
  canShowTopTree,
  treeLayoutMode,
  onTreeLayoutModeChange,
  tipExtensionMode,
  onTipExtensionModeChange,
}: ControlPanelProps) {
  const [diffGene1, setDiffGene1] = useState('')
  const [diffGene2, setDiffGene2] = useState('')
  const [useCounts, setUseCounts] = useState(false)
  const [sizeFilterLevel, setSizeFilterLevel] = useState<TaxonomicLevel | ''>('')
  const [sizeThreshold, setSizeThreshold] = useState(0)
  const [rugMin, setRugMin] = useState(0)
  const [rugKey, setRugKey] = useState<string | 'ANY'>('ANY')
  const [levelsOpen, setLevelsOpen] = useState(false)
  const levelsRef = useRef<HTMLDivElement>(null)
  const levelsButtonRef = useRef<HTMLButtonElement>(null)
  const levelsMenuRef = useRef<HTMLDivElement>(null)
  const [levelsMenuPos, setLevelsMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 176 })
  const [vizOpen, setVizOpen] = useState(false)
  const vizRef = useRef<HTMLDivElement>(null)
  const vizButtonRef = useRef<HTMLButtonElement>(null)
  const vizMenuRef = useRef<HTMLDivElement>(null)
  const [vizMenuPos, setVizMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 220 })
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)
  const [filterMenuPos, setFilterMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 320 })
  const [compareOpen, setCompareOpen] = useState(false)
  const compareRef = useRef<HTMLDivElement>(null)
  const compareButtonRef = useRef<HTMLButtonElement>(null)
  const compareMenuRef = useRef<HTMLDivElement>(null)
  const [compareMenuPos, setCompareMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 280 })
  const [treeOpen, setTreeOpen] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)
  const treeButtonRef = useRef<HTMLButtonElement>(null)
  const treeMenuRef = useRef<HTMLDivElement>(null)
  const [treeMenuPos, setTreeMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 260 })
  const lastSizeAppliedRef = useRef<{ level: TaxonomicLevel | ''; threshold: number }>({ level: '', threshold: 0 })
  const lastRugAppliedRef = useRef<{ min: number; key: string | 'ANY' }>({ min: 0, key: 'ANY' })
  const childSelectOpenCountRef = useRef(0)
  const updateChildSelectOpen = useCallback((open: boolean) => {
    childSelectOpenCountRef.current = Math.max(0, childSelectOpenCountRef.current + (open ? 1 : -1))
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const inButton = !!levelsRef.current && levelsRef.current.contains(target)
      const inMenu = !!levelsMenuRef.current && levelsMenuRef.current.contains(target)
      const inVizButton = !!vizRef.current && vizRef.current.contains(target)
      const inVizMenu = !!vizMenuRef.current && vizMenuRef.current.contains(target)
      const inFilterButton = !!filterRef.current && filterRef.current.contains(target)
      const inFilterMenu = !!filterMenuRef.current && filterMenuRef.current.contains(target)
      const inCompareButton = !!compareRef.current && compareRef.current.contains(target)
      const inCompareMenu = !!compareMenuRef.current && compareMenuRef.current.contains(target)
      const inTreeButton = !!treeRef.current && treeRef.current.contains(target)
      const inTreeMenu = !!treeMenuRef.current && treeMenuRef.current.contains(target)
      if (childSelectOpenCountRef.current === 0) {
        if (!inButton && !inMenu) setLevelsOpen(false)
        if (!inVizButton && !inVizMenu) setVizOpen(false)
        if (!inFilterButton && !inFilterMenu) setFilterOpen(false)
        if (!inCompareButton && !inCompareMenu) setCompareOpen(false)
        if (!inTreeButton && !inTreeMenu) setTreeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLevelsOpen(false)
        setVizOpen(false)
        setFilterOpen(false)
        setCompareOpen(false)
        setTreeOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  useEffect(() => {
    if (!levelsOpen) return
    const updatePosition = () => {
      const btn = levelsButtonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setLevelsMenuPos({ top: Math.round(rect.bottom + 4), left: Math.round(rect.left), width: Math.round(rect.width) })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [levelsOpen])

  useEffect(() => {
    if (!vizOpen) return
    const updatePosition = () => {
      const btn = vizButtonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setVizMenuPos({ top: Math.round(rect.bottom + 4), left: Math.round(rect.left), width: Math.round(rect.width) || 220 })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [vizOpen])

  useEffect(() => {
    if (!filterOpen) return
    const updatePosition = () => {
      const btn = filterButtonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setFilterMenuPos({ top: Math.round(rect.bottom + 4), left: Math.round(rect.left), width: Math.round(rect.width) || 320 })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [filterOpen])

  useEffect(() => {
    if (!compareOpen) return
    const updatePosition = () => {
      const btn = compareButtonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setCompareMenuPos({ top: Math.round(rect.bottom + 4), left: Math.round(rect.left), width: Math.round(rect.width) || 280 })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [compareOpen])

  useEffect(() => {
    if (!treeOpen) return
    const updatePosition = () => {
      const btn = treeButtonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setTreeMenuPos({ top: Math.round(rect.bottom + 4), left: Math.round(rect.left), width: Math.round(rect.width) || 260 })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [treeOpen])

  const handleLevelChange = (level: TaxonomicLevel, checked: boolean) => {
    if (checked) {
      onSelectedLevelsChange([...selectedLevels, level])
    } else {
      onSelectedLevelsChange(selectedLevels.filter(l => l !== level))
    }
  }

  const handleAddDifference = () => {
    if (diffGene1 && diffGene2 && diffGene1 !== diffGene2) {
      onAddDifference(diffGene1, diffGene2, useCounts)
    }
  }

  const handleSizeFilter = useCallback(() => {
    if (sizeFilterLevel) {
      onFilterBySize(sizeFilterLevel as TaxonomicLevel, sizeThreshold)
      lastSizeAppliedRef.current = { level: sizeFilterLevel as TaxonomicLevel, threshold: sizeThreshold }
    }
  }, [sizeFilterLevel, sizeThreshold, onFilterBySize])

  const applyRugMin = useCallback((min: number, key: string | 'ANY') => {
    onFilterByRugMin(min, key)
    lastRugAppliedRef.current = { min, key }
  }, [onFilterByRugMin])

  // When closing the filter dropdown, apply any pending filters
  useEffect(() => {
    if (!filterOpen) {
      // Only apply if values changed since last apply
      if (
        sizeFilterLevel &&
        (lastSizeAppliedRef.current.level !== sizeFilterLevel || lastSizeAppliedRef.current.threshold !== sizeThreshold)
      ) {
        handleSizeFilter()
      }
      if (
        lastRugAppliedRef.current.min !== rugMin ||
        lastRugAppliedRef.current.key !== rugKey
      ) {
        applyRugMin(rugMin, rugKey)
      }
    }
  }, [filterOpen, sizeFilterLevel, sizeThreshold, rugMin, rugKey, handleSizeFilter, applyRugMin])

  return (
    <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-1.5 xl:flex-nowrap w-full text-[13px] text-gray-900">
      {/* Data Loading */}
      <div className="flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit h-16">
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Load Data</span>
          <VizControlHint
            id="viz-cp-hint-load"
            label="TSV format and example"
            tooltipMaxWidthPx={340}
            tooltipFixedWidth
          >
            <p className="mb-2 text-[11px] leading-snug">
              Visualize your custom data: tab-separated, one row per assembly. Header row; an{' '}
              <span className="font-mono text-[10px]">assembly</span> column; gene columns named{' '}
              <span className="font-mono text-[10px]">yourGene_count</span>. Numeric counts only. Assemblies must exist in the selected GTDB set.
            </p>
            <div className="mb-0 w-full min-w-0 rounded border border-gray-300 overflow-hidden text-[10px] font-mono leading-snug text-left text-gray-900">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,4.75rem)_minmax(0,4.75rem)] border-b border-gray-300 bg-gray-100 font-semibold">
                <div className="min-w-0 px-1 py-0.5 align-top break-all">assembly</div>
                <div className="min-w-0 px-1 py-0.5 text-center break-all">flgA_count</div>
                <div className="min-w-0 px-1 py-0.5 text-center break-all">flgB_count</div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,4.75rem)_minmax(0,4.75rem)] border-b border-gray-200">
                <div className="min-w-0 px-1 py-0.5 break-all">GCA_1234567890.1</div>
                <div className="min-w-0 px-1 py-0.5 text-center break-all">2</div>
                <div className="min-w-0 px-1 py-0.5 text-center break-all">0</div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,4.75rem)_minmax(0,4.75rem)]">
                <div className="min-w-0 px-1 py-0.5 break-all">GCA_9876543210.2</div>
                <div className="min-w-0 px-1 py-0.5 text-center break-all">1</div>
                <div className="min-w-0 px-1 py-0.5 text-center break-all">3</div>
              </div>
            </div>
          </VizControlHint>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={onLoadTSV} size="sm" className="h-7 text-xs px-2">Load TSV</Button>
        </div>
      </div>

      {/* Choose Taxonomy */}
      <div className="flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit h-16">
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Choose Taxonomy</span>
          <VizControlHint id="viz-cp-hint-dataset" label="About Choose Taxonomy">
            Choose <span className="font-semibold">GTDB r214</span> to visualize along the standard GTDB taxonomic backbone, or{' '}
            <span className="font-semibold">Flagella Phylogeny</span> to use the custom flagella-based ordering.
          </VizControlHint>
        </div>
        <div className="flex items-center gap-1">
          <Select value={selectedDataset} onValueChange={onDatasetChange}>
            <SelectTrigger className="h-7 text-xs w-44">
              <SelectValue placeholder="GTDB r214 or flagella phylogeny" />
            </SelectTrigger>
            <SelectContent>
              {datasetOptions.map((file) => (
                <SelectItem key={file} value={file} className="text-xs">
                  {datasetLabels?.[file] ?? file.replace(/\.json$/, '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lineage Levels */}
      <div className={"relative flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit overflow-visible h-16"}>
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Ranks to Show</span>
          <VizControlHint id="viz-cp-hint-ranks" label="About Ranks to Show">
            Which taxonomic ranks appear as segments in each bar.
          </VizControlHint>
        </div>
        <div className="relative" ref={levelsRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2 w-44 justify-between whitespace-nowrap"
            aria-haspopup="listbox"
            aria-expanded={levelsOpen}
            onClick={() => setLevelsOpen(v => !v)}
            ref={levelsButtonRef}
          >
            <span>{selectedLevels.length > 0 ? `${selectedLevels.length} selected` : 'Select levels'}</span>
            <ChevronDown className="w-3 h-3 ml-1" />
          </Button>

          {levelsOpen && createPortal(
            <div
              ref={levelsMenuRef}
              role="listbox"
              aria-label="Ranks"
              className="viz-opaque-menu fixed z-[100100] bg-white border border-gray-300 rounded-md shadow-md p-2 max-h-80 overflow-auto text-gray-900"
              style={{ top: levelsMenuPos.top, left: levelsMenuPos.left, width: Math.max(180, levelsMenuPos.width) }}
            >
              <div className="flex flex-col gap-1">
                {(['phylum', 'class', 'order', 'family', 'genus', 'species'] as TaxonomicLevel[]).map(level => (
                  <label key={level} className="flex items-center gap-2 text-xs text-gray-900 cursor-pointer px-1 py-0.5 rounded hover:bg-gray-100">
                    <Checkbox
                      checked={selectedLevels.includes(level)}
                      onCheckedChange={(checked) => handleLevelChange(level, checked as boolean)}
                    />
                    <span className="capitalize">{level}</span>
                  </label>
                ))}
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* Search Lineage */}
      <div className="flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit h-16">
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Search Lineage</span>
          <VizControlHint id="viz-cp-hint-lineage" label="About Search Lineage">
            Jump to a specific lineage. Use the reset button to return to the full view.
          </VizControlHint>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-44">
            <SearchLineageInput placeholder="Search lineage" />
          </div>
          <Button onClick={onResetFilter} size="sm" variant="outline" className="px-2 h-7">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Visualization Dropdown */}
      <div className="relative flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit h-16" ref={vizRef}>
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Visualization</span>
          <VizControlHint id="viz-cp-hint-viz" label="About Visualization" tooltipMaxWidthPx={320}>
            <span className="block">
              <span className="font-semibold">Normalize width</span> reduces taxon-sampling bias: at the rank you pick, every taxon gets the same bar width so abundant lineages do not dominate the plot.
            </span>
            <span className="mt-2 block">
              <span className="font-semibold">Normalize counts</span> changes how each gene track uses abundance—presence/absence (binary), scaled counts (normalized), or a color heatmap.
            </span>
          </VizControlHint>
        </div>
        <Button
          ref={vizButtonRef}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2 w-44 justify-between whitespace-nowrap"
          aria-haspopup="menu"
          aria-expanded={vizOpen}
          onClick={() => setVizOpen(v => !v)}
        >
          <span>Settings</span>
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
        {vizOpen && createPortal(
          <div
            ref={vizMenuRef}
            className="viz-opaque-menu fixed z-[100100] bg-white border rounded-md shadow-md p-2"
            style={{ top: vizMenuPos.top, left: vizMenuPos.left, width: vizMenuPos.width }}
          >
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-28 text-gray-800">Normalize width</span>
                <Select value={normalizeLevel ?? 'none'} onValueChange={(v) => { onNormalizeLevel(v === 'none' ? null : (v === '__ALL__' ? '__ALL__' : v as TaxonomicLevel)); setVizOpen(false) }} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-xs w-44">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200] w-44 min-w-[11rem]">
                    <SelectItem value="none">None</SelectItem>
                    {allLevels.map(level => (
                      <SelectItem key={level} value={level}>
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-28 text-gray-800">Normalize counts</span>
                <Select value={rugMode} onValueChange={onRugModeChange} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-xs w-44">
                    <SelectValue placeholder="Mode" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200] w-44 min-w-[11rem]">
                    <SelectItem value="binary">Binary</SelectItem>
                    <SelectItem value="normalized">Normalized</SelectItem>
                    <SelectItem value="heatmap">Heatmap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* Tree Visualization Dropdown */}
      <div className="relative flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit h-16" ref={treeRef}>
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Tree Visualization</span>
          <VizControlHint id="viz-cp-hint-tree" label="About Tree Visualization">
            Visualize the taxonomic hierarchy between taxa with an optional tree above the bars.
          </VizControlHint>
        </div>
        <Button
          ref={treeButtonRef}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2 w-44 justify-between whitespace-nowrap"
          aria-haspopup="menu"
          aria-expanded={treeOpen}
          onClick={() => setTreeOpen(v => !v)}
        >
          <span>Settings</span>
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
        {treeOpen && createPortal(
          <div
            ref={treeMenuRef}
            className="viz-opaque-menu fixed z-[100100] bg-white border rounded-md shadow-md p-2"
            style={{ top: treeMenuPos.top, left: treeMenuPos.left, width: treeMenuPos.width }}
          >
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-800">Show Tree</span>
                <label
                  className={`flex items-center gap-2 text-xs ${canShowTopTree ? 'text-gray-900 cursor-pointer' : 'text-gray-500 cursor-not-allowed'}`}
                  title={canShowTopTree ? 'Show phylogenetic tree above bars' : 'Available for GTDB r214 dataset'}
                >
                  <Checkbox
                    checked={showTopTree}
                    disabled={!canShowTopTree}
                    onCheckedChange={(checked) => onShowTopTreeChange(Boolean(checked))}
                  />
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-800">Tip Extension</span>
                <Select value={tipExtensionMode} onValueChange={(v) => onTipExtensionModeChange(v as 'none' | 'solid' | 'dashed')} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-xs w-[88px]">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200]">
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="solid">Solid</SelectItem>
                    <SelectItem value="dashed">Dashed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-800">Tree Type</span>
                <Select value={treeLayoutMode} onValueChange={(v) => onTreeLayoutModeChange(v as 'phlogram' | 'cladogram')} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-xs w-[110px]">
                    <SelectValue placeholder="Phlogram" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200]">
                    <SelectItem value="phlogram">Phlogram</SelectItem>
                    <SelectItem value="cladogram">Cladogram</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* Gene Comparison Dropdown */}
      <div className="relative flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit h-16" ref={compareRef}>
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Gene Comparison</span>
          <VizControlHint id="viz-cp-hint-compare" label="About Gene Comparison" tooltipMaxWidthPx={320}>
            Add a track that emphasizes taxa where one gene is present and the other is not, and vice versa. Enable{' '}
            <span className="font-semibold">Use counts</span> to plot the difference in abundance; leave it off to compare simple presence versus absence only.
          </VizControlHint>
        </div>
        <Button
          ref={compareButtonRef}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2 w-44 justify-between whitespace-nowrap"
          aria-haspopup="menu"
          aria-expanded={compareOpen}
          onClick={() => setCompareOpen(v => !v)}
        >
          <span>Create comparison</span>
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
        {compareOpen && createPortal(
          <div
            ref={compareMenuRef}
            className="viz-opaque-menu fixed z-[100100] bg-white border rounded-md shadow-md p-2"
            style={{ top: compareMenuPos.top, left: compareMenuPos.left, width: compareMenuPos.width }}
          >
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-28 text-gray-800">Gene A</span>
                <Select value={diffGene1} onValueChange={setDiffGene1} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-xs w-44">
                    <SelectValue placeholder="Gene" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200] w-44 min-w-[11rem]">
                    {geneNames.map(gene => (
                      <SelectItem key={gene} value={gene}>{gene.replace(/_count$/, '')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-28 text-gray-800">Gene B</span>
                <Select value={diffGene2} onValueChange={setDiffGene2} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-xs w-44">
                    <SelectValue placeholder="Gene" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200] w-44 min-w-[11rem]">
                    {geneNames.map(gene => (
                      <SelectItem key={gene} value={gene}>{gene.replace(/_count$/, '')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-gray-900">
                  <Checkbox
                    className="border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                    checked={useCounts}
                    onCheckedChange={(checked) => setUseCounts(checked as boolean)}
                  />
                  <span className="text-gray-900">Use counts</span>
                </label>
                <Button
                  onClick={handleAddDifference}
                  size="sm"
                  disabled={!diffGene1 || !diffGene2 || diffGene1 === diffGene2}
                  className="viz-add-button h-7 text-xs px-2 disabled:opacity-100"
                >
                  Add
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* Filter Genomes Dropdown */}
      <div className="relative flex flex-col justify-between items-start gap-1 px-2.5 py-1 bg-gray-50 rounded border min-w-fit h-16" ref={filterRef}>
        <div className="flex items-center gap-0.5 leading-none">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-800">Filter Genomes</span>
          <VizControlHint id="viz-cp-hint-filter" label="About Filter Genomes" tooltipMaxWidthPx={320}>
            Remove genomes with no gene counts, or keep only genomes that meet a minimum count for a specific gene. For taxa, pick a rank and threshold to drop less abundant taxa below that minimum count.
          </VizControlHint>
        </div>
        <Button
          ref={filterButtonRef}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2 w-44 justify-between whitespace-nowrap"
          aria-haspopup="menu"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(v => !v)}
        >
          <span>Filter genomes</span>
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
        {filterOpen && createPortal(
          <div
            ref={filterMenuRef}
            className="viz-opaque-menu fixed z-[100100] bg-white border rounded-md shadow-md p-2"
            style={{ top: filterMenuPos.top, left: filterMenuPos.left, width: filterMenuPos.width }}
          >
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Button
                  onClick={onFilterAssemblies}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2 !text-gray-900 border-gray-300 hover:bg-gray-100"
                >
                  Remove All-Zero Genomes
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Select value={sizeFilterLevel} onValueChange={(v) => { setSizeFilterLevel(v as TaxonomicLevel) }} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-[11px] !w-[7.5rem] !text-gray-900 [&>span]:!text-gray-900">
                    <SelectValue placeholder="Rank" className="text-[11px] !text-gray-900" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200] w-[7.5rem] min-w-[7.5rem]">
                    {allLevels.map(level => (
                      <SelectItem key={level} value={level} className="text-[11px] capitalize">{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={0}
                  value={sizeThreshold === 0 ? '' : String(sizeThreshold)}
                  onChange={(e) => {
                    const numeric = e.target.value.replace(/[^0-9]/g, '')
                    setSizeThreshold(numeric === '' ? 0 : Number(numeric))
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSizeFilter() }}
                  className="h-7 !text-[11px] !w-[7.5rem] border border-input bg-white px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:!text-[11px]"
                  placeholder="Min Count"
                  aria-label="Minimum rank count"
                />
              </div>
              <div className="flex items-center gap-2">
                <Select value={rugKey} onValueChange={(v) => { setRugKey(v === 'ANY' ? 'ANY' : v) }} onOpenChange={updateChildSelectOpen}>
                  <SelectTrigger className="h-7 text-[11px] !w-[7.5rem] !text-gray-900 [&>span]:!text-gray-900">
                    <SelectValue placeholder="Gene" className="text-[11px] !text-gray-900" />
                  </SelectTrigger>
                  <SelectContent className="z-[100200] w-[7.5rem] min-w-[7.5rem]">
                    <SelectItem value="ANY" className="text-[11px]">Gene</SelectItem>
                    {geneNames.map(g => (
                      <SelectItem key={g} value={g} className="text-[11px]">{g.replace(/_count$/, '')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={0}
                  value={rugMin === 0 ? '' : String(rugMin)}
                  onChange={(e) => {
                    const numeric = e.target.value.replace(/[^0-9]/g, '')
                    setRugMin(numeric === '' ? 0 : Number(numeric))
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyRugMin(rugMin, rugKey) }}
                  className="h-7 !text-[11px] !w-[7.5rem] border border-input bg-white px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:!text-[11px]"
                  placeholder="Min Count"
                  aria-label="Minimum gene count"
                />
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}
