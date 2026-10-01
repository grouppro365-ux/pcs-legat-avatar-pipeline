"""Single PCS Instagram relay; startup must enforce a native CPU cap."""
from resource_limits import setup_cpu_limit
import argparse
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import json
import logging
import os
from pathlib import Path
import time
from intake import EncryptedStore, IntakeError, read_only_client, utc
from collect_once import collect_snapshot
from bridge import forward_pending, relay_outgoing


def cycle(account, config, reader, sender, stores, transport):
    state = collect_snapshot(account, stores["inbox"].load(), reader)
    stores["inbox"].save(state)
    cutoff = utc(config["outgoing_since"]).timestamp() * 1000
    allowed = config.get("pilot_recipient_ids")
    fresh = dict(state)
    fresh["events"] = [event for event in state["events"]
                       if event["timestamp"] >= cutoff and
                       (allowed is None or event["external_user_id"].split(":")[-1] in allowed)]
    incoming = forward_pending(fresh, config, stores["incoming"], transport, limit=1)
    outgoing = relay_outgoing(config, sender, stores["outbound"], stores["control"], transport)
    return {"incoming": incoming, "outgoing": outgoing}


def create_clients():
    import requests
    from instagrapi import Client

    class Sender(Client):
        def challenge_resolve(self, *args, **kwargs):
            raise IntakeError("instagram_security_check")

    logging.disable(logging.CRITICAL)
    directory = Path(os.environ["LOCALAPPDATA"]) / "PCS" / "instagram-local"
    account = EncryptedStore(directory / "account.dpapi").load()
    config = EncryptedStore(directory / "bridge.dpapi").load()
    if not account or not config or str(config.get("account_id")) != account.get("account_id"):
        raise IntakeError("login_and_bridge_setup_required")
    reader, sender = read_only_client(), Sender()
    for client in (reader, sender):
        client.request_timeout = 10
        client.set_settings(account["session"])
    if str(sender.account_info().pk) != account["account_id"]:
        raise IntakeError("account_mismatch")
    working = {key: account[key] for key in ("version", "account_id", "username")}
    working.update(started_at=config.get("outgoing_since", account["started_at"]), events=[])
    stores = {name: EncryptedStore(directory / filename) for name, filename in
              [("inbox", "worker_inbox.dpapi"), ("incoming", "delivery.dpapi"),
               ("outbound", "outbound.dpapi"), ("control", "outbox_control.dpapi")]}
    return dict(account=working, config=config, reader=reader, sender=sender,
                stores=stores, transport=requests.Session(), directory=directory)


@contextmanager
def lock_file(path):
    import msvcrt
    with open(path, "a+b") as stream:
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            yield
        finally:
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


class CpuLoad:
    def __init__(self):
        self.previous = None

    def percent(self):
        values = [wintypes.FILETIME() for _ in range(3)]
        if not ctypes.windll.kernel32.GetSystemTimes(*(ctypes.byref(item) for item in values)):
            raise RuntimeError("cpu_measurement_unavailable")
        ticks = [item.dwLowDateTime + (item.dwHighDateTime << 32) for item in values]
        previous, self.previous = self.previous, ticks
        if previous is None:
            return 100
        idle, kernel, user = [new - old for new, old in zip(ticks, previous)]
        total = kernel + user
        return 100 * (total - idle) / total if total > 0 else 100


def run(argv=None):
    setup_cpu_limit()
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    runtime = create_clients()
    try:
        if args.probe:
            pilot = runtime["sender"].user_info_by_username_v1("legat_abc_ads")
            return {"account_id": runtime["account"]["account_id"], "pilot_id": str(pilot.pk)}
        if runtime["config"].get("outgoing_enabled") is not True:
            raise IntakeError("outgoing_disabled")
        monitor = CpuLoad()
        with lock_file(runtime["directory"] / "relay.lock"):
            while True:
                if args.once or monitor.percent() < 80:
                    with lock_file(runtime["directory"] / "delivery.lock"):
                        result = cycle(*(runtime[key] for key in
                                         ("account", "config", "reader", "sender", "stores", "transport")))
                    if args.once:
                        return result
                time.sleep(60)
    finally:
        runtime["transport"].close()


if __name__ == "__main__":
    try:
        result = run()
        print(json.dumps(result))
    except Exception:
        print(json.dumps({"ok": False, "error": "instagram_relay_stopped"}))
        raise SystemExit(1)
