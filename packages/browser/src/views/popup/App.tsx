import { createRoot } from 'react-dom/client'
import { Popup } from './Popup'

export const App: React.FC = () => {
  return <Popup />
}

const root = createRoot(document.getElementById('root') as HTMLDivElement)
root.render(<App />)
