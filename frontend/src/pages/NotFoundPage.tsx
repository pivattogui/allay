import { ArrowLeft, Home } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center">
        <div className="text-8xl font-bold text-muted-foreground/20 mb-4">404</div>
        <h1 className="text-2xl font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-6 max-w-md">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
          <Button onClick={() => navigate('/servers')}>
            <Home className="h-4 w-4 mr-2" />
            Home
          </Button>
        </div>
      </div>
    </div>
  )
}
