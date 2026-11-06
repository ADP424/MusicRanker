import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** Catches a page that crashed while rendering, so the shell (and the way to
 * every other page) survives it. The shell keys it by route, so navigating
 * away resets it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <TriangleAlert className="size-10 text-destructive" />
        <h1 className="text-xl">This page hit a bug</h1>
        <p className="text-sm break-words text-muted-foreground">{error.message}</p>
        <Button onClick={() => this.setState({ error: null })}>Try again</Button>
      </section>
    );
  }
}
