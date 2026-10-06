export default function QuotabungaArchiveLoading() {
  return (
    <div className="bbpc-page space-y-6" role="status">
      <span className="sr-only">Loading Quotabunga</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-10 w-64 rounded-md bg-white/[0.08]" />
        <div className="h-4 w-80 max-w-full rounded-md bg-white/[0.08]" />
      </div>
      <div
        aria-hidden="true"
        className="bbpc-panel divide-y divide-white/[0.12]"
      >
        {[70, 52, 61].map((width) => (
          <div key={width} className="space-y-2.5 px-4 py-5 lg:px-5">
            <div className="h-3.5 w-28 rounded-md bg-white/[0.08]" />
            <div
              className="h-3.5 rounded-md bg-white/[0.08]"
              style={{ width: `${width}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
