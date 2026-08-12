'use client';

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type SyllabusInsertPosition,
  syllabusInsertPositionLabels,
  syllabusInsertPositions,
} from "@/lib/syllabus";

interface SyllabusInsertPositionMenuProps {
  selectedPosition: SyllabusInsertPosition;
  onSelect: (position: SyllabusInsertPosition) => void;
  trigger: ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  contentClassName?: string;
}

const SyllabusInsertPositionMenu = ({
  selectedPosition,
  onSelect,
  trigger,
  align = "end",
  sideOffset = 8,
  contentClassName,
}: SyllabusInsertPositionMenuProps) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={sideOffset} className={cn("w-44 p-2", contentClassName)}>
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Current: {syllabusInsertPositionLabels[selectedPosition]}
        </p>
        <div className="flex flex-col gap-1">
          {syllabusInsertPositions.map((position) => (
            <button
              key={position}
              type="button"
              onClick={() => {
                onSelect(position);
                setOpen(false);
              }}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                position === selectedPosition && "bg-accent text-accent-foreground",
              )}
            >
              <span>{syllabusInsertPositionLabels[position]}</span>
              {position === selectedPosition && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SyllabusInsertPositionMenu;
