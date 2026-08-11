# Security policy

## Supported versions

Security fixes are applied to the latest release and `main`.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting for this repository. Include the affected component, reproduction steps, impact, and any suggested mitigation.

We will acknowledge a complete report as soon as practical, coordinate a fix and disclosure, and credit reporters who want attribution.

## Deployment responsibility

This project is a security-sensitive template that can read code and create pull requests. Operators must review the [threat model](docs/THREAT-MODEL.md), restrict GitHub App installation and permissions, protect branches, rotate secrets, and validate policies before production use.
