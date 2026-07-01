type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  className = '',
  ...props
}: ButtonProps) {
  const classes = [
    'button',
    variant,
    size === 'sm' ? 'button-sm' : '',
    block ? 'full' : '',
    className,
  ].filter(Boolean).join(' ')

  return <button className={classes} {...props} />
}
