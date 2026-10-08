import express from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT) || 5000;

const TOKEN_FILE = path.join(process.cwd(), "data", "google-token.json");

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

// Temporary OAuth state storage.
// Later we'll use Redis/session storage.
const oauthStates = new Set<string>();

app.use(express.json());
express.urlencoded({ extended: true });
// app.use(express.urlencoded)
async function saveTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}) {
  await fs.mkdir(path.dirname(TOKEN_FILE), {
    recursive: true,
  });

  const existing = await loadTokens();

  const updated = {
    ...existing,
    ...tokens,
  };

  await fs.writeFile(TOKEN_FILE, JSON.stringify(updated, null, 2), "utf-8");
}

async function loadTokens(): Promise<{
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}> {
  try {
    const data = await fs.readFile(TOKEN_FILE, "utf-8");

    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function getAccessToken(): Promise<string> {
  const tokens = await loadTokens();

  if (!tokens.refresh_token) {
    throw new Error("No refresh token found. Connect Google Ads first.");
  }

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  client.setCredentials({
    refresh_token: tokens.refresh_token,
  });

  const { token, res: tokenResponse } = await client.getAccessToken();

  if (!token) {
    throw new Error("Unable to generate Google access token");
  }

  /*
    Save the latest access token/expiry time.
    Refresh token remains stored.
  */

  await saveTokens({
    access_token: token,
    expiry_date: tokenResponse?.data?.expiry_date,
  });

  return token;
}

app.get("/", async (_req, res) => {
  const tokens = await loadTokens();

  const connected = Boolean(tokens.refresh_token);

  res.send(`
    <h1>Google Ads API Demo</h1>

    <p>
      Status:
      <strong>
        ${connected ? "Connected ✅" : "Not Connected ❌"}
      </strong>
    </p>

    ${
      connected
        ? `
          <p>Google Ads refresh token is already stored.</p>
          <a href="/google-ads/accounts">
            Get Accessible Google Ads Accounts
          </a>
        `
        : `
          <a href="/auth/google">
            Connect Google Ads
          </a>
        `
    }
  `);
});

app.get("/auth/google", (_req, res) => {
  const state = crypto.randomBytes(32).toString("hex");

  oauthStates.add(state);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [GOOGLE_ADS_SCOPE],
    include_granted_scopes: true,
    prompt: "consent",
    state,
  });

  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;

    if (typeof code !== "string" || typeof state !== "string") {
      return res.status(400).json({
        message: "Invalid OAuth callback",
      });
    }

    if (!oauthStates.has(state)) {
      return res.status(400).json({
        message: "Invalid OAuth state",
      });
    }

    oauthStates.delete(state);

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      return res.status(400).json({
        message: "No access token received",
      });
    }

    /*
      IMPORTANT:

      access_token is temporary.
      refresh_token is what allows us to
      get new access tokens later.
    */

    await saveTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    return res.json({
      message: "Google OAuth successful",
      hasAccessToken: Boolean(tokens.access_token),
      hasRefreshToken: Boolean(tokens.refresh_token),
      saved: true,
    });
  } catch (error) {
    console.error("OAuth error:", error);

    return res.status(500).json({
      message: "OAuth failed",
    });
  }
});

