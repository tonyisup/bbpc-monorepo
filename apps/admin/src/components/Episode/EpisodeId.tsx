import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";

/** Show and copy the complete canonical ID returned by Convex. */
export function EpisodeId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      toast.success("Episode ID copied.");
    } catch {
      toast.error(
        "Could not copy the episode ID. Select the ID and copy it manually."
      );
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>Episode ID</span>
      <code className="select-all break-all">{id}</code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2"
        aria-label={`Copy episode ID ${id}`}
        onClick={() => void copyId()}
      >
        {copied ? (
          <Check className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
