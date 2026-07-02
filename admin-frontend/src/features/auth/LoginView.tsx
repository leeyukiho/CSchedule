import { ShieldCheck } from 'lucide-react'
import { Button } from '../../components/primitives/Button'
import { ThemeToggle } from '../../components/layout/ThemeToggle'
import type { StatusMessage } from '../../types/admin'

interface LoginViewProps {
  loading: boolean
  status: StatusMessage | null
  baseUrl: string
  adminKey: string
  onBaseUrlChange: (value: string) => void
  onAdminKeyChange: (value: string) => void
  onSubmit: () => void
}

export function LoginView(props: LoginViewProps) {
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-toolbar">
          <div className="brand brand-login">
            <div className="brand-mark">CS</div>
            <div>
              <div className="brand-title">CSchedule Admin</div>
              <div className="brand-subtitle">结构化、可维护的运营后台</div>
            </div>
          </div>
          <ThemeToggle />
        </div>
        <div className="login-intro">
          <div className="login-kicker">管理后台</div>
          <h1 id="login-title">登录管理员工作台</h1>
          <p>输入接口地址与管理员密钥。系统会先校验 Admin API 是否可用，再进入后台。</p>
        </div>
        {props.status && <div className={['status-line', 'visible', props.status.type === 'error' ? 'error' : ''].filter(Boolean).join(' ')}>{props.status.text}</div>}
        <div className="login-form">
          <label className="field">
            <span>后端接口地址</span>
            <input
              value={props.baseUrl}
              onChange={(event) => props.onBaseUrlChange(event.target.value)}
              autoComplete="url"
              placeholder="http://localhost:3000/api/v1"
            />
          </label>
          <label className="field">
            <span>管理员密钥</span>
            <input
              type="password"
              value={props.adminKey}
              onChange={(event) => props.onAdminKeyChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') props.onSubmit()
              }}
              autoComplete="current-password"
              placeholder="输入管理员接口密钥"
            />
          </label>
          <div className="login-submit">
            <Button variant="primary" block type="button" onClick={props.onSubmit} disabled={props.loading}>
              <ShieldCheck size={16} />
              {props.loading ? '正在连接…' : '进入管理后台'}
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
