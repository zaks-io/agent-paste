#!/usr/bin/env node
import { handleQueueBatch } from "../apps/jobs/dist/queue.js";
import { createLocalMvpSqlExecutor } from "../packages/db/dist/index.js";

export function createCountingArtifactsBucket(baseBucket, jobsEnv) {
  return {
    head(key, options) {
      return baseBucket.head(key, options);
    },
    get(key, options) {
      return baseBucket.get(key, options);
    },
    put(key, value, options) {
      return baseBucket.put(key, value, options);
    },
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

export function createSyncBundleGenerateQueue(jobsEnv) {
  return {
    async send(message) {
      const ack = () => {};
      await handleQueueBatch(
        {
          queue: "bundle-generate",
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

export function createSyncSafetyScanQueue(jobsEnv) {
  return {
    async send(message) {
      const ack = () => {};
      await handleQueueBatch(
        {
          queue: "safety-scan",
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

export function createJobsEnv({ repo, db, artifacts, denylist, smokeHarnessSecret, artifactBytesEncryptionKey }) {
  if (!repo && !db) {
    throw new Error("createJobsEnv requires repo or db.");
  }
  const jobsEnv = {
    AGENT_PASTE_ENV: "dev",
    SMOKE_HARNESS_SECRET: smokeHarnessSecret,
    ARTIFACT_BYTES_ENCRYPTION_KEY: artifactBytesEncryptionKey,
    ...(repo ? { LOCAL_MVP_REPOSITORY: repo } : {}),
    DB:
      db ??
      createLocalMvpSqlExecutor({
        workspaces: repo.workspaces,
        workspaceMembers: repo.workspaceMembers,
        apiKeys: repo.apiKeys,
        artifacts: repo.artifacts,
        revisions: repo.revisions,
        artifactFiles: repo.artifactFiles,
        uploadSessions: repo.uploadSessions,
        uploadSessionFiles: repo.uploadSessionFiles,
        operationEvents: repo.operationEvents,
        platformLockdowns: repo.platformLockdowns,
        accessLinks: repo.accessLinks,
        safetyWarnings: repo.safetyWarnings,
      }),
    DENYLIST: denylist,
    SYNC_BYTE_PURGE_DELETED_OBJECTS: 0,
  };
  jobsEnv.ARTIFACTS = createCountingArtifactsBucket(artifacts, jobsEnv);
  jobsEnv.BYTE_PURGE_QUEUE = createSyncBytePurgeQueue(jobsEnv);
  jobsEnv.BUNDLE_GENERATE_QUEUE = createSyncBundleGenerateQueue(jobsEnv);
  jobsEnv.SAFETY_SCAN_QUEUE = createSyncSafetyScanQueue(jobsEnv);
  return jobsEnv;
}
