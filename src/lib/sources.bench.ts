import { join } from "node:path";
import { bench, describe, vi } from "vitest";
import { resolveAndFetchSources } from "./sources.js";
import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";

/**
 * Benchmark for `rulesync install` performance optimizations.
 * 
 * References:
 * - PERFORMANCE_OPTIMIZATIONS_SUMMARY.md: Parallelization and GitHub Recursive Tree API.
 * - BUG_FIX_SUMMARY_SKILLS_INSTALL.md: Robustness in GitHub Tree API handling.
 */

// Mock delay to simulate network latency
const NETWORK_LATENCY = 50;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let mockClientInstance: any;

vi.mock("./github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken = vi.fn().mockReturnValue("mock-token");
    getDefaultBranch(...args: any[]) { return mockClientInstance.getDefaultBranch(...args); }
    listDirectory(...args: any[]) { return mockClientInstance.listDirectory(...args); }
    getFileContent(...args: any[]) { return mockClientInstance.getFileContent(...args); }
    resolveRefToSha(...args: any[]) { return mockClientInstance.resolveRefToSha(...args); }
    getTree(...args: any[]) { return mockClientInstance.getTree(...args); }
  },
  GitHubClientError: class GitHubClientError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  logGitHubAuthHints: vi.fn(),
}));

vi.mock("../utils/file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/file.js")>();
  return {
    ...actual,
    directoryExists: vi.fn().mockResolvedValue(false),
    removeDirectory: vi.fn().mockResolvedValue(undefined),
    writeFileContent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    configure: vi.fn(),
  },
}));

vi.mock("./sources-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources-lock.js")>();
  return {
    ...actual,
    readLockFile: vi.fn().mockResolvedValue({ lockfileVersion: 1, sources: {} }),
    writeLockFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("install command performance", async () => {
  const { testDir, cleanup } = await setupTestDirectory();
  
  // Scale: 5 sources * 20 skills * 10 files = 1000 files.
  const sources = Array.from({ length: 5 }, (_, i) => ({ 
    source: `https://github.com/org/repo-${i + 1}` 
  }));

  const skillNames = Array.from({ length: 20 }, (_, i) => `skill-${i + 1}`);
  const fileNames = Array.from({ length: 10 }, (_, i) => `file-${i + 1}.ts`);

  const setupMocks = (useTreeApi: boolean) => {
    // Use fake timers to avoid real-time delays during network simulation
    vi.useFakeTimers();

    mockClientInstance = {
      getDefaultBranch: vi.fn().mockImplementation(async () => {
        vi.advanceTimersByTime(NETWORK_LATENCY);
        await Promise.resolve();
        return "main";
      }),
      resolveRefToSha: vi.fn().mockImplementation(async () => {
        vi.advanceTimersByTime(NETWORK_LATENCY);
        await Promise.resolve();
        return "abc123def456";
      }),
      getTree: vi.fn().mockImplementation(async (_owner, _repo, _ref, recursive) => {
        vi.advanceTimersByTime(NETWORK_LATENCY);
        await Promise.resolve();
        if (!useTreeApi) throw new Error("Tree API disabled");
        
        const tree = [];
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
              ...(i === 0 ? {} : { url: `https://api.github.com/repos/org/repo/git/blobs/sha-${skill}-${file}` })
            });
          }
        }
        return { sha: "tree-sha", tree, truncated: false };
      }),
      listDirectory: vi.fn().mockImplementation(async (_owner, _repo, path) => {
        vi.advanceTimersByTime(NETWORK_LATENCY);
        await Promise.resolve();
        if (path === "skills") {
          return skillNames.map(name => ({ name, path: `skills/${name}`, type: "dir", sha: "sha-" + name, size: 0 }));
        }
        if (path.startsWith("skills/")) {
          return fileNames.map(name => ({ name, path: `${path}/${name}`, type: "file", sha: `sha-${path}-${name}`, size: 100 }));
        }
        return [];
      }),
      getFileContent: vi.fn().mockImplementation(async () => {
        vi.advanceTimersByTime(NETWORK_LATENCY);
        await Promise.resolve();
        return "mock content";
      }),
    };
  };

  bench("Optimized: Parallel Discovery + Tree API + Parallel Fetch (1000 files)", async () => {
    setupMocks(true);
    await resolveAndFetchSources({
      sources,
      baseDir: testDir,
      options: { updateSources: true },
    });
    vi.useRealTimers();
  }, { iterations: 10 });

  bench("Unoptimized (Simulated): Sequential Fallback (1000 files)", async () => {
    setupMocks(false);
    await resolveAndFetchSources({
      sources,
      baseDir: testDir,
      options: { updateSources: true },
    });
    vi.useRealTimers();
  }, { iterations: 2 });
});
