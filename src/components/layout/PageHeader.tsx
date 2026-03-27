import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className
}: PageHeaderProps) {
  return (
    <header className={cn("species-header", className)}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {actions ? <div className="hero-actions">{actions}</div> : null}
    </header>
  );
}