app.get("/google-ads/accounts", async (_req, res) => {
  try {
    const accessToken = await getAccessToken();

    const response = await fetch(
      "https://googleads.googleapis.com/v25/customers:listAccessibleCustomers",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json({
      message: "Google Ads API successful",
      accessibleCustomers: data,
    });
  } catch (error) {
    console.error("Google Ads error:", error);

    return res.status(500).json({
      message: error instanceof Error ? error.message : "Google Ads API failed",
    });
  }
});

app.get("/google-ads/campaigns", async (_req, res) => {
  try {
    const accessToken = await getAccessToken();
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

    if (!customerId) {
      return res.status(400).json({
        message: "GOOGLE_ADS_CUSTOMER_ID is missing",
      });
    }

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.campaign_budget
      FROM campaign
      ORDER BY campaign.id
    `;

    const response = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          query,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json({
      capaigns: data,
    });
  } catch (error) {
    console.error("Google Ads error:", error);

    return res.status(500).json({
      message: error instanceof Error ? error.message : "Google Ads API failed",
    });
  }
});

app.get("/google-ads/campaigns/report", async (_req, res) => {
  try {
    const accessToken = await getAccessToken();
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

    if (!customerId) {
      return res.status(400).json({
        message: "GOOGLE_ADS_CUSTOMER_ID is missing",
      });
    }

    const query = `
       SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    segments.date,
    metrics.impressions,
    metrics.clicks,
    metrics.ctr,
    metrics.average_cpc,
    metrics.cost_micros,
    metrics.conversions
  FROM campaign
  WHERE segments.date DURING LAST_30_DAYS
  ORDER BY metrics.cost_micros DESC
    `;

    const response = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          query,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const campaigns = (data.results ?? []).map((row: any) => ({
      id: row.campaign?.id,
      name: row.campaign?.name,
      status: row.campaign?.status,

      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
      ctr: Number(row.metrics?.ctr ?? 0),

      averageCpc: Number(row.metrics?.averageCpc ?? 0) / 1_000_000,

      cost: Number(row.metrics?.costMicros ?? 0) / 1_000_000,

      conversions: Number(row.metrics?.conversions ?? 0),
    }));

    return res.json({
      customerId,
      dateRange: "LAST_30_DAYS",
      campaigns,
    });
  } catch (error) {
    console.error("Google Ads error:", error);

    return res.status(500).json({
      message: error instanceof Error ? error.message : "Google Ads API failed",
    });
  }
});

// Update the status of campaign with mutation and validate only
app.post("/google-ads/campaigns/campaign", async (req, res) => {
  try {
    const allowedStatuses = ["ENABLED", "PAUSED", "REMOVED"];
    const { campaignId, status } = req.body;
    console.log("bpody request: ", campaignId, status);
    if (
      typeof status !== "string" ||
      !allowedStatuses.includes(status.toUpperCase())
    ) {
      return res.status(400).json({
        message: "Invalid campaign status",
        allowedStatuses,
      });
    }
    const accessToken = await getAccessToken();

    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

    if (!customerId) {
      return res.status(400).json({
        message: "Missing GOOGLE_ADS_CUSTOMER_ID",
      });
    }

    if (!campaignId) {
      return res.status(400).json({
        message: "Missing campaignId",
      });
    }

    // Default to safe validation mode.
    const validateOnly = req.body?.validateOnly ?? true;

    const newStatus = status.toUpperCase();

    const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;

    const response = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        },

        body: JSON.stringify({
          operations: [
            {
              updateMask: "status",
              update: {
                resourceName: campaignResourceName,
                status: newStatus,
              },
            },
          ],

          validateOnly,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Google Ads pause error:", JSON.stringify(data, null, 2));

      return res.status(response.status).json(data);
    }

    return res.json({
      message: validateOnly
        ? `${newStatus} request is valid. Campaign was NOT changed.`
        : `Campaign status changed to ${newStatus} successfully`,

      validateOnly,
      customerId,
      campaignId,
      campaignResourceName,
      googleResponse: data,
    });
  } catch (error) {
    console.error("Pause campaign error:", error);

    return res.status(500).json({
      message:
        error instanceof Error ? error.message : "Failed to pause campaign",
    });
  }
});

app.post("/google-ads/campaigns/rename", async (req, res) => {
  try {
    const { campaignId, name, validateOnly = true } = req.body;

    if (!campaignId) {
      return res.status(400).json({
        message: "Missing campaignId",
      });
    }

    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        message: "A valid campaign name is required",
      });
    }

    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

    if (!customerId) {
      return res.status(400).json({
        message: "Missing GOOGLE_ADS_CUSTOMER_ID",
      });
    }

    const accessToken = await getAccessToken();

    const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

    const response = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [
            {
              updateMask: "name",
              update: {
                resourceName,
                name: name.trim(),
              },
            },
          ],
          validateOnly,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Rename campaign error:", JSON.stringify(data, null, 2));

      return res.status(response.status).json(data);
    }

    return res.json({
      message: validateOnly
        ? "Rename is valid. Campaign was NOT changed."
        : "Campaign renamed successfully.",
      validateOnly,
      campaignId,
      newName: name.trim(),
      googleResponse: data,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message:
        error instanceof Error ? error.message : "Failed to rename campaign",
    });
  }
});

app.post("/google-ads/budgets/create", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

    if (!customerId) {
      return res.status(400).json({
        message: "Missing GOOGLE_ADS_CUSTOMER_ID",
      });
    }

    const {
      name = `SaaS Test Budget ${Date.now()}`,
      amount = 500,
      validateOnly = true,
    } = req.body;

    if (amount <= 0) {
      return res.status(400).json({
        message: "Budget amount must be greater than 0",
      });
    }

    // Google Ads uses micros for monetary values.
    const amountMicros = String(Math.round(amount * 1_000_000));

    const response = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/campaignBudgets:mutate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [
            {
              create: {
                name,
                amountMicros,
                deliveryMethod: "STANDARD",
              },
            },
          ],
          validateOnly,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Create budget error:", JSON.stringify(data, null, 2));

      return res.status(response.status).json(data);
    }

    return res.json({
      message: validateOnly
        ? "Budget request is valid. Budget was NOT created."
        : "Budget created successfully.",
      validateOnly,
      amount,
      amountMicros,
      googleResponse: data,
    });
  } catch (error) {
    console.error("Create budget error:", error);

    return res.status(500).json({
      message:
        error instanceof Error ? error.message : "Failed to create budget",
    });
  }
});

app.post("/google-ads/campaigns/create", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

    if (!customerId) {
      return res.status(400).json({
        message: "Missing GOOGLE_ADS_CUSTOMER_ID",
      });
    }

    const {
      name = `SaaS Test Campaign ${Date.now()}`,
      budgetResourceName,
      validateOnly = true,
    } = req.body;

    if (!budgetResourceName) {
      return res.status(400).json({
        message: "Missing budgetResourceName. Create a budget first.",
      });
    }

    const response = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [
            {
              create: {
                name,

                // Search campaign
                advertisingChannelType: "SEARCH",

                // Safety: create paused.
                status: "PAUSED",

                // Manual CPC bidding
                manualCpc: {},

                // Attach previously-created budget
                campaignBudget: budgetResourceName,

                // Basic Search network configuration
                networkSettings: {
                  targetGoogleSearch: true,
                  targetSearchNetwork: true,
                  targetContentNetwork: false,
                  targetPartnerSearchNetwork: false,
                },

                // Required declaration
                containsEuPoliticalAdvertising:
                  "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
              },
            },
          ],
          validateOnly,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Create campaign error:", JSON.stringify(data, null, 2));

      return res.status(response.status).json(data);
    }

    return res.json({
      message: validateOnly
        ? "Campaign request is valid. Campaign was NOT created."
        : "Campaign created successfully.",
      validateOnly,
      campaignName: name,
      budgetResourceName,
      googleResponse: data,
    });
  } catch (error) {
    console.error("Create campaign error:", error);

    return res.status(500).json({
      message:
        error instanceof Error ? error.message : "Failed to create campaign",
    });
  }
});
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
