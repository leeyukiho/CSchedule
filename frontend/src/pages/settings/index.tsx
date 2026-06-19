import { useState } from 'react'
import Taro from '@tarojs/taro'
import { useDidShow } from '@tarojs/taro'
import { Button, Picker, View } from '@tarojs/components'

import { getTimetable } from '../../shared/api/timetable'
import { PageShell } from '../../shared/layout'
import {
  clearStoredAccountId,
  clearStoredAccountSummary,
  clearStoredDataCaches,
  clearStoredTermStarts,
  getStoredAccountId,
  getStoredTermStarts,
  setStoredTermStart,
} from '../../shared/storage'
import { TermOption, buildTermOptions } from '../../shared/term'

export default function SettingsPage() {
  const [terms, setTerms] = useState<TermOption[]>([])
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [selectedTermId, setSelectedTermId] = useState('')

  useDidShow(() => {
    setTermStarts(getStoredTermStarts())
    void loadTerms()
  })

  async function loadTerms() {
    const accountId = getStoredAccountId()

    if (!accountId) {
      setTerms([])
      return
    }

    try {
      const timetable = await getTimetable(accountId)
      const nextTerms = buildTermOptions(timetable)
      setTerms(nextTerms)
      setSelectedTermId((current) =>
        current && nextTerms.some((term) => term.id === current)
          ? current
          : (nextTerms[0]?.id || ''),
      )
    } catch {
      setTerms([])
      setSelectedTermId('')
    }
  }

  function updateTermStart(termId: string, date: string) {
    setStoredTermStart(termId, date)
    setTermStarts(getStoredTermStarts())
  }

  const selectedTermIndex = Math.max(
    terms.findIndex((term) => term.id === selectedTermId),
    0,
  )
  const selectedTerm = terms[selectedTermIndex] || null

  function clearCache() {
    const accountId = getStoredAccountId()

    clearStoredAccountId()
    clearStoredAccountSummary(accountId || undefined)
    clearStoredDataCaches(accountId || undefined)
    clearStoredTermStarts()
    Taro.showToast({ title: '已退出登录', icon: 'success' })
    Taro.switchTab({ url: '/pages/profile/index' })
  }

  return (
    <PageShell title='设置' back subPage>
      <View className='soft-card settings-card'>
        <View className='settings-row settings-row-stack'>
          <View>
            <View className='settings-title'>学期首周开始时间</View>
            <View className='settings-desc'>用于计算默认第几周，以及课表周一至周日的日期。</View>
          </View>
        </View>
        {terms.length > 0 && (
          <View className='settings-row settings-term-option'>
            <Picker
              className='settings-term-picker'
              mode='selector'
              range={terms.map((term) => term.label)}
              value={selectedTermIndex}
              onChange={(event) =>
                setSelectedTermId(terms[Number(event.detail.value)]?.id || '')
              }
            >
              <View className='settings-term-summary'>
                <View className='settings-term-main'>
                  <View className='settings-term-title-row'>
                    <View className='settings-title settings-term-title'>
                      {selectedTerm?.label || '选择学期'}
                    </View>
                    <View className='settings-term-badge'>切换</View>
                  </View>
                  <View className='settings-desc'>
                    {selectedTerm
                      ? (termStarts[selectedTerm.id]
                        ? `首周开始：${termStarts[selectedTerm.id]}`
                        : '未设置，将使用默认估算日期')
                      : '请先选择学期'}
                  </View>
                </View>
                <View className='settings-term-arrow' />
              </View>
            </Picker>
            <Picker
              className='settings-date-picker'
              mode='date'
              value={selectedTerm ? (termStarts[selectedTerm.id] || '') : ''}
              onChange={(event) => {
                if (selectedTerm) {
                  updateTermStart(selectedTerm.id, event.detail.value)
                }
              }}
            >
              <View className='small-button settings-date-button'>
                {selectedTerm && termStarts[selectedTerm.id] ? '修改日期' : '设置日期'}
              </View>
            </Picker>
          </View>
        )}
        {terms.length === 0 && (
          <View className='settings-row settings-row-stack'>
            <View className='settings-desc'>同步课表后可设置各学期首周开始日期。</View>
          </View>
        )}
      </View>
      <View className='soft-card settings-card'>
        <View className='settings-row'>
          <View>
            <View className='settings-title'>退出登录</View>
            <View className='settings-desc'>退出后需要重新登录学校官网账号。</View>
          </View>
          <Button className='small-button danger-button' onClick={clearCache}>
            退出
          </Button>
        </View>
      </View>
      <View className='settings-note'>退出登录会清空本机保存的登录状态和课表缓存。</View>
    </PageShell>
  )
}
