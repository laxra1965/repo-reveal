# Architecture rules
- Browser scanning uses public market feeds and an authenticated, validated database RPC to publish shared signals; never expose service credentials to the browser.
- Trade timelines render only persisted execution evidence, distinguishing simulations and missing fills from real exchange executions.