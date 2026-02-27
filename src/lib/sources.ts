import { join, resolve, sep } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import type { SourceEntry } from "../config/config.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { getLocalSkillDirNames } from "../features/skills/skills-utils.js";
import type { GitHubFileEntry, ParsedSource } from "../types/fetch.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  directoryExists,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "./github-client.js";
import { listDirectoryRecursive, withSemaphore } from "./github-utils.js";
import { parseSource } from "./source-parser.js";
import {
  type LockedSkill,
  type LockedSource,
  type SourcesLock,
  computeSkillIntegrity,
  createEmptyLock,
  getLockedSkillNames,
  getLockedSource,
  normalizeSourceKey,
  readLockFile,
  setLockedSource,
  writeLockFile,
} from "./sources-lock.js";

export type ResolveAndFetchSourcesOptions = {
  /** Force re-resolve all refs, ignoring the lockfile. */
  updateSources?: boolean;
  /** Skip fetching entirely (use what's already on disk). */
  skipSources?: boolean;
  /** Fail if lockfile is missing or doesn't match sources (for CI). */
  frozen?: boolean;
  /** GitHub token for private repositories. */
  token?: string;
};

export type ResolveAndFetchSourcesResult = {
  fetchedSkillCount: number;
  sourcesProcessed: number;
};

/**
 * Plan for fetching a single source.
 */
type SourcePlan = {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  baseDir: string;
  parsed: ParsedSource;
  sourceKey: string;
  locked: LockedSource | undefined;
  lockedSkillNames: string[];
  ref: string;
  resolvedSha: string;
  requestedRef: string | undefined;
  remoteSkillDirs: Array<{ name: string; path: string }>;
  skillFilesMap: Record<string, GitHubFileEntry[]>;
  isSkipReFetch: boolean;
};

/**
 * Resolve declared sources, fetch remote skills into .rulesync/skills/.curated/,
 * and update the lockfile.
 */
export async function resolveAndFetchSources(params: {
  sources: SourceEntry[];
  baseDir: string;
  options?: ResolveAndFetchSourcesOptions;
}): Promise<ResolveAndFetchSourcesResult> {
  const { sources, baseDir, options = {} } = params;

  if (sources.length === 0) {
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }

  if (options.skipSources) {
    logger.info("Skipping source fetching.");
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }

  // Read existing lockfile
  let lock: SourcesLock = options.updateSources
    ? createEmptyLock()
    : await readLockFile({ baseDir });

  // Frozen mode: validate lockfile covers all declared sources.
  // Missing curated skills are fetched using locked refs.
  if (options.frozen) {
    const missingKeys: string[] = [];

    for (const source of sources) {
      const locked = getLockedSource(lock, source.source);
      if (!locked) {
        missingKeys.push(source.source);
      }
    }
    if (missingKeys.length > 0) {
      throw new Error(
        `Frozen install failed: lockfile is missing entries for: ${missingKeys.join(", ")}. Run 'rulesync install' to update the lockfile.`,
      );
    }
  }

  const originalLockJson = JSON.stringify(lock);

  // Resolve GitHub token
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  // Determine local skills (in .rulesync/skills/ but not in .curated/)
  const localSkillNames = await getLocalSkillDirNames(baseDir);

  const allFetchedSkillNames = new Set<string>();

  // 1. Parallel Discovery Phase: Resolve all sources and list their remote skills
  const sourcePlans = await Promise.all(
    sources.map(async (sourceEntry) => {
      try {
        return await prepareSourcePlan({
          sourceEntry,
          client,
          baseDir,
          lock,
          updateSources: options.updateSources ?? false,
        });
      } catch (error) {
        if (error instanceof GitHubClientError) {
          logGitHubAuthHints(error);
        } else {
          logger.error(`Failed to resolve source "${sourceEntry.source}": ${formatError(error)}`);
        }
        return null;
      }
    }),
  );

  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const curatedDir = join(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

  // 2. Sequential Preparation Phase: Claim skill names and perform cleanup
  const executionTasks = [];
  for (const plan of sourcePlans) {
    if (!plan) continue;
    if (plan.isSkipReFetch) {
      executionTasks.push({ plan, skillsToFetch: [], isSkip: true });
      for (const name of plan.lockedSkillNames) {
        allFetchedSkillNames.add(name);
      }
      continue;
    }

    const skillsToFetch = determineSkillsToFetch({
      plan,
      localSkillNames,
      alreadyFetchedSkillNames: allFetchedSkillNames,
    });

    for (const skill of skillsToFetch) {
      allFetchedSkillNames.add(skill.name);
    }

    // Perform cleanup for this source sequentially to avoid race conditions with other sources' fetches
    await cleanupPreviousSkills(plan, curatedDir);

    executionTasks.push({ plan, skillsToFetch, isSkip: false });
  }

  // 3. Parallel Fetch Phase: Fetch all contents for all sources
  const results = await Promise.all(
    executionTasks.map(async (task) => {
      if (task.isSkip) {
        if (!task.plan.locked) {
          throw new Error(`Locked source entry missing for skipped source: ${task.plan.sourceKey}`);
        }
        return {
          skillCount: 0,
          fetchedSkillNames: task.plan.lockedSkillNames,
          sourceKey: task.plan.sourceKey,
          updatedSourceEntry: task.plan.locked,
        };
      }

      return await executeSourceFetch({
        plan: task.plan,
        skillsToFetch: task.skillsToFetch,
        semaphore,
        curatedDir,
      });
    }),
  );

  let totalSkillCount = 0;
  for (const result of results) {
    totalSkillCount += result.skillCount;
    // Update the lock with the new source info
    lock = setLockedSource(lock, result.sourceKey, result.updatedSourceEntry);
  }

  // Prune stale lockfile entries whose keys are not in the current sources (immutable)
  const sourceKeys = new Set(sources.map((s) => normalizeSourceKey(s.source)));
  const prunedSources: typeof lock.sources = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (sourceKeys.has(normalizeSourceKey(key))) {
      prunedSources[key] = value;
    } else {
      logger.debug(`Pruned stale lockfile entry: ${key}`);
    }
  }
  lock = { lockfileVersion: lock.lockfileVersion, sources: prunedSources };

  // Only write lockfile if it has changed (and not in frozen mode)
  if (!options.frozen && JSON.stringify(lock) !== originalLockJson) {
    await writeLockFile({ baseDir, lock });
  } else {
    logger.debug("Lockfile unchanged, skipping write.");
  }

  return { fetchedSkillCount: totalSkillCount, sourcesProcessed: sources.length };
}

