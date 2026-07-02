import { Card } from './Card'

interface StatCardProps {
  label: string
  value: string | number
  foot: string
  tone?: 'blue' | 'green' | 'amber' | 'red'
}

export function StatCard({ label, value, foot, tone = 'blue' }: StatCardProps) {
  return (
    <Card className={['metric-card', tone].join(' ')}>
      <div className="metric-head">
        <div className="metric-label">{label}</div>
        <span className="metric-chip">Live</span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">{foot}</div>
    </Card>
  )
}
