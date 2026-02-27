# Benchmark Comparison: `rulesync install` Optimizations

This document compares the performance of the `install` command before and after the performance optimizations.

## Benchmark Methodology

- **Scale**: 5 sources, 20 skills per source, 10 files per skill (Total ~1000 files).
- **Latency Simulation**: Each simulated network call (GitHub API) has a **5ms roundtrip latency** (`NETWORK_LATENCY`).
- **Timing**: Used real `sleep` calls to simulate the network wait time during RTTs.
- **Scenarios**:
  - **Optimized Path**: Uses the new GitHub Recursive Tree API and parallel source/file processing.
  - **Unoptimized Path**: Simulates the fallback to sequential directory listing (simulated by disabling the Tree API mock).

## Results Summary (Mean Execution Time)

| Branch                    | Optimized Path (Tree API + Parallel) | Unoptimized Path (Sequential Discovery) | Improvement (Branch vs Branch) |
| ------------------------- | ------------------------------------ | --------------------------------------- | ------------------------------ |
| `main` (Pre-optimization) | ~1,355ms                             | ~1,364ms                                | -                              |
| `feature` (Optimized)     | **~135ms**                           | **~159ms**                              | **~10x faster**                |

### Key Improvements

1. **Source Parallelization**: On the `feature` branch, even the "Unoptimized" path is **~8.5x faster** than `main` (159ms vs 1,364ms). This is due to refactoring the discovery and fetch phases to process all sources in parallel.
2. **Recursive Tree API**: On the `feature` branch, the "Optimized" path is **~1.18x faster** than the "Unoptimized" path (135ms vs 159ms). This represents the additional saving from using the Git Trees API to discover all files in a single request instead of recursively listing directories.
3. **Overall Impact**: The combined effect of parallel source discovery, parallel file fetching, and the Tree API results in a **10x reduction** in wall-clock time for a typical 1000-file installation with 5ms RTT.

### Conclusion

The performance optimizations have delivered a massive improvement in installation speed. Users with high-latency connections or those installing many skills from multiple sources will see the most significant benefits, with the command finishing in seconds rather than minutes.
