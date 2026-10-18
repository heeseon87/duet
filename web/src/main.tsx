import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource-variable/jetbrains-mono'
import './styles/base.css'
import './styles/agent.css'
import './styles/review.css'
import './styles/canvas.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
