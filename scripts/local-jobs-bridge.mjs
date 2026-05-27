#!/usr/bin/env node
import { handleQueueBatch } from "../apps/jobs/dist/queue.js";

export function createCountingArtifactsBucket(baseBucket, jobsEnv) {
  return {
    list(options) {
      return baseBucket.list(options);
    },
    delete(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      jobsEnv.SYNC_BYTE_PURGE_DELETED_OBJECTS = (jobsEnv.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) + keyList.length;
      return baseBucket.delete(keys);
    },
  };
}

export function createSyncBytePurgeQueue(jobsEnv) {
  return {
    async send(message) {
      const ack = () => {};
      await handleQueueBatch(
        {
          queue: "byte-purge",
          messages: [{ body: message, ack, retry: () => {} }],
        },
        jobsEnv,
      );
    },
    async sendBatch(messages) {
      for (const message of messages) {
        await this.send(message.body ?? message);
      }
    },
  };
}

export function createJobsEnv({ repo, artifacts, denylist, smokeHarnessSecret }) {
  const jobsEnv = {
    AGENT_PASTE_ENV: "dev",
    SMOKE_HARNESS_SECRET: smokeHarnessSecret,
    LOCAL_MVP_REPOSITORY: repo,
    DENYLIST: denylist,
    SYNC_BYTE_PURGE_DELETED_OBJECTS: 0,
  };
  jobsEnv.ARTIFACTS = createCountingArtifactsBucket(artifacts, jobsEnv);
  jobsEnv.BYTE_PURGE_QUEUE = createSyncBytePurgeQueue(jobsEnv);
  return jobsEnv;
}
