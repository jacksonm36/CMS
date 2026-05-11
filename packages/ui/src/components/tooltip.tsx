import * as React from "react";
import { cn } from "../utils";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
}

function Tooltip({ children, content, className }: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          className={cn(
            "absolute bottom-full left-1/2 z-50 -translate-x-1/2 -translate-y-1 rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
            className
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export { Tooltip };
