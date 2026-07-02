interface AppLayoutProps {
  sidebar: React.ReactNode
  topbar: React.ReactNode
  children: React.ReactNode
}

export function AppLayout({ sidebar, topbar, children }: AppLayoutProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#admin-main">跳到主要内容</a>
      <aside className="sidebar">{sidebar}</aside>
      <div className="main-shell">
        <header className="topbar-shell">{topbar}</header>
        <main className="main" id="admin-main">
          {children}
        </main>
      </div>
    </div>
  )
}
