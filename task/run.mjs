import { runTask } from "./main.mjs";

// The agent runs `node run.mjs`. No entry guard: comparing import.meta.url with the script path
// fails when the agent's folder sits behind a symlink, and the step would pass having run nothing.
runTask({ env: process.env, platform: process.platform, stdout: console.log });
