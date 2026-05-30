import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function TableSkeleton({
  title = "Loading…",
  rows = 8,
  cols = 6,
}: {
  title?: string;
  rows?: number;
  cols?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <Card>
        <div className="flex items-center justify-between gap-2 p-3 border-b">
          <Skeleton className="h-9 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        <div className="p-3">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {Array.from({ length: cols }).map((_, i) => (
              <Skeleton key={`h${i}`} className="h-4 w-3/4" />
            ))}
            {Array.from({ length: rows * cols }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between p-3 border-t">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-48" />
        </div>
      </Card>

      {/* a11y label */}
      <span className="sr-only">{title}</span>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div>
      <Skeleton className="h-7 w-40 mb-5" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="lg:col-span-7 p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
        </Card>
        <Card className="lg:col-span-5 p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
        </Card>
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Card className="p-6 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}
