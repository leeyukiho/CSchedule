import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'

import './app.scss'

function App({ children }: PropsWithChildren<unknown>) {
  useLaunch(() => {
    console.log('CSchedule launched.')
  })

  return children
}

export default App
