import os from "node:os";

class MetricsRegistry {
  constructor() {
    this.startTime = Date.now();
    this.requestsTotal = new Map();
    this.requestDurations = [];
    this.maxDurationSamples = 500;

    // Triage metrics
    this.triageEnqueued = 0;
    this.triageCompleted = 0;
    this.triageFailed = 0;
    this.triageRulesFallback = 0;
    this.triageActive = 0;

    // AI API metrics
    this.geminiRequests = 0;
    this.geminiSuccesses = 0;
    this.geminiFailures = new Map();
  }

  recordRequest(method, path, statusCode, durationMs) {
    // Group parameterized routes to prevent metric cardinality explosion
    const normalizedPath = path
      .replace(/\/api\/reports\/[a-f0-9-]+/gi, "/api/reports/:id")
      .replace(/\/api\/reports\/CG-[A-Z0-9]+/gi, "/api/reports/:code")
      .replace(/\/api\/admin\/users\/[a-f0-9-]+/gi, "/api/admin/users/:id");

    const key = `${method} ${normalizedPath} ${statusCode}`;
    this.requestsTotal.set(key, (this.requestsTotal.get(key) ?? 0) + 1);

    if (this.requestDurations.length >= this.maxDurationSamples) {
      this.requestDurations.shift();
    }
    this.requestDurations.push(durationMs);
  }

  recordTriageEnqueued() {
    this.triageEnqueued += 1;
    this.triageActive += 1;
  }

  recordTriageCompleted() {
    this.triageCompleted += 1;
    this.triageActive = Math.max(0, this.triageActive - 1);
  }

  recordTriageFailed(reason = "unknown") {
    this.triageFailed += 1;
    this.triageActive = Math.max(0, this.triageActive - 1);
  }

  recordTriageRulesFallback() {
    this.triageRulesFallback += 1;
  }

  recordGeminiCall(success, errorType = null) {
    this.geminiRequests += 1;
    if (success) {
      this.geminiSuccesses += 1;
    } else {
      const type = errorType || "general_error";
      this.geminiFailures.set(type, (this.geminiFailures.get(type) ?? 0) + 1);
    }
  }

  getSnapshot() {
    const memory = process.memoryUsage();
    const sortedDurations = [...this.requestDurations].sort((a, b) => a - b);
    const count = sortedDurations.length;
    const p50 = count ? sortedDurations[Math.floor(count * 0.5)] : 0;
    const p95 = count ? sortedDurations[Math.floor(count * 0.95)] : 0;
    const p99 = count ? sortedDurations[Math.floor(count * 0.99)] : 0;

    return {
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      process: {
        memoryRssMb: Math.round(memory.rss / (1024 * 1024)),
        memoryHeapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        nodeVersion: process.version,
        loadAverage: os.loadavg(),
      },
      http: {
        totalRequests: [...this.requestsTotal.values()].reduce((acc, v) => acc + v, 0),
        p50LatencyMs: Math.round(p50),
        p95LatencyMs: Math.round(p95),
        p99LatencyMs: Math.round(p99),
        routes: Object.fromEntries(this.requestsTotal.entries()),
      },
      triageQueue: {
        enqueued: this.triageEnqueued,
        completed: this.triageCompleted,
        failed: this.triageFailed,
        rulesFallback: this.triageRulesFallback,
        activeInProgress: this.triageActive,
      },
      aiModel: {
        totalGeminiCalls: this.geminiRequests,
        successfulCalls: this.geminiSuccesses,
        failureBreakdown: Object.fromEntries(this.geminiFailures.entries()),
      },
    };
  }

  toPrometheusFormat() {
    const snapshot = this.getSnapshot();
    const lines = [
      "# HELP civicguard_uptime_seconds Application uptime in seconds",
      "# TYPE civicguard_uptime_seconds gauge",
      `civicguard_uptime_seconds ${snapshot.uptimeSeconds}`,
      "",
      "# HELP civicguard_memory_rss_bytes Resident Set Size memory usage in bytes",
      "# TYPE civicguard_memory_rss_bytes gauge",
      `civicguard_memory_rss_bytes ${process.memoryUsage().rss}`,
      "",
      "# HELP civicguard_http_requests_total Total HTTP requests handled",
      "# TYPE civicguard_http_requests_total counter",
    ];

    for (const [key, count] of this.requestsTotal.entries()) {
      const [method, route, status] = key.split(" ");
      lines.push(
        `civicguard_http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`,
      );
    }

    lines.push(
      "",
      "# HELP civicguard_triage_queue_enqueued_total Total incident triage tasks enqueued",
      "# TYPE civicguard_triage_queue_enqueued_total counter",
      `civicguard_triage_queue_enqueued_total ${snapshot.triageQueue.enqueued}`,
      "",
      "# HELP civicguard_triage_queue_completed_total Total incident triage tasks completed successfully",
      "# TYPE civicguard_triage_queue_completed_total counter",
      `civicguard_triage_queue_completed_total ${snapshot.triageQueue.completed}`,
      "",
      "# HELP civicguard_triage_queue_failed_total Total incident triage tasks failed",
      "# TYPE civicguard_triage_queue_failed_total counter",
      `civicguard_triage_queue_failed_total ${snapshot.triageQueue.failed}`,
      "",
      "# HELP civicguard_triage_queue_rules_fallback_total Total times triage fell back to rule-based classification",
      "# TYPE civicguard_triage_queue_rules_fallback_total counter",
      `civicguard_triage_queue_rules_fallback_total ${snapshot.triageQueue.rulesFallback}`,
      "",
      "# HELP civicguard_triage_queue_active_gauge Current number of triage tasks actively running",
      "# TYPE civicguard_triage_queue_active_gauge gauge",
      `civicguard_triage_queue_active_gauge ${snapshot.triageQueue.activeInProgress}`,
      "",
      "# HELP civicguard_ai_gemini_requests_total Total calls dispatched to Google Gemini AI API",
      "# TYPE civicguard_ai_gemini_requests_total counter",
      `civicguard_ai_gemini_requests_total ${snapshot.aiModel.totalGeminiCalls}`,
    );

    return lines.join("\n") + "\n";
  }
}

export const metrics = new MetricsRegistry();

export function logStructured(level, message, metadata = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    pid: process.pid,
    ...metadata,
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
