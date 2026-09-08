# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Real statement-level source maps for compiled TSX, with structured compiler diagnostics (`VOBS_Cxxx`) including source locations, code frames, and fix hints. Unsupported JSX shapes (member-expression and namespaced tags) now fail explicitly.
- Collision-safe runtime helper injection: compiler-provided helpers no longer conflict with user imports or local bindings of the same names.
- Resource client revision guard on every settle path, so late in-flight responses can no longer overwrite newer data or resurface stale errors after `mutate`/`optimistic`.
- Router guard against stale navigation commits: a navigation superseded during loader execution can no longer push history or overwrite the current route.

### Fixed

- Primitive list items now update when their value changes; object items still update in place through per-row proxies.
- Dynamic children (arrays and swapped nodes) now dispose their entire previous scope, preventing ghost effects from writing to detached DOM and fixing memory leaks in swapped arrays.
- `spreadProps`/`setStaticProps` apply `false` for property keys (e.g. `disabled={false}` clears the property) while attribute keys keep HTML semantics.
- Resource client view owner leak when the index of a list entry changes.
