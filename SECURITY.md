# Security Policy

## Supported Versions

We provide security updates for the following versions of Multi-Race-Timer:

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within Multi-Race-Timer, please report it responsibly:

1. **Do NOT** create a public GitHub issue.
2. Please report security issues privately via GitHub Security Advisories or by emailing the maintainer.
3. Include details of the vulnerability, steps to reproduce, and potential impact.
4. We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan as quickly as possible.

## Security Best Practices for Operators

When deploying Multi-Race-Timer:
- **Always set a strong `SECRET_KEY`** (64 random hexadecimal characters or similar).
- **Enforce HTTPS** in production and set `SESSION_COOKIE_SECURE=true`.
- **Set a strong `ADMIN_PASS`** before starting the container for the first time.
- Keep Docker images and host OS updated.
