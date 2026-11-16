const queue = [];
let activeJob = null;
let currentProcessor = null;
let idleResolvers = [];

function notifyIdle() {
  if (queue.length === 0 && activeJob === null) {
    const resolvers = idleResolvers.splice(0, idleResolvers.length);
    for (const resolve of resolvers) resolve();
  }
}

async function processNextJob() {
  if (activeJob || queue.length === 0 || !currentProcessor) {
    notifyIdle();
    return;
  }

  const nextJob = queue.shift();
  activeJob = nextJob;

  try {
    await currentProcessor(nextJob);
  } catch (error) {
    console.error('[triage-queue] Job failed:', error);
  } finally {
    activeJob = null;
    notifyIdle();
    if (queue.length > 0) {
      await processNextJob();
    }
  }
}

export function createTriageQueue(processor) {
  currentProcessor = processor;

  return {
    enqueue(job) {
      if (!job || typeof job.reportId !== 'string' || !job.reportId.trim()) {
        throw new TypeError('Triage jobs require a non-empty reportId.');
      }

      const existingIndex = queue.findIndex((queuedJob) => queuedJob.reportId === job.reportId);
      if (existingIndex >= 0) {
        queue[existingIndex] = { ...queue[existingIndex], ...job };
        return queue[existingIndex];
      }

      if (activeJob && activeJob.reportId === job.reportId) {
        return activeJob;
      }

      queue.push(job);
      void processNextJob();
      return job;
    },

    async whenIdle() {
      if (queue.length === 0 && activeJob === null) return;
      await new Promise((resolve) => {
        idleResolvers.push(resolve);
      });
    },

    getPendingCount() {
      return queue.length + (activeJob ? 1 : 0);
    },
  };
}
