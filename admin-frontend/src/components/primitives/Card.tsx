interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'aside' | 'div'
}

export function Card({ as = 'section', className = '', ...props }: CardProps) {
  const Element = as
  return <Element className={['card', className].filter(Boolean).join(' ')} {...props} />
}
