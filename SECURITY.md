# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) on this repository (Security → Report a vulnerability). If private reporting is unavailable, contact the maintainers directly and include:

- A description of the issue and its impact
- Steps or a minimal reproduction (a snippet is enough for compiler/runtime bugs)
- Affected package(s) and version/commit

## Response targets

- Acknowledgement: within 72 hours
- Assessment and fix plan: within 7 days
- Fix release: within 30 days for exploitable issues

## Scope

This repository publishes pre-1.0 software; only the latest commit on `develop` is supported. Areas of particular interest for a UI framework:

- XSS via the compiler output, source map emission, or runtime attribute/text binding paths
- Prototype pollution through prop spreading, storage envelopes, or cache-key serialization
- SSR markup injection (text/attribute/comment escaping)
- Path traversal or script injection in the Vite plugin and HTML components

Once a fix ships, we publish an advisory with credit to the reporter (unless anonymity is requested).
