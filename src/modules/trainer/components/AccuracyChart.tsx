import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useT } from '@/i18n/useT'

export interface AccuracyDatum {
  act: string
  label: string
  correct: number
  total: number
}

/**
 * Accuracy by rule book, for the mock test results screen.
 *
 * The one chart in this app, and recharts is a new dependency for it — nothing
 * else here has needed one (CLAUDE.md's STACK line pins `recharts 3.10` for
 * exactly this). Colours are passed as `var(--token)` strings rather than
 * literal hex: recharts renders straight to SVG presentation attributes, and
 * every modern engine resolves a CSS custom property there the same way it
 * would in a stylesheet, so the bar repaints on the light/dark toggle with no
 * recharts-specific theming layer.
 */
export function AccuracyChart({ data }: { data: AccuracyDatum[] }) {
  const { t } = useT()
  const rows = data.map((d) => ({ ...d, pct: d.total === 0 ? 0 : Math.round((d.correct / d.total) * 100) }))

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            width={36}
          />
          <Tooltip
            formatter={(value) => [`${String(value)}%`, t('trainer.mock.chartAccuracyLabel')]}
            contentStyle={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--foreground)',
              fontSize: 12,
            }}
          />
          <Bar dataKey="pct" fill="var(--action)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
