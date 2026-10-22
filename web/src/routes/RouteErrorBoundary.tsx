import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { PageMessage } from './adapters';

/** Router-level error element: 404s thrown as Responses (notFound shim) and any render/lazy-load failure. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const detail = error instanceof Error ? error.message : isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : '';
  return (
    <PageMessage text={notFound ? 'Page not found' : 'Something went wrong loading this page'}>
      {!notFound && detail && <code className="max-w-xl break-words text-xs">{detail}</code>}
      <Link to="/dashboard" className="text-[var(--brand-a-ink)] underline">
        Back to dashboard
      </Link>
    </PageMessage>
  );
}
