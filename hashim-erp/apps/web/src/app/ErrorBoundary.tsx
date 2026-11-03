import { Component, type ErrorInfo, type ReactNode } from 'react'

/** يمنع الشاشة البيضاء: أي خطأ غير متوقع يظهر كرسالة مع زر إعادة التحميل */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ErrorBoundary]', error, info.componentStack) }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#faf6ee', fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 520, width: '100%', background: '#fff', border: '1px solid #e8d9b5', borderRadius: 16, padding: 28 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: '#2e2014' }}>حدث خطأ غير متوقع</h1>
          <p style={{ color: '#6b5a45', lineHeight: 1.8 }}>جرّب إعادة التحميل. إن استمرت المشكلة أرسل نص الخطأ أدناه للمطوّر.</p>
          <pre dir="ltr" style={{ background: '#f5efe2', padding: 12, borderRadius: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(this.state.error?.message ?? this.state.error)}</pre>
          <button onClick={() => location.reload()} style={{ marginTop: 8, padding: '10px 20px', borderRadius: 10, border: 0, background: '#2e2014', color: '#fff', cursor: 'pointer' }}>إعادة التحميل</button>
        </div>
      </div>
    )
  }
}
