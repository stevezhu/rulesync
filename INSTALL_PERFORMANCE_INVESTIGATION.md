# Investigation: `rulesync install` Performance

## Summary of Findings

The `install` command is slow primarily because it processes sources, skills, and files sequentially. While it uses a semaphore to limit concurrency, the current implementation doesn't actually leverage parallel execution in several critical loops.

## Detailed Bottlenecks

### 1. Sequential Source Processing

In `src/lib/sources.ts`, `resolveAndFetchSources` iterates through all sources in a `for` loop, awaiting each `fetchSource` call before starting the next one.

```typescript
for (const sourceEntry of sources) {
  // ...
  const result = await fetchSource(...);
  // ...
}
```

### 2. Sequential Skill Processing within Sources

Inside `fetchSource`, it iterates through all skills in the repository sequentially.

```typescript
for (const skillDir of filteredDirs) {
  // ...
  const allFiles = await listDirectoryRecursive(...);
  // ...
  for (const file of files) {
    // ...
  }
}
```

### 3. Sequential File Fetching within Skills

Even though it uses a semaphore, it `await`s each `getFileContent` call inside the loop, meaning only one file is fetched at a time.

```typescript
for (const file of files) {
  // ...
  const content = await withSemaphore(semaphore, () =>
    client.getFileContent(...),
  );
  // ...
}
```

### 4. High Number of API Calls

The `listDirectoryRecursive` function makes a separate API call for every subdirectory. For large skill repositories, this adds significant latency.

## Proposed Optimizations

### 1. Parallelize File Fetching

Modify the file fetching loop to use `Promise.all`. Since `withSemaphore` already manages concurrency, this will allow up to 10 (or `FETCH_CONCURRENCY_LIMIT`) simultaneous file downloads.

### 2. Parallelize Skill Processing

Process multiple skills within a source simultaneously using `Promise.all`. We should share the same `Semaphore` instance across all skills to stay within the global concurrency limit.

### 3. Parallelize Source Processing

Process sources in parallel.
_Note: We must ensure that the "first-win" logic for duplicate skill names is preserved. This can be achieved by processing all sources in parallel and then merging their results in the original order._

### 4. Leverage GitHub Recursive Tree API

Instead of recursive `getContent` calls (which are slow), use the [Git Trees API](https://docs.github.com/en/rest/git/trees#get-a-tree) with `recursive=1`. This allows fetching the entire file structure of a repository in a single API call.

### 5. Efficient Lockfile and Disk Checks

Currently, if a SHA matches, we still check if all skill directories exist on disk. We can optimize this by performing these checks in parallel.

## Implementation Plan

1.  **Phase 1: Quick Wins (Parallelize Loops)**
    - Update the file fetching loop in `fetchSource` to use `Promise.all`.
    - Update the skill directory loop in `fetchSource` to use `Promise.all`.

2.  **Phase 2: Source Parallelization**
    - Refactor `resolveAndFetchSources` to fetch all sources in parallel while maintaining the correct precedence for skill name conflicts.

3.  **Phase 3: API Optimization**
    - Introduce a new method in `GitHubClient` to fetch recursive trees.
    - Update `listDirectoryRecursive` or replace it with a more efficient tree-based approach.
