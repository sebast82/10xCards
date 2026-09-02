import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

function EmptyState({ title, icon, action, className }: EmptyStateProps) {
  return (
    <Card data-slot="empty-state" className={cn(className)}>
      <CardContent className="flex flex-col items-start gap-3">
        {icon}
        <p className="text-muted-foreground text-sm">{title}</p>
        {action}
      </CardContent>
    </Card>
  );
}

export { EmptyState };
