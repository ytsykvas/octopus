import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import './styles.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Кореневий елемент #root відсутній у index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
