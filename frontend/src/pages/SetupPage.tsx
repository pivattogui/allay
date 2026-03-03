import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { User, Lock, Loader2, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/stores'
import { setupAdmin } from '@/lib/api'

export function SetupPage() {
  const setSetupRequired = useAuthStore((s) => s.setSetupRequired)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    try {
      await setupAdmin(username, password)
      setSetupRequired(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 grid-background">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/allay-icon.svg" alt="Allay" className="h-16 w-16 mb-4" />
          <h1 className="text-2xl font-semibold text-foreground tracking-wide">Allay</h1>
          <p className="text-sm text-muted-foreground mt-1">Initial Setup</p>
        </div>

        <Card className="border-border">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">Create Admin Account</CardTitle>
            <CardDescription>Set up your administrator credentials to get started</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium text-foreground">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10"
                    placeholder="Choose a username"
                    required
                    minLength={3}
                    autoComplete="username"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    placeholder="Create a password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                  Confirm Password
                </label>
                <div className="relative">
                  <CheckCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    placeholder="Confirm your password"
                    required
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create Account'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          This will be your admin account for managing servers
        </p>
      </div>
    </div>
  )
}
