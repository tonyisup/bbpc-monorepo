import { Skeleton } from "./ui/skeleton";

export const EpisodeSkeleton = () => {
  return (
    <section
      className="bbpc-panel flex w-full min-w-0 flex-col gap-5 overflow-hidden p-4 sm:p-6"
      aria-label="Loading episode"
    >
      <div className="grid min-w-0 gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-full max-w-md sm:order-3 sm:col-span-3" />
        <Skeleton className="h-5 w-28 sm:ml-auto" />
      </div>
      <Skeleton className="h-4 w-full max-w-2xl" />
      <div className="flex min-w-0 max-w-full gap-2 overflow-hidden">
        {[1, 2, 3].map((item) => (
          <Skeleton
            key={item}
            className="h-[108px] w-[72px] flex-none rounded-lg sm:h-[162px] sm:w-[108px]"
          />
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-full" />
    </section>
  );
};
