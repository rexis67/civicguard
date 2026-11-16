# Security Policy

## Supported versions

Security fixes are applied to the latest code on the default branch. Deployments
should use a current supported Node.js release and keep dependencies updated.

## Reporting a vulnerability

Please do not report exploitable vulnerabilities in public issues. Use GitHub's
private vulnerability reporting for this repository (Security → Advisories →
Report a vulnerability). Include the affected version or commit, impact, and
reproduction details. Avoid including real resident information, credentials,
or other sensitive data.

The maintainers will acknowledge reports as soon as practical, investigate the
impact, and coordinate a fix and disclosure timeline with the reporter. Please
allow time for a fix before publishing details.

## Deployment reminders

- Set a unique `JWT_SECRET` and `AUTHORITY_INVITE_CODE`; never commit `.env` files.
- Use HTTPS in production; the session cookie is Secure and HttpOnly.
- Restrict `CORS_ORIGINS`, configure trusted proxy hops accurately, and keep
  SQLite and uploaded images on protected persistent storage.
- Do not expose demo verification links or seed accounts in a production deployment.
