# Solver Evaluation & Constraint Parity

This document details the operational and algorithmic constraints enforced across the allocation solvers in FloodRelay.

## Constraint Parity Matrix

| Constraint                     | Nearest-First (Greedy) | Urgency-batched savings + 2-opt | Cluster-Allocation | Notes / Differences                                                                                                                                                                                                                                                      |
| ------------------------------ | :--------------------: | :-----------------------------: | :----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Capacity**                   |           ✅           |               ✅                |         ✅         | Never exceeds vehicle passenger capacity; drops off at shelter when full or when no further requests fit.                                                                                                                                                                |
| **Availability**               |           ✅           |               ✅                |         ✅         | Only allocates resources with `AVAILABLE` or `ASSIGNED` status; `MAINTENANCE` or `OFFLINE` resources receive no routes.                                                                                                                                                  |
| **Shift limit**                |           ✅           |               ✅                |         ✅         | Enforces maximum operational duration (`maxShiftMinutes`, default 480 min). Before any pickup is committed, the solver verifies that transit to the pickup plus the return leg to the nearest shelter does not exceed `maxShiftMinutes`.                                 |
| **Shelter drop-offs**          |           ✅           |               ✅                |         ✅         | Automatically routes vehicles to safe shelters to unload passengers whenever capacity requires or upon trip conclusion.                                                                                                                                                  |
| **Multiple trips per vehicle** |           ✅           |               ✅                |         ✅         | Vehicles execute multiple pickup-dropoff cycles from shelters as long as remaining shift duration permits.                                                                                                                                                               |
| **Return to depot**            |      ✅ (Shelter)      |          ✅ (Shelter)           |    ✅ (Shelter)    | In flood rescue operations, vehicles terminate trips at a designated safe shelter rather than deadheading back to initial spawn locations (ADR-11).                                                                                                                      |
| **Frozen stops**               |           ❌           |               ❌                |         ✅         | Cluster-Allocation supports `existingFrozenRoutes` for interactive replanning without reshuffling operator-committed stops. The two baseline solvers are static comparative benchmarks evaluated from an unassigned initial state and do not accept frozen route inputs. |

## Rationale for Differences

### Frozen Stops

In the FloodRelay architecture, operators review proposed routes and commit them. When new requests arrive or flood conditions change, the solver replans remaining demand while keeping committed stops fixed (frozen).

- **Cluster-Allocation** is designed as the production replanning heuristic and directly implements `existingFrozenRoutes` pre-seeding.
- **Nearest-First** and **Urgency-batched savings + 2-opt** serve as static algorithmic baselines used to benchmark dispatch quality, priority wait times, and travel efficiency against standard routing heuristics on clean benchmark cases. They do not maintain dynamic replanning state.
