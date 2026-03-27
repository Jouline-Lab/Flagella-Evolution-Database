import { ReactNode } from "react";
import Link from "next/link";
import PageSection from "@/components/layout/PageSection";

type EmptyStateProps = {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  children?: ReactNode;
};

export default function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  children
}: EmptyStateProps) {
  return (
    <PageSection>
      <h2>{title}</h2>
      <p>{description}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="button button-secondary">
          {actionLabel}
        </Link>
      ) : null}
      {children}
    </PageSection>
  );
}
