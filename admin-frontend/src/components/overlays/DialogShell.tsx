import { X } from 'lucide-react'

interface DialogShellProps {
  title: string
  description?: string
  className?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}

export function DialogShell({
  title,
  description,
  className = '',
  onClose,
  children,
  footer,
}: DialogShellProps) {
  return (
    <div
      className="modal-backdrop visible"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className={['modal', className].filter(Boolean).join(' ')}>
        <header className="modal-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description && <div className="panel-description">{description}</div>}
          </div>
          <button className="button ghost icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  )
}
