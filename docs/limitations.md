# Known Limitations

This file documents honest limitations of the system. Keep it updated as the project grows.

---

- **Demo rescue requests are simulated.** All demo and test requests are generated from seeded scripts and are labelled `SIMULATED`. They do not represent real incidents.

- **OSRM uses static map data.** OSRM does not know which roads are currently flooded. Operators mark blocked areas manually, and routes crossing them are flagged. This means routing may suggest paths through areas that are actually impassable until an operator marks them.

- **No live traffic.** Travel-time estimates do not account for real-time traffic conditions.

- **Results are from simulated scenarios.** All evaluation results are from simulated scenarios and are not field-validated. They should not be interpreted as guarantees of real-world performance.

- **TODO:** A real Google OR-Tools baseline is not implemented. The current algorithmic baselines are Nearest-First (Greedy) and Clarke-Wright (savings + 2-opt).
