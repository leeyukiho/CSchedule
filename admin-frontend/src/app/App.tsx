import { ThemeProvider } from './theme'
import { AdminConsole } from '../features/admin/AdminConsole'

export function App() {
  return (
    <ThemeProvider>
      <AdminConsole />
    </ThemeProvider>
  )
}
