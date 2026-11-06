import { FileQuestion, RefreshCw, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ApiError } from "../api/client";

/** A detail page that couldn't show its entity: "not found" when the server
 * said 404 (deleted, or a stale link), otherwise the error with a retry. */
export function LoadFailed({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  const navigate = useNavigate();
  const missing = error === null || error === undefined || (error instanceof ApiError && error.status === 404);
  const Icon = missing ? FileQuestion : TriangleAlert;
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Icon className="size-10 text-muted-foreground" />
      <h1 className="text-xl">{missing ? `This ${what} doesn't exist` : `Couldn't load this ${what}`}</h1>
      <p className="text-sm text-muted-foreground">
        {missing
          ? "It may have been deleted, or the link points at another guild."
          : (error as Error).message}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Go back</Button>
        {!missing && onRetry && <Button onClick={onRetry}><RefreshCw /> Try again</Button>}
      </div>
    </section>
  );
}
