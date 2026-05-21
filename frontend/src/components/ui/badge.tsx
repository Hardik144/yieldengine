import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-mono font-semibold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500",
  {
    variants: {
      variant: {
        default:
          "border-slate-700 bg-slate-900/90 text-slate-200",
        autoApproved:
          "border-emerald-500/50 bg-emerald-950/70 text-emerald-300",
        requiresReview:
          "border-amber-500/60 bg-amber-950/75 text-amber-300",
        manuallyApproved:
          "border-cyan-500/60 bg-cyan-950/75 text-cyan-300",
        rejected:
          "border-red-500/60 bg-red-950/75 text-red-300",
        terminalAmber:
          "border-amber-500/50 bg-amber-500/10 text-amber-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
