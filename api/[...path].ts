// The reusable Express application is exported by server/app.ts.  Vercel's
// Node.js function runtime accepts an Express request handler as its default
// export, so no listen() call belongs in this entrypoint.
import app from "../server/app.js";

export default app;
