import { PropsWithChildren, useEffect, useRef, useState } from 'react'
import { useDidShow, useLaunch } from '@tarojs/taro'

import { getPendingNotifications, markNotificationRead, PendingNotification } from './shared/api/notifications'
import { initWechatAbuseSession } from './shared/api/wechat-session'
import { setNotificationPopupState } from './shared/notification-popup'
import { getStoredAccountId } from './shared/storage'
import './app.scss'

function App({ children }: PropsWithChildren<unknown>) {
  const [accountId, setAccountId] = useState('')
  const [notificationQueue, setNotificationQueue] = useState<PendingNotification[]>([])
  const [pendingTotal, setPendingTotal] = useState(0)
  const [confirmedCount, setConfirmedCount] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const accountIdRef = useRef('')
  const loadingPendingRef = useRef(false)
  const notificationQueueRef = useRef<PendingNotification[]>([])
  const currentNotification = notificationQueue[0]

  useEffect(() => {
    setNotificationPopupState({
      confirming,
      current: currentNotification ? confirmedCount + 1 : 0,
      notification: currentNotification ?? null,
      onConfirm: confirmCurrentNotification,
      total: pendingTotal,
    })
  }, [confirmedCount, confirming, currentNotification, pendingTotal])

  useEffect(() => {
    accountIdRef.current = accountId
  }, [accountId])

  useEffect(() => {
    notificationQueueRef.current = notificationQueue
  }, [notificationQueue])

  useLaunch(() => {
    console.log('CSchedule launched.')
    void initWechatAbuseSession()
    void loadPendingNotifications()
  })

  useDidShow(() => {
    void loadPendingNotifications()
  })

  async function loadPendingNotifications() {
    if (loadingPendingRef.current) {
      return
    }

    const storedAccountId = getStoredAccountId()

    if (!storedAccountId) {
      setAccountId('')
      setNotificationQueue([])
      setPendingTotal(0)
      setConfirmedCount(0)
      notificationQueueRef.current = []
      return
    }

    if (accountIdRef.current === storedAccountId && notificationQueueRef.current.length > 0) {
      return
    }

    try {
      loadingPendingRef.current = true
      const response = await getPendingNotifications(storedAccountId)
      accountIdRef.current = storedAccountId
      notificationQueueRef.current = response.items
      setAccountId(storedAccountId)
      setNotificationQueue(response.items)
      setPendingTotal(response.items.length)
      setConfirmedCount(0)
    } catch (error) {
      console.warn('Failed to load notifications.', error)
    } finally {
      loadingPendingRef.current = false
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
      setNotificationQueue((items) => {
        const nextItems = items.slice(1)
        notificationQueueRef.current = nextItems
        return nextItems
      })
      setConfirming(false)
    }
  }

  return children
}

export default App
