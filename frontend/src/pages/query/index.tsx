import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'

import { PageShell } from '../../shared/layout'
import { useDefaultShare } from '../../shared/share'

type QueryEntry = {
  id: string
  title: string
  desc: string
  tag: string
  tone: 'blue' | 'green' | 'purple'
  url: string
  displayUrl: string
}

const QUERY_ENTRIES: QueryEntry[] = [
  {
    id: 'cet',
    title: '四六级成绩查询',
    desc: '全国大学英语四、六级考试成绩查询',
    tag: 'CET',
    tone: 'blue',
    url: 'https://cjcx.neea.edu.cn/html1/folder/21033/653-1.htm',
    displayUrl: 'https://cjcx.neea.edu.cn/html1/folder/21033/653-1.htm',
  },
  {
    id: 'ncre',
    title: '计算机等级考试查询',
    desc: '全国计算机等级考试成绩查询',
    tag: 'NCRE',
    tone: 'purple',
    url: 'https://cjcx.neea.edu.cn/html1/folder/22014/5490-1.htm',
    displayUrl: 'https://cjcx.neea.edu.cn/html1/folder/22014/5490-1.htm',
  },
  {
    id: 'putonghua',
    title: '普通话成绩',
    desc: '普通话水平测试成绩与证书信息查询',
    tag: 'PSC',
    tone: 'green',
    url: 'https://zwfw.moe.gov.cn/mandarin/',
    displayUrl: 'https://zwfw.moe.gov.cn/mandarin/',
  },
  {
    id: 'certificate',
    title: '证书查询',
    desc: '中国教育考试网证书查询与验证',
    tag: '证书',
    tone: 'purple',
    url: 'https://zscx.neea.edu.cn/',
    displayUrl: 'https://zscx.neea.edu.cn/',
  },
]

export default function QueryPage() {
  useDefaultShare()

  function openQueryEntry(entry: QueryEntry) {
    Taro.setClipboardData({
      data: entry.displayUrl || entry.url,
      success: () => {
        Taro.showToast({ title: '已复制链接', icon: 'success' })
      },
    })
  }

  return (
    <PageShell title='证书查询' back subPage>
      <View className='query-page-head'>
        <Text className='query-page-title'>常用查询</Text>
        <Text className='query-page-subtitle'>点击对应入口复制链接，请在浏览器中打开。</Text>
      </View>

      <View className='query-entry-list'>
        {QUERY_ENTRIES.map((entry) => (
          <View
            className={`soft-card query-entry-card query-entry-card-${entry.tone}`}
            key={entry.id}
            onClick={() => openQueryEntry(entry)}
          >
            <View className={`query-entry-icon query-entry-icon-${entry.tone}`}>
              <Text>{entry.tag}</Text>
            </View>
            <View className='query-entry-main'>
              <Text className='query-entry-title'>{entry.title}</Text>
              <Text className='query-entry-desc'>{entry.desc}</Text>
            </View>
            <View className='query-entry-arrow' />
          </View>
        ))}
      </View>
    </PageShell>
  )
}
