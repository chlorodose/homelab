"""SSD volume policy and one-volume migration for the homelab topology."""

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.request import urlopen

import grpc
import volume_pb2
import volume_pb2_grpc

SSD = "seaweed-volume-ssd-0.seaweed-volume-ssd-peer.database"
HDDS = tuple(f"seaweed-volume-hddr-{i}.seaweed-volume-hddr-peer.database" for i in range(4))
# The existing local HDD PVs pin 0/2 to worker1 and 1/3 to worker2.
HDD_GROUPS = (HDDS[::2], HDDS[1::2])
MASTER = "seaweed-master.database:9333"
FILER = "seaweed-filer.database:8888"
STATE = Path("/state/tiering.json")
APPLY = os.environ.get("SEAWEED_TIER_APPLY") == "true"
GIB = 1024**3


@dataclass(frozen=True)
class Policy:
    regular_usage_percent: int = 40
    quiet_days: int = 7
    volume_fill_percent: int = 85
    emergency_usage_percent: int = 85
    emergency_stop_percent: int = 60


def read_json(url):
    with urlopen(url, timeout=5) as response:
        return json.load(response)


def status(host):
    info = read_json(f"http://{host}:8444/status")
    disks = info["DiskStatuses"]
    expected = "ssd" if host == SSD else "hdd"
    if len(disks) != 1 or disks[0]["dir"].rstrip("/") != "/data0":
        raise RuntimeError(f"{host} must have exactly one /data0 disk")
    disk = disks[0]
    if (disk.get("disk_type") or "hdd") != expected:
        raise RuntimeError(f"{host} has an unexpected disk type")
    return disk, {volume["Id"]: volume for volume in info["Volumes"] or []}


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"emergency": False, "pending": None}


