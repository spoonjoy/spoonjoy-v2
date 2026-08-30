#!/usr/bin/env python3
"""Exercise Spoonjoy MCP with one exact official Python SDK version."""

import asyncio
import json
import os
from importlib.metadata import version


URL = os.environ["SPOONJOY_MCP_URL"]
TOKEN = os.environ["SPOONJOY_MCP_TOKEN"]
EXPECTED_SDK = os.environ["SPOONJOY_MCP_SDK_VERSION"]
EXPECTED_PROTOCOL = os.environ["SPOONJOY_MCP_PROTOCOL_VERSION"]
MODE = os.environ["SPOONJOY_MCP_MODE"]


def assert_tool_result(tools, result):
    names = [tool.name for tool in tools.tools]
    if "get_shopping_list" not in names:
        raise RuntimeError("get_shopping_list is missing from tools/list")
    if getattr(result, "isError", getattr(result, "is_error", False)):
        raise RuntimeError("get_shopping_list returned an MCP tool error")
    if not result.content or result.content[0].type != "text":
        raise RuntimeError("get_shopping_list did not return text content")
    body = json.loads(result.content[0].text)
    if "shoppingList" not in body:
        raise RuntimeError("get_shopping_list omitted shoppingList")
    return len(names)


async def run_legacy():
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    headers = {"Authorization": f"Bearer {TOKEN}"}
    async with streamablehttp_client(URL, headers=headers, terminate_on_close=False) as streams:
        async with ClientSession(streams[0], streams[1]) as session:
            initialize = await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("get_shopping_list", {})
            return initialize.protocolVersion, assert_tool_result(tools, result)


async def run_modern():
    import httpx2
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client

    async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {TOKEN}"}, timeout=30.0) as http_client:
        transport = streamable_http_client(URL, http_client=http_client, terminate_on_close=False)
        async with Client(transport, mode=MODE) as client:
            tools = await client.list_tools()
            result = await client.call_tool("get_shopping_list", {})
            return client.protocol_version, assert_tool_result(tools, result)


async def main():
    installed_sdk = version("mcp")
    if installed_sdk != EXPECTED_SDK:
        raise RuntimeError(f"expected mcp=={EXPECTED_SDK}, installed {installed_sdk}")
    if MODE == "legacy":
        protocol, tool_count = await run_legacy()
    elif MODE == "auto":
        protocol, tool_count = await run_modern()
    else:
        raise RuntimeError(f"unsupported MCP conformance mode: {MODE}")
    if protocol != EXPECTED_PROTOCOL:
        raise RuntimeError(f"expected protocol {EXPECTED_PROTOCOL}, negotiated {protocol}")
    print(json.dumps({
        "sdkVersion": installed_sdk,
        "protocolVersion": protocol,
        "tool": "get_shopping_list",
        "toolCount": tool_count,
        "shoppingList": True,
    }, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(main())
