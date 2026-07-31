'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * Renders the agent's Report section as a real table (plus a chart when one fits) instead of
 * pre-wrapped text. A breakdown is much easier to scan as rows and columns, and share-style
 * figures read better as a chart than as a list of percentages.
 */

export type AgentReportTable = {
  title: string
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>
  rows: Array<Record<string, string | number | null>>
  totals?: Record<string, string | number | null>
  chart?: { type: 'bar' | 'pie'; labelKey: string; valueKey: string; valueLabel: string }
}

/** Distinguishable in both light and dark, and colour-blind safe enough for categorical slices. */
const CHART_COLORS = [
  '#2563eb',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#db2777',
]

const isBlank = (v: unknown) => v === null || v === undefined || v === ''

function formatCell(value: string | number | null | undefined): string {
  if (isBlank(value)) return '-'
  // Thousands separators for figures; strings (labels, dates, "45%") pass through untouched.
  return typeof value === 'number' ? value.toLocaleString('en-US') : String(value)
}

export default function AgentReportView({ table }: { table: AgentReportTable }) {
  const { title, columns, rows, totals, chart } = table
  if (!Array.isArray(rows) || rows.length === 0) return null

  // Charting more than a handful of slices is unreadable; cap and note the remainder.
  const chartRows = chart ? rows.slice(0, chart.type === 'pie' ? 8 : 12) : []
  const chartData = chartRows.map((r) => ({
    name: String(r[chart!.labelKey] ?? '-'),
    value: Number(r[chart!.valueKey] ?? 0),
  }))
  const hasChartableValues = chartData.some((d) => Number.isFinite(d.value) && d.value > 0)

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-gray-600">{title}</div>

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-2 py-1.5 font-semibold text-gray-700 whitespace-nowrap ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'bg-gray-50/60' : undefined}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-1 whitespace-nowrap ${
                      c.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                    }`}
                  >
                    {formatCell(row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals ? (
            <tfoot>
              <tr className="border-t border-gray-300 bg-gray-100 font-semibold">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-1 whitespace-nowrap ${
                      c.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                    }`}
                  >
                    {formatCell(totals[c.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {chart && hasChartableValues ? (
        <div className="rounded-md border border-gray-200 p-2">
          <div className="mb-1 text-xs text-gray-600">
            {chart.valueLabel}
            {rows.length > chartRows.length ? ` — top ${chartRows.length} of ${rows.length}` : ''}
          </div>
          <div style={{ width: '100%', height: chart.type === 'pie' ? 260 : 280 }}>
            <ResponsiveContainer>
              {chart.type === 'pie' ? (
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={95} label>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | string) => Number(v).toLocaleString('en-US')} />
                </PieChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 56, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={64}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => Number(v).toLocaleString('en-US')}
                  />
                  <Tooltip formatter={(v: number | string) => Number(v).toLocaleString('en-US')} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </div>
  )
}
