"""XRPL boundary: read-only Devnet access; signing belongs in a later milestone."""

from xrpl.clients import JsonRpcClient
from xrpl.models.requests import ServerInfo


def fetch_server_info(url):
    response = JsonRpcClient(url).request(ServerInfo())
    if not response.is_successful():
        raise RuntimeError("XRPL server returned an unsuccessful response")
    info = response.result.get("info", {})
    return {
        "server_state": info.get("server_state"),
        "validated_ledger": info.get("validated_ledger", {}).get("seq"),
    }
