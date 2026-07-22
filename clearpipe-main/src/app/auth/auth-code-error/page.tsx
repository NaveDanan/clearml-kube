import Link from 'next/link';

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold text-destructive">Authentication Error</h1>
        <p className="mt-4 text-muted-foreground">
          There was an error during the authentication process. This could happen if:
        </p>
        <ul className="mt-4 text-left text-sm text-muted-foreground list-disc list-inside space-y-1">
          <li>The link has expired</li>
          <li>The link has already been used</li>
          <li>There was a network error</li>
        </ul>
        <div className="mt-8">
          <Link 
            href="/login" 
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </Link>
        </div>
      </div>
    </div>
  );
}
