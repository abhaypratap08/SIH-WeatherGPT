import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/design-tokens.css'
import './styles/layout.css'
import App from './App.tsx'
import { LocationProvider } from './location/LocationContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocationProvider>
      <App />
    </LocationProvider>
  </StrictMode>,
)