import { bench, describe, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import type { GitHubFileEntry, GitHubTree } from "../types/fetch.js";
import { GitHubClient } from "./github-client.js";
import { resolveAndFetchSources } from "./sources.js";

/**
 * Benchmark for `rulesync install` performance optimizations.
 *
 * References:
 * - PERFORMANCE_OPTIMIZATIONS_SUMMARY.md: Parallelization and GitHub Recursive Tree API.
 * - BUG_FIX_SUMMARY_SKILLS_INSTALL.md: Robustness in GitHub Tree API handling.
 */

// Mock delay to simulate network latency (5ms per roundtrip)
const NETWORK_LATENCY = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

vi.mock(import("./github-client.js"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github-client.js")>();
  const MockGitHubClient = vi.fn(
    class extends actual.GitHubClient {
      static override resolveToken = vi.fn().mockReturnValue("mock-token");
    },
  );

  // Set up mocked methods on the prototype so they are shared across all instances
  MockGitHubClient.prototype.getDefaultBranch = vi.fn();
  MockGitHubClient.prototype.listDirectory = vi.fn();
  MockGitHubClient.prototype.getFileContent = vi.fn();
  MockGitHubClient.prototype.resolveRefToSha = vi.fn();
  MockGitHubClient.prototype.getTree = vi.fn();

  return {
    ...actual,
    GitHubClient: MockGitHubClient,
  };
});

vi.mock(import("../utils/file.js"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/file.js")>();
  return {
    ...actual,
    directoryExists: vi.fn().mockResolvedValue(false),
    removeDirectory: vi.fn().mockResolvedValue(undefined),
    writeFileContent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock(import("../utils/logger.js"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/logger.js")>();
  return {
    ...actual,
    logger: {
      ...actual.logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      configure: vi.fn(),
    } as unknown as typeof actual.logger,
  };
});

vi.mock(import("./sources-lock.js"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources-lock.js")>();
  return {
    ...actual,
    readLockFile: vi.fn().mockResolvedValue({ lockfileVersion: 1, sources: {} }),
    writeLockFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("install command performance", async () => {
  const { testDir } = await setupTestDirectory();

  // Scale: 5 sources * 20 skills * 10 files = 1000 files.
  const sources = Array.from({ length: 5 }, (_, i) => ({
    source: `https://github.com/org/repo-${i + 1}`,
  }));

  const skillNames = Array.from({ length: 20 }, (_, i) => `skill-${i + 1}`);
  const fileNames = Array.from({ length: 10 }, (_, i) => `file-${i + 1}.ts`);

  const setupMocks = (useTreeApi: boolean) => {
    vi.mocked(GitHubClient.prototype.getDefaultBranch).mockImplementation(async () => {
      await sleep(NETWORK_LATENCY);
      return "main";
    });

    vi.mocked(GitHubClient.prototype.resolveRefToSha).mockImplementation(async () => {
      await sleep(NETWORK_LATENCY);
      return "abc123def456";
    });

    vi.mocked(GitHubClient.prototype.getTree).mockImplementation(
      async (_owner, _repo, _ref, _recursive) => {
        await sleep(NETWORK_LATENCY);
        if (!useTreeApi) throw new Error("Tree API disabled");

        const tree: GitHubTree["tree"] = [];
        for (const skill of skillNames) {
          tree.push({ path: `skills/${skill}`, type: "tree", mode: "040000", sha: "sha-" + skill });
          for (let i = 0; i < fileNames.length; i++) {
            const file = fileNames[i];
            tree.push({
              path: `skills/${skill}/${file}`,
              type: "blob",
              mode: "100644",
              sha: `sha-${skill}-${file}`,
              size: 100,
              // Omit url for some entries to test robustness (BUG_FIX_SUMMARY_SKILLS_INSTALL.md)
              ...(i === 0
                ? {}
                : { url: `https://api.github.com/repos/org/repo/git/blobs/sha-${skill}-${file}` }),
            } as GitHubTree["tree"][number]);
          }
        }
        return { sha: "tree-sha", tree, truncated: false } as GitHubTree;
      },
    );

    vi.mocked(GitHubClient.prototype.listDirectory).mockImplementation(
      async (_owner, _repo, path) => {
        await sleep(NETWORK_LATENCY);
        if (path === "skills") {
          return skillNames.map(
            (name) =>
              ({
                name,
                path: `skills/${name}`,
                type: "dir",
                sha: "sha-" + name,
                size: 0,
                download_url: null,
              }) as unknown as GitHubFileEntry,
          );
        }
        if (path.startsWith("skills/")) {
          return fileNames.map(
            (name) =>
              ({
                name,
                path: `${path}/${name}`,
                type: "file",
                sha: `sha-${path}-${name}`,
                size: 100,
                download_url: null,
              }) as unknown as GitHubFileEntry,
          );
        }
        return [];
      },
    );

    vi.mocked(GitHubClient.prototype.getFileContent).mockImplementation(async () => {
      await sleep(NETWORK_LATENCY);
      return "mock content";
    });
  };

  bench(
    "Optimized: Parallel Discovery + Tree API + Parallel Fetch (1000 files)",
    async () => {
      setupMocks(true);
      await resolveAndFetchSources({
        sources,
        baseDir: testDir,
        options: { updateSources: true },
      });
    },
    { iterations: 5 },
  );

  bench(
    "Unoptimized (Simulated): Sequential Fallback (1000 files)",
    async () => {
      setupMocks(false);
      await resolveAndFetchSources({
        sources,
        baseDir: testDir,
        options: { updateSources: true },
      });
    },
    { iterations: 1 },
  );
});