/**
 * Check if all locked skills exist on disk in the curated directory.
 */
async function checkLockedSkillsExist(curatedDir: string, skillNames: string[]): Promise<boolean> {
  if (skillNames.length === 0) return true;

  const results = await Promise.all(
    skillNames.map((name) => directoryExists(join(curatedDir, name))),
  );

  return results.every(Boolean);
}

/**
 * Discovery phase: Resolve the source ref and list remote skills without fetching contents.
 */
async function prepareSourcePlan(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  baseDir: string;
  lock: SourcesLock;
  updateSources: boolean;
}): Promise<SourcePlan> {
  const { sourceEntry, client, baseDir, lock, updateSources } = params;

  const parsed = parseSource(sourceEntry.source);

  if (parsed.provider === "gitlab") {
    throw new Error("GitLab sources are not yet supported.");
  }

  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];

  // Resolve the ref to a commit SHA
  let ref: string;
  let resolvedSha: string;
  let requestedRef: string | undefined;

  if (locked && !updateSources) {
    // Use the locked SHA for deterministic fetching
    ref = locked.resolvedRef;
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    logger.debug(`Using locked ref for ${sourceKey}: ${resolvedSha}`);
  } else {
    // Resolve the ref (or default branch) to a SHA
    requestedRef = parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
    resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
    ref = resolvedSha;
    logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
  }

  const curatedDir = join(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

  // Skip re-fetch check
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    const allExist = await checkLockedSkillsExist(curatedDir, lockedSkillNames);
    if (allExist) {
      logger.debug(`SHA unchanged for ${sourceKey}, skipping re-fetch.`);
      return {
        sourceEntry,
        client,
        baseDir,
        parsed,
        sourceKey,
        locked,
        lockedSkillNames,
        ref,
        resolvedSha,
        requestedRef,
        remoteSkillDirs: [],
        skillFilesMap: {},
        isSkipReFetch: true,
      };
    }
  }

  // List the skills/ directory in the remote repo.
  const skillsBasePath = parsed.path ?? "skills";
  const prefix =
    skillsBasePath === "." || skillsBasePath === ""
      ? ""
      : skillsBasePath.endsWith("/")
        ? skillsBasePath
        : skillsBasePath + "/";

  let remoteSkillDirs: Array<{ name: string; path: string }> = [];
  const skillFilesMap: Record<string, GitHubFileEntry[]> = {};

  // Try fetching the entire repo tree for O(1) discovery and listing
  try {
    const treeResult = await client.getTree(parsed.owner, parsed.repo, ref, true);
    if (!treeResult.truncated) {
      const skillDirsSet = new Set<string>();
      for (const entry of treeResult.tree) {
        if (!entry.path.startsWith(prefix)) continue;
        const relativePath = entry.path.substring(prefix.length);
        if (!relativePath) continue;
        const parts = relativePath.split("/");
        const skillName = parts[0] ?? "";
        skillDirsSet.add(skillName);
        if (entry.type === "blob") {
          if (!skillFilesMap[skillName]) skillFilesMap[skillName] = [];
          skillFilesMap[skillName].push({
            name: parts[parts.length - 1] ?? "",
            path: entry.path,
            sha: entry.sha,
            size: entry.size ?? 0,
            type: "file",
            download_url: null,
          });
        }
      }
      remoteSkillDirs = Array.from(skillDirsSet).map((name) => ({
        name,
        path: `${prefix}${name}`,
      }));

      return {
        sourceEntry,
        client,
        baseDir,
        parsed,
        sourceKey,
        locked,
        lockedSkillNames,
        ref,
        resolvedSha,
        requestedRef,
        remoteSkillDirs,
        skillFilesMap,
        isSkipReFetch: false,
      };
    }
    logger.debug(
      `Tree API result for ${sourceKey} is truncated, falling back to sequential listing.`,
    );
  } catch (error) {
    logger.debug(
      `Tree API failed for ${sourceKey}, falling back to sequential listing: ${formatError(error)}`,
    );
  }

  // Fallback: List the skills directory sequentially
  try {
    const entries = await client.listDirectory(parsed.owner, parsed.repo, skillsBasePath, ref);
    remoteSkillDirs = entries
      .filter((e) => e.type === "dir")
      .map((e) => ({ name: e.name, path: e.path }));
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      logger.warn(`No skills/ directory found in ${sourceKey}. Skipping.`);
      return {
        sourceEntry,
        client,
        baseDir,
        parsed,
        sourceKey,
        locked,
        lockedSkillNames,
        ref,
        resolvedSha,
        requestedRef,
        remoteSkillDirs: [],
        skillFilesMap: {},
        isSkipReFetch: false,
      };
    }
    throw error;
  }

  return {
    sourceEntry,
    client,
    baseDir,
    parsed,
    sourceKey,
    locked,
    lockedSkillNames,
    ref,
    resolvedSha,
    requestedRef,
    remoteSkillDirs,
    skillFilesMap: {}, // Empty map forces re-fetch using listDirectoryRecursive
    isSkipReFetch: false,
  };
}

