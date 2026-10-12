"use client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { Report, Reading } from "../lib/types";
export function WaterChart({ report }: { report: Report }) {
  return report.daily.length ? (
    <div className="chart" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={report.daily}>
          <CartesianGrid vertical={false} stroke="#e9ece7" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar
            name="لتر"
            dataKey="litres"
            fill="#6e9eac"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  ) : (
    <div className="empty-chart">
      <div className="chart-grid" />
      <p>لم تُسجّل عمليات ري في هذه الفترة بعد.</p>
      <small>ستظهر الكميات بعد تسجيل التنفيذ، وليس عند الاعتماد.</small>
    </div>
  );
}
export function MoistureChart({ readings }: { readings: Reading[] }) {
  const rows = readings
    .filter((r) => r.unit !== "raw")
    .slice()
    .reverse()
    .map((r) => ({
      time: new Date(r.measured_at).toLocaleTimeString("ar-SA", {
        timeZone: "Asia/Riyadh",
        hour: "2-digit",
        minute: "2-digit",
      }),
      value: r.value * (r.unit === "vwc_fraction" ? 100 : 1),
      point: r.point_id,
    }));
  return (
    <div className="chart" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}>
          <CartesianGrid vertical={false} stroke="#e9ece7" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line
            name="الرطوبة الحجمية %"
            dataKey="value"
            stroke="#487e89"
            strokeWidth={0}
            dot={{ r: 3, fill: "#487e89" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
