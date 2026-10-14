import express from "express";
import { getAccessToken } from "../google_config.js";
const router = express.Router();

// campaign Budget Management service API
router.get("/google-ads/budgets", async (_req, res) => {
	try {
		const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

		if (!customerId) {
			return res.status(400).json({
				message: "Missing GOOGLE_ADS_CUSTOMER_ID",
			});
		}

		// Reuse the saved refresh token to obtain an access token.
		const accessToken = await getAccessToken();

		const query = `
      SELECT
        customer.currency_code,
        campaign_budget.id,
        campaign_budget.name,
        campaign_budget.resource_name,
        campaign_budget.amount_micros,
        campaign_budget.total_amount_micros,
        campaign_budget.period,
        campaign_budget.delivery_method,
        campaign_budget.explicitly_shared,
        campaign_budget.reference_count,
        campaign_budget.status
      FROM campaign_budget
      ORDER BY campaign_budget.id
    `;

		const response = await fetch(
			`https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query }),
			},
		);

		const data = await response.json();

		if (!response.ok) {
			console.error(
				"Google Ads budget query failed:",
				JSON.stringify(data, null, 2),
			);

			return res.status(response.status).json(data);
		}

		const budgets = (data.results ?? []).map((row: any) => {
			const budget = row.campaignBudget;
			console.log(row);

			const amountMicros =
				budget.amountMicros == null ? null : Number(budget.amountMicros);

			const totalAmountMicros =
				budget.totalAmountMicros == null
					? null
					: Number(budget.totalAmountMicros);

			return {
				id: budget.id,
				name: budget.name,
				resourceName: budget.resourceName,
				period: budget.period,
				currency_code: row.customer.currencyCode,
				amountMicros: budget.amountMicros,
				dailyAmount:
					budget.period === "DAILY" && amountMicros !== null
						? amountMicros / 1_000_000
						: null,

				totalAmountMicros: budget.totalAmountMicros,
				totalAmount:
					budget.period === "CUSTOM_PERIOD" && totalAmountMicros !== null
						? totalAmountMicros / 1_000_000
						: null,

				deliveryMethod: budget.deliveryMethod,
				explicitlyShared: budget.explicitlyShared,
				referenceCount: budget.referenceCount,
				status: budget.status,
			};
		});

		return res.json({
			message: "Budgets retrieved successfully",
			customerId,
			count: budgets.length,
			budgets,
		});
	} catch (error) {
		console.error("Get budgets error:", error);

		return res.status(500).json({
			message:
				error instanceof Error ? error.message : "Failed to retrieve budgets",
		});
	}
});

router.post("/google-ads/budgets/create", async (req, res) => {
	try {
		const accessToken = await getAccessToken();

		const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
		if (!customerId) {
			return res.status(400).json({
				message: "Missing GOOGLE_ADS_CUSTOMER_ID",
			});
		}

		const { name, amount, validateOnly = true } = req.body;

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

router.post("/google-ads/budgets/update", async (req, res) => {
	try {
		const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

		if (!customerId) {
			return res.status(400).json({
				message: "Missing GOOGLE_ADS_CUSTOMER_ID",
			});
		}

		const { budgetId, amount, name } = req.body;

		const update: Record<string, string> = {};
		const updateFields: string[] = [];

		// Validation-only is the default.
		// A real update requires an explicit JSON boolean false.
		const validateOnly = req.body?.validateOnly !== false;

		if (typeof budgetId !== "string") {
			return res.status(400).json({
				message: "A valid budgetId is required",
			});
		}

		if (amount !== undefined) {
			if (
				typeof amount !== "number" ||
				!Number.isFinite(amount) ||
				amount <= 0
			) {
				return res.status(400).json({
					message: "amount must be a positive number",
				});
			}
			update.amountMicros = String(Math.round(amount * 1_000_000));

			updateFields.push("amountMicros");
		}

		if (name !== undefined) {
			update.name = name.trim();
			updateFields.push("name");
		}

		if (updateFields.length === 0) {
			return res.status(400).json({
				message: "Provide amount, name, or both",
			});
		}

		const accessToken = await getAccessToken();

		// Convert currency units to micros.
		const amountMicros = String(Math.round(amount * 1_000_000));

		const budgetResourceName = `customers/${customerId}/campaignBudgets/${budgetId}`;

		const response = await fetch(
			`https://googleads.googleapis.com/v25/customers/${customerId}/campaignBudgets:mutate`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					operations: [
						{
							update: {
								resourceName: budgetResourceName,
								...update,
							},
							updateMask: updateFields.join(","),
						},
					],
					validateOnly,
				}),
			},
		);

		const data = await response.json();

		if (!response.ok) {
			console.error("Budget update error:", JSON.stringify(data, null, 2));

			return res.status(response.status).json(data);
		}

		return res.json({
			message: validateOnly
				? "Budget update validated. No changes were applied."
				: "Budget update completed.",
			validateOnly,
			customerId,
			budgetId,
			budgetResourceName,
			requestedAmount: amount,
			amountMicros,
			currencyCode: "INR",
			googleResponse: data,
		});
	} catch (error) {
		console.error("Budget update error:", error);

		return res.status(500).json({
			message:
				error instanceof Error ? error.message : "Failed to update budget",
		});
	}
});