/**
 * Determine which skills to fetch for a given source plan.
 */
function determineSkillsToFetch(params: {
  plan: SourcePlan;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
}): Array<{ name: string; path: string }> {
  const { plan, localSkillNames, alreadyFetchedSkillNames } = params;
  const { sourceEntry, remoteSkillDirs, sourceKey } = plan;

  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = skillFilter.length === 1 && skillFilter[0] === "*";

  const filteredDirs = isWildcard
    ? remoteSkillDirs
    : remoteSkillDirs.filter((d) => skillFilter.includes(d.name));

  const toFetch: Array<{ name: string; path: string }> = [];

  for (const skillDir of filteredDirs) {
    // Validate skill directory name
    if (
      skillDir.name.includes("..") ||
      skillDir.name.includes("/") ||
      skillDir.name.includes("\\")
    ) {
      logger.warn(
        `Skipping skill with invalid name "${skillDir.name}" from ${sourceKey}: contains path traversal characters.`,
      );
      continue;
    }

    // Skip local skills
    if (localSkillNames.has(skillDir.name)) {
      logger.debug(
        `Skipping remote skill "${skillDir.name}" from ${sourceKey}: local skill takes precedence.`,
      );
      continue;
    }

    // Skip already fetched skills (precedence)
    if (alreadyFetchedSkillNames.has(skillDir.name)) {
      logger.warn(
        `Skipping duplicate skill "${skillDir.name}" from ${sourceKey}: already fetched from another source.`,
      );
      continue;
    }

    toFetch.push(skillDir);
  }

  return toFetch;
}

