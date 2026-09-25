"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SeasonSeries } from "@/lib/seasonActivity";

export function SeasonPointsChart({
  series,
  unavailable = false,
}: {
  series: SeasonSeries;
  /** The season has points but is too large for the backend to total. */
  unavailable?: boolean;
}) {
  const comparisonName =
    series.comparison === null
      ? null
      : `${series.comparison.label} · ${series.comparison.name ?? "Player"}`;
  return (
    <section className="bbpc-panel p-4 sm:p-5" aria-label="Points over the season">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-white">Points over the season</h2>
        <span className="text-sm text-zinc-400">Cumulative, by scoring day</span>
      </div>
      {series.rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-sm text-zinc-400">
          {unavailable
            ? "Standings are unavailable for a season this large."
            : "The chart fills in once this season has scoring activity."}
        </p>
      ) : (
        <div className="mt-4 h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={series.rows}
              margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="var(--bbpc-border)"
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "var(--bbpc-muted)" }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "var(--bbpc-muted)" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bbpc-bg)",
                  border: "1px solid var(--bbpc-border)",
                  borderRadius: "var(--radius)",
                  color: "var(--bbpc-text)",
                }}
                itemStyle={{ fontSize: "12px", fontWeight: 700 }}
                labelStyle={{
                  color: "var(--bbpc-muted)",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="plainline"
                wrapperStyle={{
                  paddingBottom: "16px",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              />
              <Line
                type="monotone"
                dataKey="average"
                name="Field average"
                stroke="#71717a"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                dot={false}
              />
              {comparisonName !== null && (
                <Line
                  type="monotone"
                  dataKey="comparison"
                  name={comparisonName}
                  stroke="#d4d4d8"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="you"
                name="You"
                stroke="#ef4444"
                strokeWidth={3}
                dot={{ r: 3, strokeWidth: 0, fill: "#ef4444" }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
