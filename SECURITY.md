# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately with GitHub's **"Report a vulnerability"** button in the **Security** tab of this repository. Include what an attacker could do, the steps to reproduce it, and the version (or commit) you tested.

You should get an answer within a week. Once the problem is fixed, it will be credited to you in the release notes, unless you prefer otherwise.

## What is in scope

MTG RePrint runs a small web server on your own computer. The most important protections are:

- the server listens on `127.0.0.1` only;
- requests addressed to any host other than `localhost`, `127.0.0.1` or `[::1]` are refused (protection against DNS rebinding);
- every POST must be `Content-Type: application/json`, so other websites cannot call the API from your browser without a CORS preflight, which the server never accepts;
- static files and cached images cannot be read outside their folders (no path traversal).

A way for a website, or another user of the network, to get around any of these is exactly what we want to hear about. Problems in the dependencies are welcome too, if they affect MTG RePrint.

Out of scope: anything that needs an attacker who can already run programs on your computer.
