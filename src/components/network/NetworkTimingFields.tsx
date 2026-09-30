import type { NetworkTiming } from "@/services/networkObservatory";
import { intervalName } from "./shared";

const localOffset = -new Date().getTimezoneOffset();

export function NetworkTimingFields({
  value,
  intervals,
  onChange,
  label = "检测频率",
}: {
  value: Partial<NetworkTiming>;
  intervals: number[];
  onChange: (next: Partial<NetworkTiming>) => void;
  label?: string;
}) {
  const daily = value.scheduleType === "daily";
  const times = value.dailyTimes?.length ? value.dailyTimes : ["03:00"];
  return (
    <div className="network-timing-fields">
      <label>
        {label}
        <select
          value={
            daily ? "daily" : String(value.intervalMinutes || intervals[0])
          }
          onChange={(event) => {
            if (event.target.value === "daily")
              onChange({
                ...value,
                scheduleType: "daily",
                intervalMinutes: value.intervalMinutes || intervals[0],
                dailyTimes: times,
                utcOffsetMinutes: value.utcOffsetMinutes ?? localOffset,
              });
            else
              onChange({
                ...value,
                scheduleType: "interval",
                intervalMinutes: Number(event.target.value),
                dailyTimes: [],
                utcOffsetMinutes: 0,
              });
          }}
        >
          {intervals.map((minutes) => (
            <option key={minutes} value={minutes}>
              {intervalName(minutes)}
            </option>
          ))}
          <option value="daily">每天指定时刻</option>
        </select>
      </label>
      {daily && (
        <div className="network-daily-times">
          <label>
            固定 UTC 时差（小时）
            <input
              type="number"
              min={-12}
              max={14}
              step={0.25}
              value={(value.utcOffsetMinutes ?? localOffset) / 60}
              onChange={(event) =>
                onChange({
                  ...value,
                  utcOffsetMinutes: Math.round(Number(event.target.value) * 60),
                })
              }
            />
            <small>
              固定时差不会随夏令时自动变化；请按希望的检测地区填写。
            </small>
          </label>
          <div className="network-daily-time-list">
            {times.map((time, index) => (
              <label key={index}>
                时刻 {index + 1}
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      dailyTimes: times.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    })
                  }
                />
                {times.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        dailyTimes: times.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      })
                    }
                  >
                    移除
                  </button>
                )}
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={times.length >= 8}
            onClick={() =>
              onChange({
                ...value,
                dailyTimes: [
                  ...times,
                  Array.from(
                    { length: 24 },
                    (_, hour) => `${String(hour).padStart(2, "0")}:00`,
                  ).find((time) => !times.includes(time)) || "12:00",
                ],
              })
            }
          >
            添加每日时刻（最多 8 个）
          </button>
        </div>
      )}
    </div>
  );
}
