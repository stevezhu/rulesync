import { z } from "zod/mini";

import { ALL_FEATURES_WITH_WILDCARD } from "./features.js";
import { FetchTargetSchema } from "./fetch-targets.js";
import type { GitProvider } from "./git-provider.js";

/**
 * Conflict resolution strategies for fetch command
 */
export const ConflictStrategySchema = z.enum(["skip", "overwrite"]);
export type ConflictStrategy = z.infer<typeof ConflictStrategySchema>;

/**
 * GitHub file type from API response
 */
export const GitHubFileTypeSchema = z.enum(["file", "dir", "symlink", "submodule"]);
export type GitHubFileType = z.infer<typeof GitHubFileTypeSchema>;

/**
 * GitHub tree entry from Git Trees API
 */
export const GitHubTreeEntrySchema = z.looseObject({
  path: z.string(),
  mode: z.string(),
  type: z.enum(["blob", "tree", "commit"]),
  sha: z.string(),
  size: z.optional(z.number()),
  url: z.optional(z.string()),
});
export type GitHubTreeEntry = z.infer<typeof GitHubTreeEntrySchema>;

/**
 * GitHub tree response from Git Trees API
 */
export const GitHubTreeSchema = z.looseObject({
  sha: z.string(),
  url: z.optional(z.string()),
  tree: z.array(GitHubTreeEntrySchema),
  truncated: z.boolean(),
});
export type GitHubTree = z.infer<typeof GitHubTreeSchema>;

/**
 * GitHub file/directory entry from contents API
 */
export const GitHubFileEntrySchema = z.looseObject({
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  size: z.number(),
  type: GitHubFileTypeSchema,
  download_url: z.nullable(z.string()),
});
export type GitHubFileEntry = z.infer<typeof GitHubFileEntrySchema>;

/**
 * Parsed source specification for fetch command
 */
export type ParsedSource = {
  provider: GitProvider;
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
};

/**
 * Fetch command options
 */
export const FetchOptionsSchema = z.looseObject({
  target: z.optional(FetchTargetSchema),
  features: z.optional(z.array(z.enum(ALL_FEATURES_WITH_WILDCARD))),
  ref: z.optional(z.string()),
  path: z.optional(z.string()),
  output: z.optional(z.string()),
  conflict: z.optional(ConflictStrategySchema),
  token: z.optional(z.string()),
  verbose: z.optional(z.boolean()),
  silent: z.optional(z.boolean()),
});
export type FetchOptions = z.infer<typeof FetchOptionsSchema>;

/**
 * Result status for a single file fetch operation
 */
export const FetchFileStatusSchema = z.enum(["created", "overwritten", "skipped"]);
export type FetchFileStatus = z.infer<typeof FetchFileStatusSchema>;

/**
 * Result of a single file fetch operation
 */
export type FetchFileResult = {
  relativePath: string;
  status: FetchFileStatus;
};

/**
 * Summary of fetch operation
 */
export type FetchSummary = {
  source: string;
  ref: string;
  files: FetchFileResult[];
  created: number;
  overwritten: number;
  skipped: number;
};

/**
 * GitHub API error response
 */
export type GitHubApiError = {
  message: string;
  documentation_url?: string;
};

/**
 * Configuration for GitHub client
 */
export type GitHubClientConfig = {
  token?: string;
  baseUrl?: string;
};

/**
 * Repository information from GitHub API
 */
export const GitHubRepoInfoSchema = z.looseObject({
  default_branch: z.string(),
  private: z.boolean(),
});
export type GitHubRepoInfo = z.infer<typeof GitHubRepoInfoSchema>;

/**
 * GitHub release asset from releases API
 */
export const GitHubReleaseAssetSchema = z.looseObject({
  name: z.string(),
  browser_download_url: z.string(),
  size: z.number(),
});
export type GitHubReleaseAsset = z.infer<typeof GitHubReleaseAssetSchema>;

/**
 * GitHub release from releases API
 */
export const GitHubReleaseSchema = z.looseObject({
  tag_name: z.string(),
  name: z.nullable(z.string()),
  prerelease: z.boolean(),
  draft: z.boolean(),
  assets: z.array(GitHubReleaseAssetSchema),
});
export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;
