import { useMemo, useRef, useState } from 'react'

interface SparkLineProps {
  data: number[]
  rawData?: number[]
  unit?: string
  color?: string
  height?: number
  showGradient?: boolean
  className?: string
}

export function SparkLine({
  data,
  rawData,
  unit = '',
  color = '#3b82f6',
  height = 40,
  showGradient = true,
  className = '',
}: SparkLineProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  const { path, gradientPath, points, lastPoint } = useMemo(() => {
    if (data.length === 0) {
      return { path: '', gradientPath: '', points: [], lastPoint: null }
    }

    const width = 100
    const padding = 2
    const effectiveHeight = height - padding * 2
    const effectiveWidth = width - padding * 2

    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1

    const pts = data.map((value, index) => {
      // Single point should be at the end (right side)
      const x = data.length === 1 ? padding + effectiveWidth : padding + (index / (data.length - 1)) * effectiveWidth
      const y = padding + effectiveHeight - ((value - min) / range) * effectiveHeight
      return { x, y, value }
    })

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

    const lastPt = pts[pts.length - 1]
    const firstPt = pts[0]
    const gradPath = `${linePath} L ${lastPt.x} ${height - padding} L ${firstPt.x} ${height - padding} Z`

    return {
      path: linePath,
      gradientPath: gradPath,
      points: pts,
      lastPoint: lastPt,
    }
  }, [data, height])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!svgRef.current || points.length === 0) return

    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const relativeX = x / rect.width
    const index = Math.round(relativeX * (points.length - 1))
    const clampedIndex = Math.max(0, Math.min(points.length - 1, index))

    setHoverIndex(clampedIndex)
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const handleMouseLeave = () => {
    setHoverIndex(null)
  }

  // Must be before any conditional returns (React hooks rules)
  const gradientId = useMemo(() => `sparkline-gradient-${Math.random().toString(36).substr(2, 9)}`, [])

  // Convert SVG coordinates to percentages for HTML positioning
  const getPercentPosition = (point: { x: number; y: number }) => ({
    left: `${point.x}%`,
    top: `${(point.y / height) * 100}%`,
  })

  // Need at least 2 points to draw a meaningful line
  if (data.length < 2) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ height }}>
        <div className="h-px w-full bg-zinc-800" />
      </div>
    )
  }

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null
  const hoverValue = hoverIndex !== null ? (rawData ? rawData[hoverIndex] : data[hoverIndex]) : null

  return (
    <div className="relative" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <svg
        ref={svgRef}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className={`w-full cursor-crosshair ${className}`}
        style={{ height }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gradient fill */}
        {showGradient && <path d={gradientPath} fill={`url(#${gradientId})`} />}

        {/* Line */}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Hover point (HTML element to avoid distortion) */}
      {hoverPoint && (
        <div
          className="absolute pointer-events-none w-2.5 h-2.5 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2"
          style={{
            ...getPercentPosition(hoverPoint),
            backgroundColor: color,
          }}
        />
      )}

      {/* Current value dot (only show when not hovering) */}
      {lastPoint && hoverIndex === null && (
        <div
          className="absolute pointer-events-none w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-sm"
          style={{
            ...getPercentPosition(lastPoint),
            backgroundColor: color,
          }}
        />
      )}

      {/* Tooltip */}
      {hoverIndex !== null && hoverValue !== null && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1 text-xs font-medium text-white bg-zinc-800 rounded shadow-lg border border-zinc-700 whitespace-nowrap -translate-x-1/2"
          style={{
            left: tooltipPos.x,
            top: -24,
          }}
        >
          {unit ? `${hoverValue.toFixed(1)}${unit}` : hoverValue}
        </div>
      )}
    </div>
  )
}
