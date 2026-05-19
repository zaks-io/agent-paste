# Restrict Artifact JavaScript Network Access

Uploaded HTML artifacts may run JavaScript, but they will be served from an isolated content origin under a restrictive execution policy that does not allow arbitrary external network access by default. This preserves rich interactive artifacts while reducing the blast radius of untrusted content, especially when artifacts accidentally include sensitive files or data.

## Considered Options

- Disable JavaScript entirely: safest, but too limiting for rich agent-generated demos and explanations.
- Allow arbitrary JavaScript network access: flexible, but makes accidental data exfiltration easier.
- Allow JavaScript with restricted outbound access: supports interactivity while keeping network behavior controlled.
