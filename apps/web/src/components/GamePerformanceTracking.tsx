"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPlainDate } from "@/lib/dates";
import type { GamePerformanceData } from "@/types/game";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f43f5e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];
const dateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  timeZone: "America/Los_Angeles",
});

type PerformancePoint = GamePerformanceData["points"][number];
type PerformanceSummaryItem = GamePerformanceData["userSummary"][number];

const buildChartData = (
  points: PerformancePoint[],
  userSummary: PerformanceSummaryItem[]
) => {
  const chartDataPointMap = new Map<string, Record<string, number | string>>();
  const runningTotals: Record<string, number> = {};

  for (const user of userSummary) {
    runningTotals[user.id] = 0;
  }

  for (const point of points) {
    const dateKey = dateLabelFormatter.format(new Date(point.earnedAt));

    runningTotals[point.userId] =
      (runningTotals[point.userId] ?? 0) + point.pointValue;
    chartDataPointMap.set(dateKey, {
      date: dateKey,
      ...runningTotals,
    });
  }

  return Array.from(chartDataPointMap.values());
};

const buildSummaryRows = (
  chartData: Record<string, number | string>[],
  userSummary: PerformanceSummaryItem[]
) => {
  return userSummary.map((user) => {
    const series = chartData.map((point) => Number(point[user.id] ?? 0));
    const latestScore = series.at(-1) ?? 0;
    const peakScore = series.length > 0 ? Math.max(...series) : 0;
    const firstScore = series[0] ?? 0;

    return {
      id: user.id,
      name: user.name ?? "Player",
      latestScore,
      peakScore,
      trendValue: latestScore - firstScore,
    };
  });
};

export default function GamePerformanceTracking({
  data,
}: {
  data: GamePerformanceData | null;
}) {
  if (!data) {
    return null;
  }

  const chartData = buildChartData(data.points, data.userSummary);
  const summaryRows = buildSummaryRows(chartData, data.userSummary);

  return (
    <Card className="overflow-hidden border-zinc-800 bg-black/70 text-white shadow-xl shadow-black/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <TrendingUp className="h-5 w-5 text-zinc-200" />
          Performance Tracking
        </CardTitle>
        <CardDescription className="text-base text-zinc-400">
          Cumulative point progression throughout {data.season.title}.
          {data.season.endedOn && (
            <p>This season ends on {formatPlainDate(data.season.endedOn)}.</p>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {chartData.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 px-6 text-center text-sm text-zinc-400">
            Point history will appear here once the current season has recorded
            scoring activity.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 16, right: 12, left: -16, bottom: 0 }}
                >
                  <defs>
                    {data.userSummary.map((user, index) => (
                      <linearGradient
                        key={user.id}
                        id={`game-performance-${user.id}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={COLORS[index % COLORS.length]}
                          stopOpacity={0.18}
                        />
                        <stop
                          offset="95%"
                          stopColor={COLORS[index % COLORS.length]}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="rgba(255,255,255,0.08)"
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#09090b",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "14px",
                      color: "#fafafa",
                      boxShadow: "0 24px 48px rgba(0, 0, 0, 0.45)",
                    }}
                    itemStyle={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#fafafa",
                    }}
                    labelStyle={{
                      color: "#a1a1aa",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    wrapperStyle={{
                      paddingBottom: "20px",
                      fontSize: "10px",
                      textTransform: "uppercase",
                      fontWeight: 800,
                    }}
                  />
                  {data.userSummary.map((user, index) => (
                    <Area
                      key={user.id}
                      type="monotone"
                      dataKey={user.id}
                      name={user.name ?? "Player"}
                      stroke={COLORS[index % COLORS.length]}
                      fill={`url(#game-performance-${user.id})`}
                      fillOpacity={1}
                      strokeWidth={3}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
              <table
                className="min-w-full text-left text-sm"
                aria-label="Performance tracking summary table"
              >
                <caption className="caption-top px-4 py-3 text-left text-sm font-semibold text-zinc-200">
                  Performance tracking summary
                </caption>
                <thead className="border-b border-zinc-800 text-xs uppercase tracking-[0.2em] text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Player</th>
                    <th className="px-4 py-3 font-semibold">Current</th>
                    <th className="px-4 py-3 font-semibold">Peak</th>
                    <th className="px-4 py-3 font-semibold">Net Change</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-zinc-900 last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="px-4 py-3 font-semibold text-zinc-100"
                      >
                        {user.name}
                      </th>
                      <td className="px-4 py-3 text-zinc-300">
                        {user.latestScore}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {user.peakScore}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {user.trendValue > 0 ? "+" : ""}
                        {user.trendValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
