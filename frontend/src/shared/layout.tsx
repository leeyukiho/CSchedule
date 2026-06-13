import { ReactNode } from 'react'
import { View } from '@tarojs/components'

import './pages.scss'

type TabKey = 'home' | 'schedule' | 'grades' | 'profile'

interface PageShellProps {
  title: string
  back?: boolean
  activeTab?: TabKey
  children: ReactNode
  contentClassName?: string
  subPage?: boolean
}

export function PageShell({
  children,
  contentClassName = '',
  subPage = false,
}: PageShellProps) {
  const pageClass = `mini-page ${subPage ? 'sub-page' : ''}`.trim()
  const contentClass = `content ${contentClassName}`.trim()

  return (
    <View className={pageClass}>
      <View className={contentClass}>{children}</View>
    </View>
  )
}
