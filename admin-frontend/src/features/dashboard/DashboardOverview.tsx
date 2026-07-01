import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '../../components/primitives/Button'
import { Card } from '../../components/primitives/Card'
import { Badge } from '../../components/primitives/Badge'
import type { AdminStats, DashboardAnalytics, DashboardTaskItem, DashboardTrendRangeValue } from '../../types/admin'

const PIE_COLORS = ['var(--accent-strong)', 'var(--accent)', 'var(--warning)', 'var(--success)', 'var(--danger)', 'var(--muted-foreground)']
const TREND_RANGE_OPTIONS: Array<{ value: DashboardTrendRangeValue; label: string; title: string }> = [
  { value: 'today', label: '今天', title: '今天变化' },
  { value: 'yesterday', label: '昨天', title: '昨天变化' },
  { value: '3d', label: '近 3 天', title: '近 3 天变化' },
  { value: '7d', label: '近 7 天', title: '近 7 天变化' },
  { value: '14d', label: '近 14 天', title: '近 14 天变化' },
  { value: '30d', label: '近 30 天', title: '近 30 天变化' },
]

interface DashboardOverviewProps {
  stats: AdminStats | null
  analytics: DashboardAnalytics | null
  trendRange: DashboardTrendRangeValue
  tasks: DashboardTaskItem[]
  loading: boolean
  onRefresh: () => void
  onTrendRangeChange: (range: DashboardTrendRangeValue) => void
  onOpenSchoolAlerts: () => void
}

export function DashboardOverview(props: DashboardOverviewProps) {
  const pendingSchoolAlerts = props.stats?.pendingSchoolAlerts ?? 0
  const analytics = props.analytics
  const activeTasks = props.tasks.filter((task) => task.count > 0)
  const trendTitle = TREND_RANGE_OPTIONS.find((option) => option.value === props.trendRange)?.title || '趋势变化'

  return (
    <div className="dashboard-stack">
      <div className="dashboard-main-grid">
        <Card className="dashboard-card task-priority-card">
          <div className="dashboard-card-header">
            <div>
              <div className="panel-eyebrow">Priority Queue</div>
              <h2>今日待办</h2>
              <p>先处理影响面最大的异常，再进入具体管理页面完成动作。</p>
            </div>
            <Button variant="secondary" size="sm" type="button" onClick={props.onRefresh}>
              <RefreshCw size={16} />
              刷新统计
            </Button>
          </div>
          {pendingSchoolAlerts > 0 && (
            <div className="priority-banner">
              <div>
                <strong>学校异常优先处理</strong>
                <span>当前有 {pendingSchoolAlerts} 条学校导入或同步异常待处理。</span>
              </div>
              <Button variant="primary" size="sm" type="button" onClick={props.onOpenSchoolAlerts}>
                <AlertTriangle size={16} />
                查看告警
              </Button>
            </div>
          )}
          <div className="task-list">
            {(activeTasks.length ? activeTasks : props.tasks).map((task) => (
              <article className={['task-card', task.tone].join(' ')} key={task.title}>
                <div className="task-card-main">
                  <div className="task-card-topline">
                    <span className="task-title">{task.title}</span>
                    <Badge tone={task.tone}>{task.count}</Badge>
                  </div>
                  <p className="task-detail">{task.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </Card>

        <Card className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <div className="panel-eyebrow">Trend</div>
              <h2>{trendTitle}</h2>
            </div>
            <div className="dashboard-card-tools">
              <div className="segmented-control" aria-label="选择趋势统计范围">
                {TREND_RANGE_OPTIONS.map((option) => (
                  <button
                    className={option.value === props.trendRange ? 'active' : ''}
                    type="button"
                    key={option.value}
                    onClick={() => props.onTrendRangeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {analytics?.partial && <Badge tone="amber">样本已截断</Badge>}
            </div>
          </div>
          <div className="chart-card-body">
            {analytics?.trend.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={analytics.trend}>
                  <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 12,
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="users" name="新增用户" stroke="var(--accent-strong)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="submissions" name="接入申请" stroke="var(--warning)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="feedback" name="用户反馈" stroke="var(--danger)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">{props.loading ? '正在加载图表数据…' : '暂无可聚合的趋势数据'}</div>
            )}
          </div>
        </Card>
      </div>

      <div className="dashboard-secondary-grid">
        <Card className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <div className="panel-eyebrow">Members</div>
              <h2>新增学校成员</h2>
              <p>按当前时间范围统计各学校新增学生账号。</p>
            </div>
          </div>
          <div className="chart-card-body">
            {analytics?.schoolMembers.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={analytics.schoolMembers} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={104} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="value" name="新增成员" radius={[0, 8, 8, 0]} fill="var(--success)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">{props.loading ? '正在加载成员数据…' : '当前范围暂无新增学校成员'}</div>
            )}
          </div>
        </Card>

        <Card className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <div className="panel-eyebrow">Backlog</div>
              <h2>待处理任务对比</h2>
              <p>直接使用当前实时统计的待办数量。</p>
            </div>
          </div>
          <div className="chart-card-body">
            {analytics?.tasks.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={analytics.tasks} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={88} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]} fill="var(--accent)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">暂无任务对比数据</div>
            )}
          </div>
        </Card>

        <Card className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <div className="panel-eyebrow">Distribution</div>
              <h2>学校状态占比</h2>
              <p>帮助快速识别开放学校、候选学校与停用学校的结构。</p>
            </div>
          </div>
          <div className="chart-card-body">
            {analytics?.schoolDistribution.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={analytics.schoolDistribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={84}
                    paddingAngle={2}
                  >
                    {analytics.schoolDistribution.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 12,
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">暂无学校分布数据</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
