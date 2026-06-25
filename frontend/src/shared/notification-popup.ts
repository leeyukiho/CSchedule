import { createElement } from 'react'
import { Button, ScrollView, Text, View } from '@tarojs/components'

import { PendingNotification } from './api/notifications'

interface NotificationPopupState {
  confirming: boolean
  current: number
  notification: PendingNotification | null
  onConfirm: () => void
  total: number
}

type Listener = () => void

let state: NotificationPopupState = {
  confirming: false,
  current: 0,
  notification: null,
  onConfirm: () => undefined,
  total: 0,
}

const listeners = new Set<Listener>()

export function getNotificationPopupState() {
  return state
}

export function setNotificationPopupState(nextState: NotificationPopupState) {
  state = nextState
  listeners.forEach((listener) => listener())
}

export function subscribeNotificationPopup(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getNotificationTypeLabel(targetType?: string) {
  if (targetType === 'school') return '学校通知'
  return targetType === 'user' ? '个人消息' : '平台通知'
}

export function getNotificationTone(targetType?: string) {
  if (targetType === 'school') return 'school'
  return targetType === 'user' ? 'user' : 'global'
}

export function createNotificationPopup(maskStyle?: string, panelStyle?: string) {
  const currentState = getNotificationPopupState()
  const notification = currentState.notification

  if (!notification) {
    return null
  }

  const tone = getNotificationTone(notification.targetType)
  const typeLabel = getNotificationTypeLabel(notification.targetType)

  return createElement(
    View,
    { className: 'notification-modal-mask', style: maskStyle },
    createElement(
      View,
      { className: 'notification-modal-panel', style: panelStyle },
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
          createElement(Text, { className: 'notification-modal-title' }, notification.title),
        ),
      ),
      createElement(
        ScrollView,
        { className: 'notification-modal-scroll', scrollY: true },
        createElement(Text, { className: 'notification-modal-content' }, notification.content),
      ),
      createElement(
        View,
        { className: 'notification-modal-footer' },
        createElement(
          Text,
          { className: 'notification-modal-count' },
          currentState.total > 1 ? `${currentState.current}/${currentState.total}` : '待确认',
        ),
        createElement(
          Button,
          {
            className: 'notification-modal-button',
            disabled: currentState.confirming,
            loading: currentState.confirming,
            onClick: currentState.onConfirm,
          },
          '知道了',
        ),
      ),
    ),
  )
}
