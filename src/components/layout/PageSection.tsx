import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageSectionProps = {
  children: ReactNode;
  className?: string;
};

export default function PageSection({ children, className }: PageSectionProps) {
  return <section className={cn("species-card", className)}>{children}</section>;
}