/**
 * Remove previously curated skills for a source before re-fetching.
 */
async function cleanupPreviousSkills(plan: SourcePlan, curatedDir: string): Promise<void> {
  const { locked, lockedSkillNames } = plan;
  if (!locked) return;

  const resolvedCuratedDir = resolve(curatedDir);
  for (const prevSkill of lockedSkillNames) {
    const prevDir = join(curatedDir, prevSkill);
    // Verify path to prevent traversal
    if (!resolve(prevDir).startsWith(resolvedCuratedDir + sep)) {
      logger.warn(
        `Skipping removal of "${prevSkill}": resolved path is outside the curated directory.`,
      );
      continue;
    }
    if (await directoryExists(prevDir)) {
      await removeDirectory(prevDir);
    }
  }
}

/**
 * Fetch skill contents in parallel for a given source.
 */
async function executeSourceFetch(params: {
  plan: SourcePlan;
  skillsToFetch: Array<{ name: string; path: string }>;
  semaphore: Semaphore;
  curatedDir: string;
}): Promise<{
  skillCount: number;
  fetchedSkillNames: string[];
  sourceKey: string;
  updatedSourceEntry: LockedSource;
}> {
  const { plan, skillsToFetch, semaphore, curatedDir } = params;
  const { client, parsed, sourceKey, locked, ref, resolvedSha, requestedRef } = plan;

  const fetchedSkills: Record<string, LockedSkill> = {};

  const skillResults = await Promise.all(
    skillsToFetch.map(async (skillDir) => {
      // Recursively fetch all files in this skill directory
      // Use pre-fetched files from discovery phase if available
      const allFiles =
        plan.skillFilesMap[skillDir.name] ??
        (await listDirectoryRecursive({
          client,
          owner: parsed.owner,
          repo: parsed.repo,
          path: skillDir.path,
          ref,
          semaphore,
        }));

      // Filter out files exceeding MAX_FILE_SIZE
      const files = allFiles.filter((file) => {
        if (file.size > MAX_FILE_SIZE) {
          logger.warn(
            `Skipping file "${file.path}" (${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
          );
          return false;
        }
        return true;
      });

      // Fetch all file contents and compute integrity hash
      const skillFiles = await Promise.all(
        files.map(async (file) => {
          // Calculate relative path within the skill directory
          const relativeToSkill = file.path.substring(skillDir.path.length + 1);
          const localFilePath = join(curatedDir, skillDir.name, relativeToSkill);

          // Validate path to prevent traversal attacks
          checkPathTraversal({
            relativePath: relativeToSkill,
            intendedRootDir: join(curatedDir, skillDir.name),
          });

          const content = await withSemaphore(semaphore, () =>
            client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
          );
          await writeFileContent(localFilePath, content);
          return { path: relativeToSkill, content };
        }),
      );

      const integrity = computeSkillIntegrity(skillFiles);

      // Verify integrity against lockfile hash when available
      const lockedSkillEntry = locked?.skills[skillDir.name];
      if (
        lockedSkillEntry &&
        lockedSkillEntry.integrity &&
        lockedSkillEntry.integrity !== integrity &&
        resolvedSha === locked?.resolvedRef
      ) {
        logger.warn(
          `Integrity mismatch for skill "${skillDir.name}" from ${sourceKey}: expected "${lockedSkillEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
        );
      }

      return { name: skillDir.name, integrity };
    }),
  );

  for (const result of skillResults) {
    if (result) {
      fetchedSkills[result.name] = { integrity: result.integrity };
      logger.debug(`Fetched skill "${result.name}" from ${sourceKey}`);
    }
  }

  const fetchedNames = Object.keys(fetchedSkills);

  // Merge newly fetched skills with existing locked skills that were skipped
  // (due to local precedence, already-fetched, etc.) to prevent overwriting their entries
  const mergedSkills: Record<string, LockedSkill> = { ...fetchedSkills };
  if (locked) {
    for (const [skillName, skillEntry] of Object.entries(locked.skills)) {
      if (!(skillName in mergedSkills)) {
        mergedSkills[skillName] = skillEntry;
      }
    }
  }

  const updatedSourceEntry = {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    skills: mergedSkills,
  };

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`,
  );

  return {
    skillCount: fetchedNames.length,
    fetchedSkillNames: fetchedNames,
    sourceKey,
    updatedSourceEntry,
  };
}
