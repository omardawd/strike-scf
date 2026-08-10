# Security Policy

Strike SCF is a pre-launch supply-chain finance platform. We have no production customers yet, but we handle realistic KYB, financial, and contract data in our development/demo environment and take its security seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Email: `security@strikescf.com` *(placeholder — Owner: replace with a real monitored address before any external party, including a prospective customer's security team, is given this file)*

Include:
- A description of the issue and its potential impact
- Steps to reproduce (proof-of-concept code or requests welcome)
- The affected URL(s), endpoint(s), or component(s)
- Your assessment of severity, if you have one

We do not currently operate a bug bounty program. We ask researchers to:
- Give us a reasonable window to investigate and remediate before public disclosure (30 days is a reasonable default; we will communicate if more time is genuinely needed and why)
- Avoid accessing, modifying, or exfiltrating data beyond what's needed to demonstrate the issue
- Avoid actions with a material risk of degrading service for others (no load testing framed as a "DoS finding," no bulk data extraction)

## Response process

See [`docs/security/INCIDENT_RESPONSE.md`](docs/security/INCIDENT_RESPONSE.md) for the internal process this triggers. As a pre-launch product we do not yet have a tested SLA for acknowledgment/remediation timelines — this is itself tracked as a gap in `docs/enterprise-readiness/ROADMAP.md`.

## Supported versions

Single deployment target (no versioned releases) — the `main` branch as deployed to production is the only supported version. There is no LTS or backport policy.

## Scope

In scope:
- `apps/web` — the application itself, its API routes, and its authentication/authorization logic
- Infrastructure configuration in this repository (`.github/workflows/`, `supabase/migrations/`)

Out of scope:
- Third-party services we depend on (Supabase, Vercel, Anthropic, Resend, Tavily) — report those directly to the respective vendor
- Social engineering, physical security, or attacks against Strike personnel rather than the product

## What "security" means for this project today

This is an honest snapshot, not a claim of maturity. See [`docs/enterprise-readiness/ASSESSMENT.md`](docs/enterprise-readiness/ASSESSMENT.md) for the full, evidence-cited current-state audit, and [`docs/enterprise-readiness/CONTROL_MATRIX.md`](docs/enterprise-readiness/CONTROL_MATRIX.md) for what's implemented vs. planned per control area. No claim of a completed penetration test, SOC 2 attestation, or ISO certification should be inferred from this document or any other in this repository unless explicitly stated with evidence.
