"""
MultiversX x402 Python Client SDK
Author: Robert Sasu <sasu.robert@gmail.com>
"""

from blockrun_mvx.client import BlockRunMvxClient, setup_agent_wallet
from blockrun_mvx.signer import UserSigner
from blockrun_mvx.errors import BlockRunError, PaymentError, SpendLimitError, APIError

# Idiomatic aliases
MultiversxX402Client = BlockRunMvxClient
setup_x402_wallet = setup_agent_wallet
X402Error = BlockRunError

__all__ = [
    "MultiversxX402Client",
    "BlockRunMvxClient",
    "setup_x402_wallet",
    "setup_agent_wallet",
    "UserSigner",
    "X402Error",
    "BlockRunError",
    "PaymentError",
    "SpendLimitError",
    "APIError",
]
__version__ = "1.0.0"
