const ACCESS_TOKEN = '';
const API_VERSION = 'v25.0';

async function getMyPageIDs() {
    // Querying /me/accounts fetches all pages you have a role on
    const url = `https://facebook.com/${API_VERSION}/me/accounts?fields=name,id,tasks&access_token=${ACCESS_TOKEN}`;

    try {
        const response = await fetch(url);
         if (!response.ok) {
      const rawText = await response.text();
      console.error(`❌ Server returned HTTP ${response.status}`);
      console.error(`📄 Raw Response Content: "${rawText}"`);
      return;
    }

    // If it's a valid 200 response, we can safely parse the JSON
    const result = await response.json();

    console.log('📋 Your Managed Facebook Pages:');
    result.data.forEach(page => {
      console.log(`- 🏷️  Name: ${page.name}`);
      console.log(`  🆔 Page ID: ${page.id}`);
      console.log(`  🛠️ Permitted Tasks: ${page.tasks.join(', ')}\n`);
    });
        

    } catch (error) {
        console.error('Network error:', error);
    }
}

getMyPageIDs().then(res => console.log('✅ Finished fetching pages.')).catch(err => console.error('❌ Error in getMyPageIDs:', err))
    ;
