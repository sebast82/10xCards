import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

function EmptyState({ title, icon, action }: EmptyStateProps) {
  return (
    <Card data-slot="empty-state">
      <CardContent className="flex flex-col items-start gap-3">
        {icon}
        <p className="text-muted-foreground text-sm">{title}</p>
        {action}
      </CardContent>
    </Card>
  );
}

export { EmptyState };
