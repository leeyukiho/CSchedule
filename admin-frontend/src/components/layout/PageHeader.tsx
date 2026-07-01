interface PageHeaderProps {
  kicker?: string
  title: string
  description?: string
  meta?: React.ReactNode
  actions?: React.ReactNode
}

export function PageHeader({ kicker, title, description, meta, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-copy">
        {kicker && <div className="page-kicker">{kicker}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {meta && <div className="page-header-meta">{meta}</div>}
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </div>
  )
}
