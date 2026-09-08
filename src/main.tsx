import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// StrictMode omitted: Leaflet maps don't survive the dev double-mount
createRoot(document.getElementById('root')!).render(<App />)
