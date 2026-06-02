// Client-safe Turnstile constants. Kept out of src/server/ so client components can
// import them without dragging a (mocked) server module into the client bundle.
export const LOCAL_TURNSTILE_BYPASS_TOKEN = "local-turnstile-bypass";
