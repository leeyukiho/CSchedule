import * as Switch from '@radix-ui/react-switch'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../app/theme'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === 'dark'

  return (
    <label className="theme-toggle" aria-label="切换深浅主题">
      <Sun size={14} />
      <Switch.Root
        checked={dark}
        className="theme-switch"
        onCheckedChange={toggleTheme}
        aria-label="切换深浅主题"
      >
        <Switch.Thumb className="theme-switch-thumb" />
      </Switch.Root>
      <Moon size={14} />
    </label>
  )
}
