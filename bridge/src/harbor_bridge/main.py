"""Harbor Bridge main entry point.

This module runs the native messaging bridge that communicates with
the Harbor Firefox extension.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import Any, Dict

from harbor_bridge import __version__
from harbor_bridge.handlers import dispatch_message
from harbor_bridge.native_messaging import (
    InvalidMessageError,
    MessageTooLargeError,
    NativeMessagingError,
    read_message,
    write_message,
)
from harbor_bridge.server_store import ServerStore


# Configure logging to stderr (stdout is used for native messaging)
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("harbor_bridge")


def get_data_dir() -> Path:
    """Get the data directory for persistent storage."""
    # Use a .data directory relative to the bridge package
    bridge_dir = Path(__file__).parent.parent.parent.parent
    return bridge_dir / ".data"


async def run_bridge() -> None:
    """Run the main bridge loop."""
    logger.info(f"Harbor Bridge v{__version__} starting...")

    # Initialize server store
    data_dir = get_data_dir()
    logger.info(f"Data directory: {data_dir}")
    store = ServerStore(data_dir=data_dir)

    while True:
        try:
            message = await read_message()

            if message is None:
                logger.info("EOF received, shutting down")
                break

            logger.debug(
                f"Received: type={message.get('type')}, request_id={message.get('request_id')}"
            )

            response = await dispatch_message(message, store)
            await write_message(response)

            logger.debug(f"Sent: type={response.get('type')}")

        except MessageTooLargeError as e:
            logger.error(f"Message too large: {e}")
            try:
                await write_message(
                    {
                        "type": "error",
                        "request_id": "",
                        "error": {
                            "code": "message_too_large",
                            "message": str(e),
                        },
                    }
                )
            except Exception:
                pass

        except InvalidMessageError as e:
            logger.error(f"Invalid message: {e}")
            try:
                await write_message(
                    {
                        "type": "error",
                        "request_id": "",
                        "error": {
                            "code": "invalid_message",
                            "message": str(e),
                        },
                    }
                )
            except Exception:
                pass

        except NativeMessagingError as e:
            logger.error(f"Native messaging error: {e}")
            break

        except Exception as e:
            logger.exception(f"Unexpected error: {e}")
            break

    logger.info("Harbor Bridge shutting down")


def main() -> None:
    """Entry point for the bridge."""
    try:
        asyncio.run(run_bridge())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
