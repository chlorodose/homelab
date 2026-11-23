"""Python implementation of SeaweedFS 4.54's plugin worker stream."""

import asyncio
import base64
import contextlib
from dataclasses import asdict
import hmac
import json
import logging
import os
import signal
import threading
import time
import uuid

import grpc
import plugin_pb2 as pb
import plugin_pb2_grpc as rpc

import tiering

JOB_TYPE = "ssd_tiering"
ADMIN = os.environ.get("SEAWEED_ADMIN_GRPC", "seaweed-admin.database:33646")
LOG = logging.getLogger(JOB_TYPE)
DEFAULTS = asdict(tiering.Policy())
POLICY_FIELDS = (
    ("regular_usage_percent", "Regular SSD threshold (%)",
     "Run regular tiering only when SSD usage exceeds this value.", 0, 99),
    ("quiet_days", "Minimum quiet period (days)",
     "Regular tiering requires the last modification to be older than this many days.", 0, None),
    ("volume_fill_percent", "Minimum volume fill (%)",
     "Regular tiering requires the volume to exceed this percentage of its size limit.", 0, 100),
    ("emergency_usage_percent", "Emergency SSD threshold (%)",
     "Above this SSD usage, ignore volume age and fill. Must exceed the regular threshold and the emergency stop target.", 1, 99),
    ("emergency_stop_percent", "Emergency stop target (%)",
     "Continue emergency tiering until SSD usage drops below this value.", 1, 98),
)


def policy_form():
    fields = []
    for name, label, description, minimum, maximum in POLICY_FIELDS:
        field = pb.ConfigField(
            name=name, label=label, description=description, required=True,
            field_type=pb.CONFIG_FIELD_TYPE_INT64, widget=pb.CONFIG_WIDGET_NUMBER,
            min_value=pb.ConfigValue(int64_value=minimum),
        )
        if maximum is not None:
            field.max_value.int64_value = maximum
        fields.append(field)
    return pb.ConfigForm(
        form_id="ssd-tiering-policy", title="SSD tiering policy",
        sections=[pb.ConfigSection(section_id="thresholds", title="Migration thresholds", fields=fields)],
        default_values={name: pb.ConfigValue(int64_value=value) for name, value in DEFAULTS.items()},
    )


def policy_from_config(config):
    settings = dict(DEFAULTS)
    for name, label, _, minimum, maximum in POLICY_FIELDS:
        if name not in config:
            continue
        setting = config[name]
        if setting.WhichOneof("kind") != "int64_value":
            raise ValueError(f"{label} must be an integer")
        value = setting.int64_value
        if value < minimum or (maximum is not None and value > maximum):
            raise ValueError(f"{label} is out of range")
        settings[name] = value
    policy = tiering.Policy(**settings)
    if policy.emergency_usage_percent <= max(policy.regular_usage_percent,
                                             policy.emergency_stop_percent):
        raise ValueError("Emergency threshold must exceed the regular threshold and stop target")
    return policy


