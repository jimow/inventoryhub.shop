import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  indeterminate?: boolean;
};

export const Checkbox = React.forwardRef<HTMLInputElement, Props>(
  ({ className, indeterminate, checked, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);
    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = !!indeterminate;
    }, [indeterminate]);

    return (
      <span className={cn("relative inline-flex h-4 w-4 items-center justify-center", className)}>
        <input
          ref={innerRef}
          type="checkbox"
          checked={checked}
          {...props}
          className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded border border-input bg-background shadow-sm transition-colors checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
        {indeterminate ? (
          <Minus className="pointer-events-none h-3 w-3 text-primary-foreground opacity-100" />
        ) : (
          <Check className="pointer-events-none h-3 w-3 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
        )}
      </span>
    );
  }
);
Checkbox.displayName = "Checkbox";
