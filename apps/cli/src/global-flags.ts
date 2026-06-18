/** Output-shaping flags every command honors. Lives in its own dependency-free
 * leaf so utility modules (e.g. update-check) can type against it without
 * importing the entrypoint, which would close an import cycle. */
export type GlobalFlags = {
  json: boolean;
  quiet: boolean;
  color?: boolean | undefined;
};
