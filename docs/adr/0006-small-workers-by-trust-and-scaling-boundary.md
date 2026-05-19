# Small Workers by Trust and Scaling Boundary

Cloudflare Worker apps will be split into small deployable units when the boundary improves reasoning about trust, secrets, routing, scaling, or failure isolation. The platform should avoid a single mega Worker, but also avoid splitting endpoints so finely that deployments and shared contracts become harder to operate than the code they isolate.

Worker app directories should use product names such as `api`, `upload`, `content`, and `jobs` rather than repeating the `worker` suffix in each app name. The initial deployable apps are `api`, `upload`, `content`, `jobs`, and `web`; `upload` owns R2 write authority and direct-upload session finalization, while `content` serves published artifact content without mutation authority.

## Considered Options

- One Worker for all backend behavior: simple deployment, but mixes mutation APIs, content serving, auth, and background operations with different risk profiles.
- One Worker per endpoint: highly isolated, but creates operational overhead and duplicate plumbing.
- Small Workers by trust and scaling boundary: keeps modules understandable while preserving clear deployment and security boundaries.
