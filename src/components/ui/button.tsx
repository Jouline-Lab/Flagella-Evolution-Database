import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default:
          "bg-blue-600 text-white shadow-xs hover:bg-blue-700 focus-visible:ring-blue-500/40",
        destructive:
          "bg-red-600 text-white shadow-xs hover:bg-red-700 focus-visible:ring-red-500/30",
        outline:
          "border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text)] shadow-xs hover:bg-[var(--dropdown-hover)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)]",
        secondary:
          "bg-[var(--panel-bg-medium)] text-[var(--text)] shadow-xs hover:bg-[var(--panel-bg-soft)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)]",
        ghost:
          "text-[var(--text)] hover:bg-[var(--dropdown-hover)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)]",
        link: "text-blue-700 underline-offset-4 hover:underline focus-visible:ring-blue-500/30"
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