router.get("/google-ads/campaign-budget-assignments", async (_req, res) => {
	try {
		const customerId =
			process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

		if (!customerId) {
			return res.status(400).json({
				message: "Missing GOOGLE_ADS_CUSTOMER_ID",
			});
		}

		const accessToken = await getAccessToken();

		const query = `
	SELECT
		campaign.id,
		campaign.name,
		campaign.status,
		campaign.campaign_budget,
		campaign_budget.id,
		campaign_budget.name,
		campaign_budget.amount_micros,
		campaign_budget.explicitly_shared,
		campaign_budget.reference_count
	FROM campaign
	ORDER BY campaign.name
	`;

		const response = await fetch(
			`https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query }),
			}
		);

		const data = await response.json();

		if (!response.ok) {
			return res.status(response.status).json(data);
		}

		const assignments = (data.results ?? []).map(
			(row: any) => ({
				campaignId: row.campaign.id,
				campaignName: row.campaign.name,
				campaignStatus: row.campaign.status,

				budgetResourceName:
					row.campaign.campaignBudget,

				budgetId: row.campaignBudget.id,
				budgetName: row.campaignBudget.name,
				amountMicros:
					row.campaignBudget.amountMicros,

				explicitlyShared:
					row.campaignBudget.explicitlyShared,

				referenceCount:
					row.campaignBudget.referenceCount,
			})
		);

		return res.json({
			customerId,
			count: assignments.length,
			assignments,
		});
	} catch (error) {
		console.error("Budget assignment error:", error);

		return res.status(500).json({
			message:
				error instanceof Error
					? error.message
					: "Failed to retrieve budget assignments",
		});
	}
});

router.post("/google-ads/campaigns/assign-budget", async (req, res) => {
	try {
		const customerId =
			process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

		if (!customerId) {
			return res.status(400).json({
				message: "Missing GOOGLE_ADS_CUSTOMER_ID",
			});
		}

		const { campaignId, budgetId } = req.body ?? {};

		if (
			typeof campaignId !== "string" ||
			!/^\d+$/.test(campaignId)
		) {
			return res.status(400).json({
				message: "A valid campaignId is required",
			});
		}

		if (
			typeof budgetId !== "string" ||
			!/^\d+$/.test(budgetId)
		) {
			return res.status(400).json({
				message: "A valid budgetId is required",
			});
		}

		const accessToken = await getAccessToken();

		// Build both resource names from the configured customer ID.
		const campaignResourceName =
			`customers/${customerId}/campaigns/${campaignId}`;

		const budgetResourceName =
			`customers/${customerId}/campaignBudgets/${budgetId}`;

		// SAFETY: Keep validation enabled for this first exercise.
		// This endpoint will NOT reassign the live budget.
		const validateOnly = true;

		const response = await fetch(
			`https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					operations: [
						{
							updateMask: "campaignBudget",
							update: {
								resourceName: campaignResourceName,
								campaignBudget: budgetResourceName,
							},
						},
					],
					validateOnly,
				}),
			}
		);

		const data = await response.json();

		if (!response.ok) {
			console.error(
				"Assign budget error:",
				JSON.stringify(data, null, 2)
			);

			return res.status(response.status).json(data);
		}

		return res.json({
			message:
				"Budget assignment validated. No changes were applied.",
			validateOnly,
			customerId,
			campaignId,
			campaignResourceName,
			budgetId,
			budgetResourceName,
			googleResponse: data,
		});
	} catch (error) {
		console.error("Assign budget error:", error);

		return res.status(500).json({
			message:
				error instanceof Error
					? error.message
					: "Failed to validate budget assignment",
		});
	}
});

