import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-9 w-80" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
      <Card>
        <CardContent className="p-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border-t first:border-t-0 p-3"><Skeleton className="h-5 w-full" /></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
