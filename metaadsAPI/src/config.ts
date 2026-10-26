import fs from "node:fs";
import path from "node:path";

function readAccessToken(): any {
    const dataDir = path.resolve(process.cwd(), "data");
    console.log(`Reading access token from: ${dataDir}`);
    const tokenPath = path.join(dataDir, "token.json");

    try {
        // 1. Quietly create the directory if it doesn't exist
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // 2. Quietly create empty JSON braces if file doesn't exist
        if (!fs.existsSync(tokenPath)) {
            fs.writeFileSync(tokenPath, JSON.stringify({}, null, 2), "utf8");
            console.warn("Production Warning: data/token.json was missing. Created blank configuration file.");
            return null;
        }

        // 3. Read the file safely without crashing if content is empty or invalid
        const fileContent = fs.readFileSync(tokenPath, "utf8").trim();
        if (!fileContent) {
            return null;
        }

        const tokenData = JSON.parse(fileContent);
        const accessToken = tokenData.access_token;

        if (!accessToken || typeof accessToken !== "string") {
            return null;
        }
        console.log("token loaded:: ", accessToken);
        

        return accessToken;
    } catch (error: any) {
        // Log the error to console for debugging, but return null so the server stays online
        console.error(`Production Error reading token: ${error.message}`);
        return null;
    }
}

export default readAccessToken;
