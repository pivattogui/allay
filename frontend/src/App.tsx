import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { LoginPage } from './pages/LoginPage'
import { SetupPage } from './pages/SetupPage'
import { ServersPage } from './pages/ServersPage'
import { ServerDetailPage } from './pages/ServerDetailPage'
import { CreateServerPage } from './pages/CreateServerPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AppLayout } from './components/layout/AppLayout'
import { useAuthStore } from './stores'

function App() {
  const { isAuthenticated, setupRequired, checkAuth } = useAuthStore()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (isAuthenticated === null || setupRequired === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster
        position="top-right"
        richColors
        closeButton
        theme="dark"
        toastOptions={{
          style: {
            background: 'hsl(0 0% 4%)',
            border: '1px solid hsl(0 0% 14%)',
          },
        }}
      />
      <Routes>
        {setupRequired ? (
          <>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="*" element={<Navigate to="/setup" replace />} />
          </>
        ) : !isAuthenticated ? (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            {/* Redirect root to /servers */}
            <Route path="/" element={<Navigate to="/servers" replace />} />

            {/* App layout with sidebar */}
            <Route element={<AppLayout />}>
              <Route path="/servers" element={<ServersPage />} />
              <Route path="/servers/:id" element={<ServerDetailPage />} />
              <Route path="/servers/:id/console" element={<ServerDetailPage />} />
              <Route path="/servers/:id/backups" element={<ServerDetailPage />} />
              <Route path="/servers/:id/files" element={<ServerDetailPage />} />
            </Route>

            {/* Create server (full page, no sidebar) */}
            <Route path="/servers/new" element={<CreateServerPage />} />

            {/* 404 */}
            <Route path="*" element={<NotFoundPage />} />
          </>
        )}
      </Routes>
    </>
  )
}

export default App
