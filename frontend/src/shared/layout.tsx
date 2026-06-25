import { ReactNode, useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View } from '@tarojs/components'

import { createNotificationPopup, subscribeNotificationPopup } from './notification-popup'
import './pages.scss'

type TabKey = 'home' | 'schedule' | 'grades' | 'profile'

const TAB_INDEX: Record<TabKey, number> = {
  home: 0,
  schedule: 1,
  grades: 2,
  profile: 3,
}

interface CustomTabBarInstance {
  setData?: (data: { selected: number }) => void
}

interface TabPageInstance {
  getTabBar?: () => CustomTabBarInstance
}

interface NavigationMetrics {
  actionStyle: string
  navStyle: string
  notificationMaskStyle: string
  notificationPanelStyle: string
  spacerStyle: string
  titleStyle: string
}

interface PageShellProps {
  title: string
  back?: boolean
  activeTab?: TabKey
  children: ReactNode
  contentClassName?: string
  customNav?: boolean
  subPage?: boolean
}

const DEFAULT_NAVIGATION_METRICS: NavigationMetrics = {
  actionStyle: 'top:64rpx;height:88rpx;',
  navStyle: 'height:176rpx;padding-top:64rpx;',
  notificationMaskStyle: 'padding-top:200rpx;',
  notificationPanelStyle: '',
  spacerStyle: 'height:176rpx;',
  titleStyle: 'height:88rpx;line-height:88rpx;',
}

function getNavigationMetrics(): NavigationMetrics {
  try {
    const menu = Taro.getMenuButtonBoundingClientRect()
    const systemInfo = Taro.getSystemInfoSync()
    const statusBarHeight = Number(systemInfo.statusBarHeight || 0)
    const windowHeight = Number(systemInfo.windowHeight || 0)
    const menuTop = Number(menu.top || 0)
    const menuHeight = Number(menu.height || 0)
    const titleHeight = menuHeight > 0 ? menuHeight : 44
    const verticalGap = menuTop > 0 ? Math.max(menuTop - statusBarHeight, 8) : 8
    const navHeight = statusBarHeight + verticalGap * 2 + titleHeight
    const popupTop = navHeight + 12
    const popupBottom = 42
    const popupMaxHeight = windowHeight > 0 ? Math.max(windowHeight - popupTop - popupBottom, 240) : 0
    const titleTop = menuTop || statusBarHeight + verticalGap

    return {
      actionStyle: `top:${titleTop}px;height:${titleHeight}px;`,
      navStyle: `height:${navHeight}px;padding-top:${titleTop}px;`,
      notificationMaskStyle: `padding-top:${popupTop}px;`,
      notificationPanelStyle: popupMaxHeight > 0 ? `max-height:${popupMaxHeight}px;` : '',
      spacerStyle: `height:${navHeight}px;`,
      titleStyle: `height:${titleHeight}px;line-height:${titleHeight}px;`,
    }
  } catch (error) {
    return DEFAULT_NAVIGATION_METRICS
  }
}

export function PageShell({
  activeTab,
  back = false,
  children,
  contentClassName = '',
  customNav = true,
  subPage = false,
  title,
}: PageShellProps) {
  const pageClass = `mini-page ${subPage ? 'sub-page' : ''}`.trim()
  const contentClass = `content ${contentClassName}`.trim()
  const [navigationMetrics, setNavigationMetrics] = useState<NavigationMetrics>(DEFAULT_NAVIGATION_METRICS)
  const [, setPopupVersion] = useState(0)

  useEffect(() => {
    setNavigationMetrics(getNavigationMetrics())
  }, [])

  useEffect(() => (
    subscribeNotificationPopup(() => setPopupVersion((version) => version + 1))
  ), [])

  useDidShow(() => {
    if (!activeTab) {
      return
    }

    const page = Taro.getCurrentInstance().page as TabPageInstance | undefined
    const tabBar = page?.getTabBar?.()
    tabBar?.setData?.({ selected: TAB_INDEX[activeTab] })
  })

  return (
    <View className={pageClass}>
      {customNav && (
        <>
          <View className='custom-nav' style={navigationMetrics.navStyle}>
            {back && (
              <View
                className='custom-nav-back'
                style={navigationMetrics.actionStyle}
                onClick={() => Taro.navigateBack()}
              />
            )}
            <View className='custom-nav-title' style={navigationMetrics.titleStyle}>{title}</View>
          </View>
          <View className='custom-nav-spacer' style={navigationMetrics.spacerStyle} />
        </>
      )}
      <View className={contentClass}>{children}</View>
      {createNotificationPopup(navigationMetrics.notificationMaskStyle, navigationMetrics.notificationPanelStyle)}
    </View>
  )
}
