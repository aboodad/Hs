import React from 'react'
import ReactDOM from 'react-dom/client'
import { Providers } from '@/app/providers'
import AppRouter from '@/app/router'
import { EnvMissing } from '@/app/EnvMissing'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { envReady } from '@/lib/env'
// الخط IBM Plex Sans Arabic مضمّن محلياً (يعمل بدون إنترنت في تطبيقات الجوال)
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@/styles/index.css'

// بعد نشر نسخة جديدة تختفي ملفات الصفحات القديمة: نعيد التحميل مرة واحدة تلقائياً بدل الشاشة البيضاء
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  if (!sessionStorage.getItem('chunk-reloaded')) {
    sessionStorage.setItem('chunk-reloaded', '1')
    location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {envReady ? (
        <Providers>
          <AppRouter />
        </Providers>
      ) : (
        <EnvMissing />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
)
;(window as any).__APP_MOUNTED__ = true
