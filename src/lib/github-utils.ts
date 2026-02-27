import { Semaphore } from "es-toolkit/promise";

import type { GitHubFileEntry } from "../types/fetch.js";
import { formatError } from "../utils/error.js";
import { logger } from "../utils/logger.js";
import type { GitHubClient } from "./github-client.js";

const MAX_RECURSION_DEPTH = 15;

/**
 * Execute an async function with semaphore-controlled concurrency.
 * Ensures the semaphore permit is always released, even if the function throws.
 */
export async function withSemaphore<T>(semaphore: Semaphore, fn: () => Promise<T>): Promise<T> {
  await semaphore.acquire();
  try {
    return await fn();
  } finally {
    semaphore.release();
  }
}

/**
 * Recursively list all files in a GitHub directory.
 */
export async function listDirectoryRecursive(params: {
  client: GitHubClient;
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  depth?: number;
  semaphore: Semaphore;
}): Promise<GitHubFileEntry[]> {
  const { client, owner, repo, path, ref, depth = 0, semaphore } = params;

  // Try using Tree API for better performance (one API call instead of many)
  if (depth === 0 && ref) {
    try {
      const tree = await withSemaphore(semaphore, () => client.getTree(owner, repo, ref, true));
      if (!tree.truncated) {
        // Filter tree entries by path prefix
        const prefix = path === "." || path === "" ? "" : path.endsWith("/") ? path : path + "/";
        return tree.tree
          .filter((entry) => {
            if (entry.type !== "blob") return false;
            if (prefix === "") return true;
            return entry.path.startsWith(prefix);
          })
          .map((entry) => ({
            name: entry.path.split("/").pop() ?? "",
            path: entry.path,
            sha: entry.sha,
            size: entry.size ?? 0,
            type: "file",
            download_url: null,
          }));
      }
      logger.debug(
        `Tree API result for ${owner}/${repo}@${ref} is truncated, falling back to recursive listing.`,
      );
    } catch (error) {
      logger.debug(
        `Tree API failed for ${owner}/${repo}@${ref}, falling back to recursive listing: ${formatError(error)}`,
      );
    }
  }

  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(
      `Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded while listing directory: ${path}`,
    );
  }

  // Semaphore is released here before recursive Promise.all below to avoid deadlock
  const entries = await withSemaphore(semaphore, () =>
    client.listDirectory(owner, repo, path, ref),
  );

  const files: GitHubFileEntry[] = [];
  const directories: GitHubFileEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "file") {
      files.push(entry);
    } else if (entry.type === "dir") {
      directories.push(entry);
    }
  }

  const subResults = await Promise.all(
    directories.map((dir) =>
      listDirectoryRecursive({
        client,
        owner,
        repo,
        path: dir.path,
        ref,
        depth: depth + 1,
        semaphore,
      }),
    ),
  );

  return [...files, ...subResults.flat()];
}
