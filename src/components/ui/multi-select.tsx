import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select...",
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((s) => s !== value)
        : [...selected, value]
    );
  };

  const remove = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selected.filter((s) => s !== value));
  };

  const selectedLabels = selected
    .map((v) => options.find((o) => o.value === v))
    .filter(Boolean);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between h-auto min-h-10 px-3 py-2 font-normal",
            className
          )}
        >
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedLabels.length > 0 ? (
              selectedLabels.map((opt) => (
                <Badge
                  key={opt!.value}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-5 gap-1"
                >
                  {opt!.label}
                  <X
                    className="h-3 w-3 cursor-pointer hover:text-destructive"
                    onClick={(e) => remove(opt!.value, e)}
                  />
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground text-sm">{placeholder}</span>
            )}
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
        <div className="max-h-60 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <div
                key={opt.value}
                className={cn(
                  "flex items-start gap-2 px-2 py-1.5 rounded-sm cursor-pointer text-sm hover:bg-accent transition-colors",
                  isSelected && "bg-accent/50"
                )}
                onClick={() => toggle(opt.value)}
              >
                <div
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border mt-0.5",
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/30"
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{opt.label}</div>
                  {opt.description && (
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
