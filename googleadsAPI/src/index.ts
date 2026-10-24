
import express, { type NextFunction, type Request, type Response } from "express";
import "dotenv/config";

import accountRouter from "./routes/account.routes.js";
import budgetRouter from "../src/routes/budget.routes.js";
import campaignRouter from "../src/routes/campaign.routes.js";
import biddingRouter from "./routes/bidding.routes.js";
import adsGroupRouter from "../src/routes/adsGroup.routes.js";
import assetsRouter from './routes/assets.routes.js'
import searchTermRouter from './routes/searchTermNegativeKeywordReport.js';
import conversionRouter from './routes/conversionReport.routes.js';
import adRetrievalRouter from "./routes/adRetrieval.routes.js";
import { loadTokens } from "./google_config.js";



const app = express();
app.disable("x-powered-by");
const PORT = Number(process.env.PORT) || 5000;


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger documentation

// Google Ads routes
app.use("/google-ads", biddingRouter);
app.use("/google-ads", adsGroupRouter);
app.use('/google-ads', assetsRouter);
app.use("/google-ads", adRetrievalRouter);

// Application routes
app.use(accountRouter);
app.use(campaignRouter);
app.use(budgetRouter);
app.use(searchTermRouter)
app.use(conversionRouter)

// Home route
app.get("/", async (_req, res) => {
  try {
    const tokens = await loadTokens();
    const connected = Boolean(tokens?.refresh_token);

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Google Ads API Demo</title>
        </head>
        <body>
          <h1>Google Ads API Demo</h1>

          <p>
            Status:
            <strong>
              ${connected ? "Connected ✅" : "Not Connected ❌"}
            </strong>
          </p>

          ${connected
        ? `
                <p>Google Ads refresh token is already stored.</p>
                <a href="/accounts">
                  Get Accessible Google Ads Accounts
                </a>
              `
        : `
                <a href="/auth/google">
                  Connect Google Ads 
                </a>
              `
      }
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error loading Google Ads tokens:", error);

    res.status(500).send("Unable to check Google Ads connection status.");
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Unknown routes
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found." });
});

// Last-resort error handler: never leak internals to the client.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", error);

  if (res.headersSent) return;

  res.status(500).json({ message: "An unexpected error occurred." });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
