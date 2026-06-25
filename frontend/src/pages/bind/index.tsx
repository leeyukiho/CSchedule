import { BindAccountPanel } from '../../features/bind/BindAccountPanel'
import { useDefaultShare } from '../../shared/share'

export default function BindPage() {
  useDefaultShare()
  return <BindAccountPanel />
}