def admin_metadata():
    def encode(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=")

    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    payload = encode(json.dumps({"exp": int(time.time()) + 60}).encode())
    signing_input = header + b"." + payload
    key = os.environ["SEAWEED_ADMIN_SIGNING_KEY"].encode()
    signature = encode(hmac.digest(key, signing_input, "sha256"))
    return (("authorization", "Bearer " + (signing_input + b"." + signature).decode()),)


def descriptor():
    return pb.JobTypeDescriptor(
        job_type=JOB_TYPE, display_name="SSD tiering",
        description="Move SSD volumes to HDD using disk watermarks", descriptor_version=2,
        admin_config_form=policy_form(),
        admin_runtime_defaults=pb.AdminRuntimeDefaults(
            enabled=True, detection_interval_minutes=5, detection_timeout_seconds=45,
            max_jobs_per_detection=1, global_execution_concurrency=1,
            per_worker_execution_concurrency=1, retry_limit=0,
            job_type_max_runtime_seconds=3600, execution_timeout_seconds=3500,
        ),
    )


def detect(policy):
    disk, volumes = tiering.status(tiering.SSD)
    used = disk["percent_used"]
    state = tiering.load_state()
    if not state["pending"] and not state["emergency"] and used <= policy.regular_usage_percent:
        return None, f"SSD {used:.1f}% used; regular threshold is {policy.regular_usage_percent}%"
    emergency = state["emergency"] or used > policy.emergency_usage_percent
    if not emergency and not state["pending"]:
        limit = tiering.volume_limit()
        candidates = tiering.select(volumes, False, time.time(), limit, policy)
        if not candidates:
            return None, f"SSD {used:.1f}% used; no regular candidates"
    return pb.JobProposal(
        proposal_id=str(uuid.uuid4()), dedupe_key=JOB_TYPE, job_type=JOB_TYPE,
        priority=pb.JOB_PRIORITY_HIGH if emergency else pb.JOB_PRIORITY_NORMAL,
        summary="SSD tiering" if tiering.APPLY else "SSD tiering dry run",
        detail=f"SSD used {used:.1f}%; emergency={emergency}",
    ), ""


class Worker:
    def __init__(self):
        self.instance = str(uuid.uuid4())
        self.worker_id = "homelab-ssd-tiering"
        self.interval = 10
        self.active = None
        self.work = None
        self.cancelled = None

    def send(self, field, message):
        envelope = pb.WorkerToAdminMessage(worker_id=self.worker_id)
        envelope.sent_at.GetCurrentTime()
        getattr(envelope, field).CopyFrom(message)
        self.outgoing.put_nowait(envelope)

    def ack(self, request_id, accepted, message=""):
        self.send("acknowledge", pb.WorkerAcknowledge(
            request_id=request_id, accepted=accepted, message=message,
        ))

    def heartbeat(self):
        kind = self.work.kind if self.work else None
        self.send("heartbeat", pb.WorkerHeartbeat(
            worker_id=self.worker_id, detection_slots_total=1, execution_slots_total=1,
            detection_slots_used=int(kind == pb.WORK_KIND_DETECTION),
            execution_slots_used=int(kind == pb.WORK_KIND_EXECUTION),
            running_work=[self.work] if self.work else [],
        ))

    async def heartbeats(self):
        while True:
            await asyncio.sleep(self.interval)
            self.heartbeat()

    async def do_detection(self, request_id, config):
        result = pb.DetectionComplete(request_id=request_id, job_type=JOB_TYPE)
        try:
            proposal, skipped = await asyncio.to_thread(detect, policy_from_config(config))
            if self.cancelled.is_set():
                raise RuntimeError("Detection cancelled")
            if proposal:
                self.send("detection_proposals", pb.DetectionProposals(
                    request_id=request_id, job_type=JOB_TYPE, proposals=[proposal],
                ))
                result.total_proposals = 1
            result.skipped_reason = skipped
            result.success = True
            LOG.info("Detection: %s", proposal.detail if proposal else skipped)
        except Exception as error:
            LOG.exception("Detection failed")
            result.error_message = str(error)
        finally:
            self.send("detection_complete", result)

    async def do_execution(self, request_id, job_id, config):
        result = pb.JobCompleted(request_id=request_id, job_id=job_id, job_type=JOB_TYPE)
        loop = asyncio.get_running_loop()

        def progress(message):
            LOG.info("%s", message)
            loop.call_soon_threadsafe(self.send, "job_progress_update", pb.JobProgressUpdate(
                request_id=request_id, job_id=job_id, job_type=JOB_TYPE,
                state=pb.JOB_STATE_RUNNING, stage="migrating", message=message,
            ))

        try:
            summary = await asyncio.to_thread(
                tiering.execute, progress, self.cancelled, policy_from_config(config),
            )
            LOG.info("%s", summary)
            result.success = True
            result.result.summary = summary
        except Exception as error:
            LOG.exception("Tiering failed")
            result.error_message = str(error)
        finally:
            self.send("job_completed", result)

    async def run_work(self, kind, work_id, request_id, config):
        try:
            if kind == pb.WORK_KIND_DETECTION:
                await self.do_detection(request_id, config)
            else:
                await self.do_execution(request_id, work_id, config)
        finally:
            self.work = None
            self.heartbeat()

    def handle(self, message):
        request_id = message.request_id
        body = message.WhichOneof("body")
        if body == "hello":
            if not message.hello.accepted:
                raise RuntimeError(f"Admin rejected worker: {message.hello.message}")
            self.interval = max(1, message.hello.heartbeat_interval_seconds or 10)
            LOG.info("Registered %s with Admin at %s; apply=%s", JOB_TYPE, ADMIN, tiering.APPLY)
            self.heartbeat()
        elif body == "request_config_schema":
            supported = message.request_config_schema.job_type == JOB_TYPE
            response = pb.ConfigSchemaResponse(request_id=request_id,
                                               job_type=message.request_config_schema.job_type,
                                               success=supported)
            if supported:
                response.job_type_descriptor.CopyFrom(descriptor())
            else:
                response.error_message = "Unsupported job type"
            self.send("config_schema_response", response)
        elif body in ("run_detection_request", "execute_job_request"):
            if body == "run_detection_request":
                request = message.run_detection_request
                kind, work_id, job_type = pb.WORK_KIND_DETECTION, request_id, request.job_type
            else:
                request = message.execute_job_request
                job = request.job
                kind, work_id, job_type = pb.WORK_KIND_EXECUTION, job.job_id, job.job_type
            if self.work or job_type != JOB_TYPE or not work_id:
                self.ack(request_id, False, "Busy or unsupported work")
                return
            self.cancelled = threading.Event()
            self.work = pb.RunningWork(
                work_id=work_id, kind=kind, job_type=job_type, state=pb.JOB_STATE_RUNNING,
            )
            self.ack(request_id, True)
            self.heartbeat()
            self.active = asyncio.create_task(
                self.run_work(kind, work_id, request_id, request.admin_config_values),
            )
        elif body == "cancel_request":
            accepted = bool(self.work and self.work.work_id == message.cancel_request.target_id)
            if accepted:
                self.cancelled.set()
            self.ack(request_id, accepted)
        elif body == "shutdown":
            self.ack(request_id, True)
            if self.work:
                self.cancelled.set()
        else:
            self.ack(request_id, False, "Unsupported message")

    async def session(self):
        self.outgoing = asyncio.Queue()
        self.send("hello", pb.WorkerHello(
            worker_id=self.worker_id, worker_instance_id=self.instance,
            worker_version="2", protocol_version="plugin.v1",
            capabilities=[pb.JobTypeCapability(
                job_type=JOB_TYPE, can_detect=True, can_execute=True,
                max_detection_concurrency=1, max_execution_concurrency=1,
                display_name="SSD tiering",
            )],
        ))
        async with grpc.aio.insecure_channel(ADMIN) as channel:
            stream = rpc.PluginControlServiceStub(channel).WorkerStream(metadata=admin_metadata())
            async def send_messages():
                while True:
                    await stream.write(await self.outgoing.get())
            sender = asyncio.create_task(send_messages())
            ticker = asyncio.create_task(self.heartbeats())
            try:
                async for message in stream:
                    self.handle(message)
            finally:
                if self.work:
                    self.cancelled.set()
                stream.cancel()
                for task in (sender, ticker):
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, grpc.RpcError, asyncio.InvalidStateError):
                        await task
                if self.active:
                    await self.active

    async def run(self):
        stop = asyncio.Event()
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set)
        while not stop.is_set():
            session = asyncio.create_task(self.session())
            stopping = asyncio.create_task(stop.wait())
            await asyncio.wait((session, stopping), return_when=asyncio.FIRST_COMPLETED)
            if stopping.done():
                session.cancel()
            stopping.cancel()
            try:
                await session
            except asyncio.CancelledError:
                if not stop.is_set():
                    raise
            except (grpc.RpcError, RuntimeError) as error:
                LOG.warning("Admin stream disconnected: %s", error)
            if not stop.is_set():
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=5)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(Worker().run())
