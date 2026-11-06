import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/gowun-dodum/400.css'
import '@fontsource/gaegu/700.css'
import './styles/base.css'
import './styles/agent.css'
import './styles/review.css'
import './styles/canvas.css'
import './styles/crayon.css'
import { App } from './App.tsx'
import { watchScrolling } from './lib/ScrollRail.tsx'

watchScrolling()
createRoot(document.getElementById('root')!).render(<App />)
