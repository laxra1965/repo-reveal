import scanner from './index.ts';

async function run() {
  try {
    // Call the function as an HTTP GET request
    const req = new Request('http://localhost/arbitrage-scan', { method: 'GET' });
    const res = await scanner(req as Request);
    const text = await res.text();
    console.log('Scanner response:');
    console.log(text);
  } catch (err) {
    console.error('Error running scanner test:', err);
    Deno.exit(1);
  }
}

run();
