import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Button, Container } from "react-bootstrap";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Last-resort safety net: React unmounts the entire tree on any uncaught
// render error, so a single bad row (e.g. a null entry in a list) would
// otherwise blank the whole app instead of just that page. This can't
// prevent state from getting corrupted, but it stops a corruption bug from
// taking the whole product down — and gives the user a self-service way to
// clear whatever's stuck instead of needing DevTools/support.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Container className="py-5" style={{ maxWidth: 560 }}>
        <Alert variant="danger">
          <Alert.Heading className="h5">Something went wrong</Alert.Heading>
          <p className="small mb-3">
            This page hit an unexpected error and couldn't continue. Reloading usually fixes it — if it keeps
            happening, clearing this tab's saved data will reset the page back to a clean state.
          </p>
          <div className="d-flex gap-2">
            <Button size="sm" variant="danger" onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button
              size="sm"
              variant="outline-danger"
              onClick={() => {
                sessionStorage.clear();
                window.location.reload();
              }}
            >
              Clear saved data &amp; reload
            </Button>
          </div>
        </Alert>
      </Container>
    );
  }
}
