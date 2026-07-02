interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue'
}

export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return <span className={['badge', tone === 'neutral' ? '' : tone, className].filter(Boolean).join(' ')} {...props} />
}
