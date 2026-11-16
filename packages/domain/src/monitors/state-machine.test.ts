import { describe, expect, it } from "vitest";
import { applyCheckResult, type MonitorHealth } from "./state-machine";

const start: MonitorHealth = { state: "unknown", consecutiveFailures: 0, consecutiveSuccesses: 0 };

function run(results: ("up" | "down")[], from = start) {
  let h = from;
  const trace: string[] = [];
  for (const r of results) {
    const { next, transition } = applyCheckResult(h, r);
    h = next;
    trace.push(transition ? `${next.state}:${transition}` : next.state);
  }
  return trace;
}

describe("applyCheckResult", () => {
  it("follows the full outage lifecycle", () => {
    expect(run(["up", "down", "down", "down", "up", "up", "up"])).toEqual([
      "healthy", "degraded", "down:incident_opened", "down", "recovering", "healthy:incident_resolved", "healthy",
    ]);
  });

  it("does not open an incident on a single failure", () => {
    expect(run(["up", "down", "up", "down", "up"])).toEqual(["healthy", "degraded", "healthy", "degraded", "healthy"]);
  });

  it("needs two consecutive successes to recover", () => {
    expect(run(["down", "down", "up", "down", "up", "up"])).toEqual([
      "degraded", "down:incident_opened", "recovering", "down", "recovering", "healthy:incident_resolved",
    ]);
  });

  it("opens exactly one incident per outage", () => {
    const trace = run(["down", "down", "down", "up", "down", "down", "up", "up"]);
    expect(trace.filter((t) => t.endsWith("incident_opened"))).toHaveLength(1);
    expect(trace.filter((t) => t.endsWith("incident_resolved"))).toHaveLength(1);
  });

  it("can confirm an outage on a brand-new monitor", () => {
    expect(run(["down", "down"])).toEqual(["degraded", "down:incident_opened"]);
  });

  it("leaves paused monitors untouched", () => {
    const paused: MonitorHealth = { state: "paused", consecutiveFailures: 0, consecutiveSuccesses: 0 };
    expect(applyCheckResult(paused, "down")).toEqual({ next: paused, transition: null });
  });
});
