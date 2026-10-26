import "dotenv/config";
import express from "express";
import session from "express-session";
import readAccessToken from "./config.js";


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
import adsRouter from "./routes/ad.routes.js";

const app = express();
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
 ${accessToken ? `<h1>Meta Ads Sample</h1>
   <p>Access token is available.</p>
    <a href="/auth/meta">Connect Meta Ads</a></p>` : `<h1>Meta Ads Sample</h1>
   <p>Access token is missing.<p>OAuth login test — no campaigns will be changed.</p>
    <a href="/auth/meta">Connect Meta Ads</a></p>`}
    
  `);
});
app.get('/privacy', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Privacy Policy - Meta Ads API App</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
          h1 { color: #1877f2; }
        </style>
      </head>
      <body>
        <h1>Privacy Policy</h1>
        <p>Last updated: October 26, 2026</p>
        <p>At api_learning, accessible from https://meta-marketing-api.onrender.com, we respect your privacy and are committed to protecting any information you share with us.</p>
        
        <h2>1. Information We Collect</h2>
        <p>Our application interacts with the Meta Ads API solely to manage campaigns, ad sets, ads, and ad creatives as authorized by you.</p>
        
        <h2>2. How We Use Information</h2>
        <p>The data accessed via the Meta API is used exclusively to facilitate advertising management features within your application dashboard. We do not sell, rent, or share your data with third parties.</p>
        
        <h2>3. Data Security</h2>
        <p>We implement standard security measures to protect your information against unauthorized access or disclosure.</p>
        
        <h2>4. Contact Us</h2>
        <p>If you have any questions about this Privacy Policy, you can contact us at your email.</p>
      </body>
    </html>
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
app.use(adsRouter);
app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
