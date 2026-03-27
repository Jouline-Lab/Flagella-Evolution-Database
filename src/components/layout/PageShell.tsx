import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageShellProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
};

export default function PageShell({
  children,
  className,
  innerClassName
}: PageShellProps) {
  return (
    <main className={cn("species-page", className)}>
      <div className={cn("container species-page-inner", innerClassName)}>{children}</div>
    </main>
  );
}
