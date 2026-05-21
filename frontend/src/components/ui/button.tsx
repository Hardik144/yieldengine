import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm text-xs font-mono font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-amber-500 text-slate-950 hover:bg-amber-400 border border-amber-400",
        approve:
          "bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-400/60",
        reject:
          "bg-red-600/90 text-white hover:bg-red-500 border border-red-400/60",
        outline:
          "border border-slate-700 bg-slate-900/90 text-slate-200 hover:bg-slate-800 hover:text-amber-300 hover:border-amber-500/50",
        ghost:
          "text-slate-300 hover:bg-slate-800/80 hover:text-amber-300",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2.5 py-1 text-[11px]",
        lg: "h-9 px-4 py-2 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
