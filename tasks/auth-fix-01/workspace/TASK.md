# Task: fix the Notely login system

You are working in a small Node.js project (no dependencies, Node 20+). The auth module
lives in `src/auth.js`. Users have filed these bug reports:

1. "I signed up a minute ago and I can't log in with the exact password I just set."
2. "I registered as `Sam@Example.com ` (with a stray space) and now `sam@example.com` doesn't work."
3. "Right after logging in, every page says my session is invalid."
4. "I clicked log out, but my old session token still works."
5. "Someone was able to 'register' with my email and it replaced my password."
6. "Security review: the account lockout lets an attacker try more than 5 wrong passwords in 15 minutes."

Requirements:

- Fix all six problems in `src/auth.js`.
- Keep the public API the same: `createAuth`, `AuthError`, and the `register`, `login`,
  `verify`, `logout` functions with their current signatures and return shapes.
- Emails are case-insensitive and surrounding whitespace is ignored.
- Registering an email that already exists must throw `AuthError` with code `EMAIL_TAKEN`.
- Sessions last 1 hour. After 5 failed attempts within 15 minutes, further logins for that
  email throw `AuthError` with code `LOCKED` (even with the correct password) until the window passes.
- Run `npm test` to check your work. The visible tests do not cover everything; the
  evaluator runs an additional hidden test suite.
- Do not add dependencies. Do not modify or delete tests.