def persist(state):
    temporary = STATE.with_suffix(".tmp")
    with temporary.open("w") as handle:
        json.dump(state, handle)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(STATE)
    directory = os.open(STATE.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def weed_shell(*commands):
    shell = subprocess.run(
        ["/runtime/weed", "shell", f"-master={MASTER}", f"-filer={FILER}"],
        text=True, input="\n".join(commands) + "\n",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=105,
    )
    print(shell.stdout.strip(), flush=True)
    if shell.returncode or re.search(r"(?m)^error:", shell.stdout):
        raise RuntimeError("SeaweedFS shell command failed; inspect worker logs")


def volume_limit():
    result = subprocess.run(
        ["/runtime/weed", "shell", f"-master={MASTER}", f"-filer={FILER}"],
        input="volume.list\n", capture_output=True, text=True, timeout=15, check=True,
    )
    match = re.search(r"volumeSizeLimit:(\d+) MB", result.stdout)
    if not match:
        raise RuntimeError("could not determine logical volume size limit")
    return int(match[1]) * 1024**2


def select(volumes, emergency, now, limit, policy):
    return sorted(
        (v for v in volumes.values()
         if v["DiskType"] == "ssd" and not v["RemoteStorageName"]
         and v["ReplicaPlacement"] == {} and 0 < v["ModifiedAtSecond"] <= now
         and (emergency or (now - v["ModifiedAtSecond"] > policy.quiet_days * 86400
                            and 100 * v["Size"] > policy.volume_fill_percent * limit))),
        key=lambda volume: (volume["ModifiedAtSecond"], volume["Id"]),
    )


def inspect(state, limit, policy):
    disk, volumes = status(SSD)
    used = disk["percent_used"]
    if used > policy.emergency_usage_percent and not state["emergency"]:
        state["emergency"] = True
        persist(state)
    if state["emergency"] and used < policy.emergency_stop_percent and not state["pending"]:
        state["emergency"] = False
        persist(state)
        return used, [], True
    if used <= policy.regular_usage_percent and not state["emergency"]:
        return used, [], False
    return used, select(volumes, state["emergency"], time.time(), limit, policy), False


def configure(host, volume_id):
    with grpc.insecure_channel(f"{host}:18444") as channel:
        response = volume_pb2_grpc.VolumeServerStub(channel).VolumeConfigure(
            volume_pb2.VolumeConfigureRequest(volume_id=volume_id, replication="001"),
            timeout=15,
        )
    if response.error:
        raise RuntimeError(response.error)


def fingerprint(volume):
    return tuple(volume[key] for key in ("Collection", "Size", "FileCount", "DeleteCount"))


def resume_move(pending):
    volume_id = pending["id"]
    first, second = pending["targets"]
    if first == second or first not in HDDS or second not in HDDS:
        raise RuntimeError("invalid HDD servers in migration journal")
    source = status(SSD)[1].get(volume_id)
    volumes = {host: status(host)[1].get(volume_id) for host in HDDS}
    if any(volumes[host] for host in HDDS if host not in (first, second)):
        raise RuntimeError(f"volume {volume_id} has an unexpected HDD replica")
    if source and any(volumes.values()):
        raise RuntimeError(f"volume {volume_id} is on SSD and HDD; inspect interrupted move")
    if source:
        if source["ReadOnly"] or source["ReplicaPlacement"] != {}:
            raise RuntimeError(f"SSD volume {volume_id} needs inspection before moving")
        # The Admin default lane already holds the master maintenance lock.
        weed_shell(f"volume.move -noLock -volumeId={volume_id} -source={SSD}:8444 "
                   f"-target={first}:8444 -disk=hdd -timeout=90s -ioBytePerSecond=67108864")
    if volume_id in status(SSD)[1]:
        raise RuntimeError(f"SSD still has volume {volume_id} after native move")
    primary = status(first)[1].get(volume_id)
    if not primary or primary["DiskType"] not in ("", "hdd"):
        raise RuntimeError(f"primary HDD replica of {volume_id} is missing")
    if primary["ReplicaPlacement"] != {"node": 1}:
        configure(first, volume_id)
    if volume_id not in status(second)[1]:
        # Copy the already-configured volume so the second replica inherits 001.
        weed_shell(f"volume.copy -noLock -volumeId={volume_id} -source={first}:8444 "
                   f"-target={second}:8444")
    replicas = [status(host)[1].get(volume_id) for host in (first, second)]
    if any(not v or v["DiskType"] not in ("", "hdd") or v["ReplicaPlacement"] != {"node": 1}
           or v["ReadOnly"]
           for v in replicas):
        raise RuntimeError(f"could not verify both 001 HDD replicas of {volume_id}")
    if fingerprint(replicas[0]) != fingerprint(replicas[1]):
        raise RuntimeError(f"HDD replicas of {volume_id} disagree")


def migration_record(volume):
    available = set()
    for host in HDDS:
        disk, volumes = status(host)
        if volume["Id"] in volumes:
            raise RuntimeError(f"volume {volume['Id']} already exists on {host}")
        if disk["free"] >= volume["Size"] + 8 * GIB:
            available.add(host)
    targets = [next((host for host in group if host in available), None) for group in HDD_GROUPS]
    if not all(targets):
        raise RuntimeError("both HDD node groups must have an eligible volume server")
    return {"id": volume["Id"], "targets": targets}


def execute(progress, cancelled, policy):
    state = load_state()
    limit = volume_limit()
    migrated = 0
    while not cancelled.is_set():
        used, candidates, cleared = inspect(state, limit, policy)
        if not APPLY:
            ids = [v["Id"] for v in candidates]
            return (f"Dry run: SSD {used:.1f}%; emergency={state['emergency']}; "
                    f"pending={state['pending']}; ordered candidates={ids}")
        if not state["pending"]:
            if cleared:
                return f"Migrated {migrated} volumes; SSD {used:.1f}%; emergency cleared"
            if not candidates:
                if state["emergency"]:
                    raise RuntimeError(f"SSD {used:.1f}%; emergency remains active with no candidate")
                return f"Migrated {migrated} volumes; SSD {used:.1f}%"
            candidate = candidates[0]
            record = migration_record(candidate)
            current_disk, current_volumes = status(SSD)
            current = current_volumes.get(candidate["Id"])
            current_used = current_disk["percent_used"]
            if (not current or current["ModifiedAtSecond"] != candidate["ModifiedAtSecond"]
                    or current["Size"] != candidate["Size"]
                    or (not state["emergency"] and
                        (current_used <= policy.regular_usage_percent
                         or current_used > policy.emergency_usage_percent))
                    or (state["emergency"] and current_used < policy.emergency_stop_percent)):
                continue
            state["pending"] = record
            persist(state)
        progress(f"SSD {used:.1f}%; moving volume {state['pending']['id']}")
        resume_move(state["pending"])
        state["pending"] = None
        persist(state)
        migrated += 1
    raise RuntimeError(f"Cancelled after {migrated} verified migrations")
