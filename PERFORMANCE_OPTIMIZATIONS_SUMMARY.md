# Performance Optimizations Summary

I have implemented the performance optimizations for `rulesync install` as outlined in `INSTALL_PERFORMANCE_INVESTIGATION.md`. The improvements include:

1.  **Parallel File and Skill Processing**: Used `Promise.all` to fetch file contents and process skills within a source concurrently, while respecting the global `FETCH_CONCURRENCY_LIMIT` via semaphores.
2.  **Source Parallelization**: Refactored `resolveAndFetchSources` into a three-phase process:
    - **Parallel Discovery**: Simultaneously resolve SHAs and list remote skills for all sources.
    - **Sequential Claiming**: Maintain "first-win" precedence for duplicate skill names and handle directory cleanup safely.
    - **Parallel Fetch**: Concurrently download file contents for all selected skills across all sources.
3.  **GitHub Recursive Tree API**:
    - Added `getTree` to `GitHubClient` to leverage the Git Trees API.
    - Optimized `listDirectoryRecursive` and `prepareSourcePlan` to fetch the entire repository structure in a single API call, drastically reducing latency for large repositories.
4.  **Disk Check Optimization**: Parallelized `checkLockedSkillsExist` to speed up the skip-re-fetch verification.

All existing tests in `src/lib/sources.test.ts` pass, confirming that the optimizations preserve the original logic and safety guarantees (path traversal protection, integrity checks, and local/first-win precedence).
