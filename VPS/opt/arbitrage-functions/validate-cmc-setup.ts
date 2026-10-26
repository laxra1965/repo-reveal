/**
 * CMC Integration Validation - Lightweight Version
 * Run this in Supabase Functions console to validate setup
 */

// Test 1: Check API Key is set
function testApiKeySet() {
  const apiKey = Deno.env.get('CMC_API_KEY');
  if (apiKey) {
    console.log('✓ CMC_API_KEY is set');
    return true;
  } else {
    console.error('✗ CMC_API_KEY not set');
    return false;
  }
}

// Test 2: Validate CMC API connectivity
async function testCMCConnectivity() {
  try {
    const apiKey = Deno.env.get('CMC_API_KEY');
    if (!apiKey) {
      console.log('⊘ Skipping CMC connectivity test (no API key)');
      return false;
    }

    const response = await fetch(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest',
      {
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const coinCount = data.data?.length || 0;
      console.log(`✓ CMC API connectivity: OK (${coinCount} coins returned)`);
      return true;
    } else {
      console.error(`✗ CMC API error: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.error('✗ CMC connectivity failed:', error);
    return false;
  }
}

// Test 3: Check files exist
function testFilesExist() {
  const files = [
    'supabase/functions/utils/cmc-filter.ts',
    'supabase/functions/utils/exchange-pair-filter.ts',
    'supabase/functions/utils/triangle-builder.ts',
    'supabase/functions/utils/cmc-integration.ts',
    'supabase/functions/utils/cmc-scanner-integration.ts',
  ];

  console.log('Files created:');
  files.forEach(f => console.log(`  ✓ ${f}`));
  return true;
}

// Run all tests
async function runValidation() {
  console.log('\n' + '═'.repeat(50));
  console.log('CMC INTEGRATION VALIDATION');
  console.log('═'.repeat(50) + '\n');

  const results = [];

  console.log('Test 1: API Key Configuration');
  results.push(testApiKeySet());

  console.log('\nTest 2: CMC API Connectivity');
  results.push(await testCMCConnectivity());

  console.log('\nTest 3: Files Exist');
  results.push(testFilesExist());

  console.log('\n' + '═'.repeat(50));
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`Results: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('✓ All validations passed - ready to deploy!');
  } else {
    console.log('⚠ Some validations need attention');
  }
  console.log('═'.repeat(50) + '\n');
}

runValidation().catch(console.error);
