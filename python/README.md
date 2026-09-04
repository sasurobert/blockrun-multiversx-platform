# multiversx-x402 Python Client SDK

Autonomous AI Agent Client SDK for interacting with MultiversX x402 payment gateways, MCP tool endpoints, and AI scraper tollbooths using ultra-low latency MultiversX micro-payments on Devnet.

**Author**: Robert Sasu <sasu.robert@gmail.com>  
**Target Network**: MultiversX Devnet (`multiversx:D`)  
**Settlement Asset**: `USDC-350c4e`  

## Installation

```bash
pip install multiversx-x402
```

## Quickstart

```python
from multiversx_x402 import setup_x402_wallet

# Initialize agent client from MultiversX wallet PEM
client = setup_x402_wallet(
    pem_path="./wallet.pem",
    gateway_url="http://localhost:3000",
    network="multiversx:D",
    max_cost_per_call=0.05,  # $0.05 safety cap per request
)

# 1. Standard OpenAI-compatible call with automatic 402 micro-payment
response = client.chat(
    model="openai/gpt-5.4",
    messages=[{"role": "user", "content": "Explain sharding in distributed systems"}],
)
print(response["choices"][0]["message"]["content"])
print("Payment receipt tx:", response.get("paymentReceipt"))

# 2. Anthropic-compatible call
response = client.messages(
    model="anthropic/claude-sonnet-4.6",
    messages=[{"role": "user", "content": "Write a concise summary"}],
)

# 3. Smart routing (auto selects model based on complexity and cost)
smart_res = client.smart_chat(
    "What is the capital of France?",
    profile="auto"
)
print("Routed model:", smart_res["routing"]["selectedModel"])
print("Savings:", smart_res["routing"]["estimatedSavings"])
```
