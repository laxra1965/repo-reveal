# Architecture rules
- Browser scanning uses public market feeds and an authenticated, validated database RPC to publish shared signals; never expose service credentials to the browser.
- Trade timelines render only persisted execution evidence, distinguishing simulations and missing fills from real exchange executions.
- The uploaded Deno VPS server is the deployment entrypoint; its authenticated DB queue worker is the only automatic live execution path, preventing competing consumers.
- VPS credentials use the existing AES-GCM IV:ciphertext format and are decrypted only on the VPS; browser verification passes credential IDs, not decrypted secrets.
- A submitted order with uncertain fills remains executing for manual reconciliation and is never automatically replayed.
