import { createElement, Fragment, PropsWithChildren, useState } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { Button, ScrollView, Text, View } from '@tarojs/components'

import { getPendingNotifications, markNotificationRead, PendingNotification } from './shared/api/notifications'
import { getStoredAccountId } from './shared/storage'
import './app.scss'

function getNotificationTypeLabel(targetType?: string) {
  return targetType === 'user' ? '个人消息' : '平台通知'
}

function getNotificationTone(targetType?: string) {
  return targetType === 'user' ? 'user' : 'global'
}

function App({ children }: PropsWithChildren<unknown>) {
  const [accountId, setAccountId] = useState('')
  const [notificationQueue, setNotificationQueue] = useState<PendingNotification[]>([])
  const [pendingTotal, setPendingTotal] = useState(0)
  const [confirmedCount, setConfirmedCount] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const currentNotification = notificationQueue[0]

  useLaunch(() => {
    console.log('CSchedule launched.')
    void loadPendingNotifications()
  })

  async function loadPendingNotifications() {
    const storedAccountId = getStoredAccountId()

    if (!storedAccountId) {
      setAccountId('')
      setNotificationQueue([])
      setPendingTotal(0)
      setConfirmedCount(0)
      return
    }

    try {
      const response = await getPendingNotifications(storedAccountId)
      setAccountId(storedAccountId)
      setNotificationQueue(response.items)
      setPendingTotal(response.items.length)
      setConfirmedCount(0)
    } catch (error) {
      console.warn('Failed to load notifications.', error)
    }
  }

  async function confirmCurrentNotification() {
    if (!accountId || !currentNotification || confirming) return

    try {
      setConfirming(true)
      await markNotificationRead(accountId, currentNotification.id)
    } catch (error) {
      console.warn('Failed to mark notification read.', error)
    } finally {
      setConfirmedCount((count) => count + 1)
      setNotificationQueue((items) => items.slice(1))
      setConfirming(false)
    }
  }

  return createElement(
    Fragment,
    null,
    children,
    currentNotification ? createNotificationModal({
      confirming,
      current: confirmedCount + 1,
      notification: currentNotification,
      onConfirm: confirmCurrentNotification,
      total: pendingTotal,
    }) : null,
  )
}

function createNotificationModal(props: {
  confirming: boolean
  current: number
  notification: PendingNotification
  onConfirm: () => void
  total: number
}) {
  const tone = getNotificationTone(props.notification.targetType)
  const typeLabel = getNotificationTypeLabel(props.notification.targetType)

  return createElement(
    View,
    { className: 'notification-modal-mask' },
    createElement(
      View,
      { className: 'notification-modal-panel' },
      createElement(
        View,
        { className: 'notification-modal-head' },
        createElement(
          View,
          { className: `notification-modal-mark ${tone}` },
          createElement(View, { className: 'notification-modal-icon' }),
        ),
        createElement(
          View,
          { className: 'notification-modal-heading' },
          createElement(Text, { className: `notification-modal-badge ${tone}` }, typeLabel),
          createElement(Text, { className: 'notification-modal-title' }, props.notification.title),
        ),
      ),
      createElement(
        ScrollView,
        { className: 'notification-modal-scroll', scrollY: true },
        createElement(Text, { className: 'notification-modal-content' }, props.notification.content),
      ),
      createElement(
        View,
        { className: 'notification-modal-footer' },
        createElement(
          Text,
          { className: 'notification-modal-count' },
          props.total > 1 ? `${props.current}/${props.total}` : '待确认',
        ),
        createElement(
          Button,
          {
            className: 'notification-modal-button',
            disabled: props.confirming,
            loading: props.confirming,
            onClick: props.onConfirm,
          },
          '知道了',
        ),
      ),
    ),
  )
}

export default App
