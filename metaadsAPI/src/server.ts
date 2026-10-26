import "dotenv/config";
import express from "express";
import session from "express-session";
import fs from "node:fs";
import path from "node:path";
const app = express();
function readAccessToken(): string {
    const dataDir = path.resolve(process.cwd(), "data");
    const tokenPath = path.join(dataDir, "token.json");

    // 1. Create the 'data' directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // 2. Create a default 'token.json' template if it doesn't exist
    if (!fs.existsSync(tokenPath)) {
        const defaultTemplate = { access_token: "" };
        fs.writeFileSync(tokenPath, JSON.stringify(defaultTemplate, null, 2), "utf8");
        throw new Error("data/token.json was missing. Created template file. Please populate your 'access_token' value inside it.");
    }

    // 3. Attempt to read and parse the existing file safely
    try {
        const fileContent = fs.readFileSync(tokenPath, "utf8").trim();

        if (!fileContent) {
            throw new Error("File is empty");
        }

        const tokenData = JSON.parse(fileContent);
        const accessToken = tokenData.access_token;

        if (!accessToken || typeof accessToken !== "string") {
            throw new Error("Access token string is empty or missing property");
        }

        return accessToken;
    } catch (error: any) {
        throw new Error(`Invalid data/token.json setup: ${error.message}. Ensure it contains: {"access_token": "YOUR_TOKEN"}`);
    }
}


import authRoutes from "./routes/auth.routes.js";
import metaRoutes from "./routes/meta.routes.js";
import campaignRoutes from "./routes/campaign.routes.js";
import adSetRoutes from "./routes/adset.routes.js";
import biddingRoutes from "./routes/bidding.routes.js";
import performanceGoalRoutes from "./routes/performance-goal.routes.js";
import billingEventRoutes from "./routes/billing-event.routes.js";
import adsetConfigurationRoutes from "./routes/adset-configuration.routes.js";
import adImagesRouter from "./routes/adimages.routes.js";

import adCreativesRouter from "./routes/adcreatives.routes.js";
import videoUploadRoutes from "./routes/video-upload.routes.js";

const {
    PORT = "3000",
    SESSION_SECRET,
    META_APP_ID,
    META_APP_SECRET,
    META_LOGIN_CONFIG_ID,
    META_REDIRECT_URI,
} = process.env;

if (
    !SESSION_SECRET ||
    !META_APP_ID ||
    !META_APP_SECRET ||
    !META_LOGIN_CONFIG_ID ||
    !META_REDIRECT_URI
) {
    throw new Error("Missing required settings in .env");
}

app.use(express.json());

// For local development only. Use a persistent session store in production.
app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: false, // Local HTTP only; enable HTTPS-secure cookies in production.
            maxAge: 60 * 60 * 1000,
        },
    }),
);

app.get("/", async (_req, res) => {
    const accessToken = await readAccessToken();


    res.send(`
    <h1>Meta Ads Sample</h1>
   <p>Access token is missing.<p>OAuth login test — no campaigns will be changed.</p>
    <a href="/auth/meta">Connect Meta Ads</a></p>

    
  `);
});

// Keep route handlers and their business logic in the routes folder.
app.use(authRoutes);
app.use(metaRoutes);
app.use(campaignRoutes);
app.use(adSetRoutes);
app.use(biddingRoutes);
app.use(performanceGoalRoutes);
app.use(billingEventRoutes);
app.use(adsetConfigurationRoutes);
app.use(adImagesRouter);
app.use(adCreativesRouter);
app.use(videoUploadRoutes);

app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