router.post("/google-ads/budgets/remove", async (req, res) => {
	try {
		const customerId =
			process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

		if (!customerId) {
			return res.status(400).json({
				message: "Missing GOOGLE_ADS_CUSTOMER_ID",
			});
		}

		const { budgetId, confirmBudgetName } = req.body ?? {};

		// Default to safe validation mode.
		const validateOnly = req.body?.validateOnly !== false;

		if (
			typeof budgetId !== "string" ||
			!/^\d+$/.test(budgetId)
		) {
			return res.status(400).json({
				message: "A valid budgetId is required",
			});
		}

		const accessToken = await getAccessToken();

		// 1. Read the budget before attempting removal.
		const query = `
      SELECT
        campaign_budget.id,
        campaign_budget.name,
        campaign_budget.resource_name,
        campaign_budget.reference_count,
        campaign_budget.explicitly_shared
      FROM campaign_budget
      WHERE campaign_budget.id = ${budgetId}
    `;

		const readResponse = await fetch(
			`https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query }),
			}
		);

		const readData = await readResponse.json();

		if (!readResponse.ok) {
			return res.status(readResponse.status).json(readData);
		}

		const budget = readData.results?.[0]?.campaignBudget;

		if (!budget) {
			return res.status(404).json({
				message: "Budget not found",
				budgetId,
			});
		}

		const referenceCount = Number(budget.referenceCount);

		if (!Number.isFinite(referenceCount)) {
			return res.status(500).json({
				message: "Could not verify budget reference count",
			});
		}

		// 2. Never remove a budget that is still being used.
		if (referenceCount !== 0) {
			return res.status(409).json({
				message: "Budget is still in use and cannot be removed",
				budgetId,
				budgetName: budget.name,
				referenceCount,
			});
		}

		// 3. Require an exact name confirmation for real deletion.
		if (
			!validateOnly &&
			confirmBudgetName !== budget.name
		) {
			return res.status(400).json({
				message:
					"To remove this budget, provide its exact name in confirmBudgetName",
			});
		}

		// 4. Remove by resourceName.
		const removeResponse = await fetch(
			`https://googleads.googleapis.com/v25/customers/${customerId}/campaignBudgets:mutate`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					operations: [
						{
							remove: budget.resourceName,
						},
					],
					validateOnly,
				}),
			}
		);

		const removeData = await removeResponse.json();

		if (!removeResponse.ok) {
			return res.status(removeResponse.status).json(removeData);
		}

		return res.json({
			message: validateOnly
				? "Removal validated. Budget was NOT removed."
				: "Budget removed successfully.",
			validateOnly,
			budgetId,
			budgetName: budget.name,
			budgetResourceName: budget.resourceName,
			referenceCount,
			googleResponse: removeData,
		});
	} catch (error) {
		console.error("Remove budget error:", error);

		return res.status(500).json({
			message:
				error instanceof Error
					? error.message
					: "Failed to remove budget",
		});
	}
});

export default router;