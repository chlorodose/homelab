#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""遍历仓库内所有 Flux Helm 声明（HelmRepository / HelmChart / OCIRepository / HelmRelease）
以及容器镜像引用，并向上游查询是否有可用更新。

Helm chart：
  * HTTP 仓库读取 index.yaml，OCI 仓库查询 registry tags。
  * 当前版本 = 满足 Flux semver 约束的最大版本（即 Flux 实际会解析到的版本），
    "最新" = 上游最新稳定版；若最新版超出约束，则提示需要修改约束。

容器镜像：
  * 识别 `image: repo:tag` 字符串，以及 HelmRelease values 中的 image.{repository,tag}。
    values 里省略 repository / tag 时，通过 `helm show values/chart` 取 chart 默认值补全。
  * 按 tag 的前缀/后缀/段数匹配同类 tag，分别给出同主版本内最新和全局最新。
  * latest 等浮动标签若固定了 digest，则比对远端 digest 是否变化。

用法：scripts/check-updates.py [--charts | --images] [--outdated] [--json]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

TIMEOUT = 20
MAX_TAG_PAGES = 100
UA = "homelab-check-updates/1.0"

# 部分仓库不支持 tags/list，用同版本号的镜像仓库代查。
REGISTRY_ALIASES = {
    ("factory.talos.dev", "metal-installer/*"): ("ghcr.io", "siderolabs/installer"),
}

MANIFEST_ACCEPT = ",".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)


# --------------------------------------------------------------------------- #
# 版本与约束
# --------------------------------------------------------------------------- #
_SEMVER_RE = re.compile(
    r"^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


@dataclass(frozen=True, order=True)
class Ver:
    major: int
    minor: int
    patch: int
    # 稳定版排在预发布版之后，所以用 (0/1, 文本) 参与排序
    stable: int = 1
    pre: str = ""
    raw: str = field(default="", compare=False)

    @property
    def core(self) -> tuple[int, int, int]:
        return (self.major, self.minor, self.patch)


def parse_semver(text: str) -> Ver | None:
    m = _SEMVER_RE.match(text.strip().replace("_", "+"))
    if not m:
        return None
    major, minor, patch, pre = m.groups()
    return Ver(
        int(major),
        int(minor or 0),
        int(patch or 0),
        0 if pre else 1,
        pre or "",
        text,
    )


def _partial(text: str) -> tuple[list[int], bool]:
    """解析 `1.2` / `2.x` 这类部分版本，返回 (已指定的数字段, 是否含预发布)。"""
    text = text.strip().lstrip("v=")
    pre = "-" in text
    core = text.split("-", 1)[0].split("+", 1)[0]
    parts: list[int] = []
    for seg in core.split("."):
        if seg in ("x", "X", "*", ""):
            break
        parts.append(int(seg))
    return parts, pre


def _bump(parts: list[int], idx: int) -> tuple[int, int, int]:
    padded = (parts + [0, 0, 0])[:3]
    padded[idx] += 1
    for i in range(idx + 1, 3):
        padded[i] = 0
    return tuple(padded)  # type: ignore[return-value]


def _comparator(token: str):
    """把单个比较子转换为 (谓词, 是否允许预发布)。"""
    m = re.match(r"^(\^|~>?|>=|<=|!=|>|<|=)?\s*(.*)$", token)
    op, rest = m.group(1) or "", m.group(2)
    if rest in ("", "*", "x", "X"):
        return (lambda v: True), False
    parts, pre = _partial(rest)
    if not parts:
        return (lambda v: True), pre
    low = tuple((parts + [0, 0, 0])[:3])

    if op == "^":
        # 第一个非零段 +1；若指定段全为 0，则最后一个指定段 +1
        idx = next((i for i, p in enumerate(parts) if p != 0), len(parts) - 1)
        high = _bump(parts, idx)
        return (lambda v: low <= v.core < high), pre
    if op in ("~", "~>"):
        high = _bump(parts, 1 if len(parts) >= 2 else 0)
        return (lambda v: low <= v.core < high), pre
    if op in ("", "="):
        if len(parts) == 3:
            return (lambda v: v.core == low), pre
        high = _bump(parts, len(parts) - 1)
        return (lambda v: low <= v.core < high), pre
    if op == ">=":
        return (lambda v: v.core >= low), pre
    if op == ">":
        high = _bump(parts, len(parts) - 1)
        return (lambda v: v.core >= high), pre
    if op == "<=":
        high = _bump(parts, len(parts) - 1)
        return (lambda v: v.core < high), pre
    if op == "<":
        return (lambda v: v.core < low), pre
    if op == "!=":
        return (lambda v: v.core != low), pre
    raise ValueError(f"无法解析约束: {token}")


class Constraint:
    """Flux / Masterminds 风格的 semver 约束，支持 ^ ~ x-range 比较子与 ||。"""

    def __init__(self, text: str | None):
        self.text = (text or "").strip()
        self.groups: list[list[Any]] = []
        self.allow_pre = False
        if not self.text:
            self.groups = [[]]
            return
        for alt in self.text.split("||"):
            group = []
            tokens = re.findall(r"(?:\^|~>?|>=|<=|!=|>|<|=)?\s*[^\s,]+", alt.strip())
            for tok in tokens:
                pred, pre = _comparator(tok.strip())
                self.allow_pre |= pre
                group.append(pred)
            self.groups.append(group)

    def matches(self, v: Ver) -> bool:
        if not v.stable and not self.allow_pre:
            return False
        return any(all(p(v) for p in g) for g in self.groups)


# --------------------------------------------------------------------------- #
# 网络：HTTP / OCI registry
# --------------------------------------------------------------------------- #
def _open(req: urllib.request.Request):
    last: Exception | None = None
    for attempt in range(3):
        try:
            return urllib.request.urlopen(req, timeout=TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(1 + attempt)
                last = e
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(1 + attempt)
    raise last  # type: ignore[misc]


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with _open(req) as r:
        return r.read()


class Registry:
    """最小化的 OCI distribution 客户端，仅支持匿名拉取。"""

    def __init__(self) -> None:
        self._tokens: dict[tuple[str, str], str] = {}

    @staticmethod
    def normalize(host: str, name: str) -> tuple[str, str]:
        if host in ("docker.io", "index.docker.io", "registry.hub.docker.com"):
            host = "registry-1.docker.io"
        if host == "registry-1.docker.io" and "/" not in name:
            name = f"library/{name}"
        for (h, pattern), target in REGISTRY_ALIASES.items():
            if host == h and (pattern.endswith("*") and name.startswith(pattern[:-1])):
                return target
        return host, name

    def _token(self, host: str, name: str, challenge: str) -> str | None:
        params = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
        realm = params.get("realm")
        if not realm:
            return None
        query = {"scope": params.get("scope") or f"repository:{name}:pull"}
        if "service" in params:
            query["service"] = params["service"]
        url = f"{realm}?{urllib.parse.urlencode(query)}"
        data = json.loads(http_get(url))
        return data.get("token") or data.get("access_token")

    def request(self, host: str, name: str, path: str, method="GET", accept=None):
        url = path if path.startswith("http") else f"https://{host}{path}"
        headers = {"User-Agent": UA}
        if accept:
            headers["Accept"] = accept
        key = (host, name)
        for _ in range(2):
            if key in self._tokens:
                headers["Authorization"] = f"Bearer {self._tokens[key]}"
            try:
                return _open(urllib.request.Request(url, headers=headers, method=method))
            except urllib.error.HTTPError as e:
                challenge = e.headers.get("WWW-Authenticate", "")
                if e.code == 401 and challenge.lower().startswith("bearer"):
                    token = self._token(host, name, challenge)
                    if token and self._tokens.get(key) != token:
                        self._tokens[key] = token
                        continue
                raise
        raise RuntimeError("认证失败")

    def tags(self, host: str, name: str) -> list[str]:
        host, name = self.normalize(host, name)
        out: list[str] = []
        path: str | None = f"/v2/{name}/tags/list?n=1000"
        for _ in range(MAX_TAG_PAGES):
            with self.request(host, name, path) as r:
                out += json.load(r).get("tags") or []
                link = r.headers.get("Link", "")
            m = re.search(r"<([^>]+)>;\s*rel=\"next\"", link)
            if not m:
                break
            nxt = m.group(1)
            path = nxt
        return out

    def digest(self, host: str, name: str, tag: str) -> str | None:
        host, name = self.normalize(host, name)
        with self.request(host, name, f"/v2/{name}/manifests/{tag}", "HEAD", MANIFEST_ACCEPT) as r:
            return r.headers.get("Docker-Content-Digest")


REGISTRY = Registry()


def split_oci_url(url: str) -> tuple[str, str]:
    rest = url.removeprefix("oci://")
    host, _, name = rest.partition("/")
    return host, name.rstrip("/")


# --------------------------------------------------------------------------- #
# 仓库扫描
# --------------------------------------------------------------------------- #
@dataclass
class ChartInfo:
    kind: str  # HelmChart | OCIRepository | HelmRelease(内联)
    name: str
    file: str
    source: str  # 仓库 URL
    chart: str  # chart 名（HTTP）或空（OCI，名称在 URL 中）
    constraint: str
    is_tag: bool = False  # OCIRepository 使用 ref.tag 而非 semver
    resolved: str | None = None
    latest: str | None = None
    error: str | None = None


@dataclass
class Row:
    section: str  # chart | image
    name: str
    location: str
    current: str = "-"
    compat: str = "-"
    latest: str = "-"
    status: str = ""
    outdated: bool = False
    note: str = ""


@dataclass
class ImageRef:
    file: str
    where: str
    repo: str  # host/name，host 缺省为 docker.io
    tag: str
    digest: str
    note: str = ""
    # values 中缺少 repository / tag 时的待补全信息
    unresolved: str | None = None


def git_yaml_files(root: Path) -> list[Path]:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files", "*.yaml", "*.yml"],
            check=True, capture_output=True, text=True,
        ).stdout.split()
        return [root / f for f in out]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return sorted([*root.rglob("*.yaml"), *root.rglob("*.yml")])


def load_docs(root: Path, warnings: list[str]) -> list[tuple[str, dict]]:
    docs: list[tuple[str, dict]] = []
    for path in git_yaml_files(root):
        rel = str(path.relative_to(root))
        try:
            for doc in yaml.safe_load_all(path.read_text()):
                if isinstance(doc, dict):
                    docs.append((rel, doc))
        except yaml.YAMLError as e:
            warnings.append(f"{rel}: YAML 解析失败，已跳过 ({str(e).splitlines()[0]})")
    return docs


def parse_image(ref: str) -> tuple[str, str, str]:
    """`[host/]name[:tag][@digest]` -> (repo, tag, digest)。repo 总是带 host。"""
    digest = ""
    if "@" in ref:
        ref, digest = ref.split("@", 1)
    tag = ""
    last = ref.rsplit("/", 1)[-1]
    if ":" in last:
        ref, tag = ref.rsplit(":", 1)
    first, _, rest = ref.partition("/")
    if rest and ("." in first or ":" in first or first == "localhost"):
        repo = ref
    else:
        repo = f"docker.io/{ref}"
    return repo, tag, digest


def _lookup(tree: Any, path: list[str]) -> Any:
    for key in path:
        if not isinstance(tree, dict) or key not in tree:
            return None
        tree = tree[key]
    return tree


def walk_images(node: Any, path: list[str], file: str, out: list[ImageRef],
                values_prefix: int | None, release: str | None):
    """递归寻找 image 字段。values_prefix 是 values 在 path 中的起始深度（HelmRelease 内）。"""
    if isinstance(node, dict):
        for key, val in node.items():
            sub = [*path, str(key)]
            if key == "image":
                if isinstance(val, str):
                    if "$" not in val and "{{" not in val:
                        repo, tag, digest = parse_image(val)
                        out.append(ImageRef(file, ".".join(sub), repo, tag, digest))
                    continue
                if isinstance(val, dict) and ("repository" in val or "tag" in val):
                    out.append(_image_from_dict(val, sub, file, values_prefix, release))
                    continue
            walk_images(val, sub, file, out, values_prefix, release)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            walk_images(item, [*path, str(i)], file, out, values_prefix, release)


def _image_from_dict(val: dict, sub: list[str], file: str,
                     values_prefix: int | None, release: str | None) -> ImageRef:
    where = ".".join(sub)
    ref = ImageRef(file, where, "", "", "")
    ref.unresolved = release  # 记录所属 HelmRelease，稍后用 chart 默认值补全
    ref.note = json.dumps({"given": val, "path": sub[values_prefix:] if values_prefix is not None else []})
    return ref


class Scanner:
    def __init__(self, root: Path, use_helm: bool, jobs: int):
        self.root = root
        self.use_helm = use_helm
        self.jobs = jobs
        self.warnings: list[str] = []
        self.docs = load_docs(root, self.warnings)
        self.charts: dict[tuple[str, str], ChartInfo] = {}
        self.releases: list[tuple[str, dict, ChartInfo | None]] = []
        self._helm_cache: dict[tuple, Any] = {}

    # ---- chart 声明 ----
    def collect_charts(self) -> None:
        repos: dict[str, str] = {}
        for _, d in self.docs:
            if d.get("kind") == "HelmRepository":
                repos[d["metadata"]["name"]] = d["spec"]["url"]

        for file, d in self.docs:
            kind, spec = d.get("kind"), d.get("spec") or {}
            name = (d.get("metadata") or {}).get("name", "?")
            if kind == "HelmChart":
                src = repos.get((spec.get("sourceRef") or {}).get("name"), "")
                self.charts[(kind, name)] = ChartInfo(
                    kind, name, file, src, spec.get("chart", ""), str(spec.get("version") or ""))
            elif kind == "OCIRepository" and str(spec.get("url", "")).startswith("oci://"):
                ref = spec.get("ref") or {}
                is_tag = "tag" in ref and "semver" not in ref
                self.charts[(kind, name)] = ChartInfo(
                    kind, name, file, spec["url"], "",
                    str(ref.get("semver") or ref.get("tag") or ""), is_tag)

        for file, d in self.docs:
            if d.get("kind") != "HelmRelease":
                continue
            spec = d.get("spec") or {}
            name = d["metadata"]["name"]
            info = None
            if "chartRef" in spec:
                ref = spec["chartRef"]
                info = self.charts.get((ref.get("kind"), ref.get("name")))
            elif "chart" in spec:
                cs = spec["chart"].get("spec", {})
                src = repos.get((cs.get("sourceRef") or {}).get("name"), "")
                info = ChartInfo("HelmRelease", name, file, src, cs.get("chart", ""),
                                 str(cs.get("version") or ""))
                self.charts[("HelmRelease", name)] = info
            self.releases.append((file, d, info))

    # ---- chart 版本查询 ----
    def resolve_chart(self, c: ChartInfo) -> None:
        try:
            if c.source.startswith("oci://"):
                host, name = split_oci_url(c.source)
                names = REGISTRY.tags(host, name)
            elif c.source:
                index = yaml.safe_load(http_get(c.source.rstrip("/") + "/index.yaml"))
                entries = (index.get("entries") or {}).get(c.chart)
                if not entries:
                    raise LookupError(f"index.yaml 中没有 chart {c.chart}")
                names = [e["version"] for e in entries if e.get("version")]
            else:
                raise LookupError("找不到对应的 HelmRepository")

            versions = [v for v in map(parse_semver, names) if v]
            if c.is_tag:
                c.resolved = c.constraint
            else:
                cons = Constraint(c.constraint)
                ok = [v for v in versions if cons.matches(v)]
                c.resolved = max(ok).raw.replace("_", "+") if ok else None
            stable = [v for v in versions if v.stable]
            c.latest = max(stable or versions).raw.replace("_", "+") if versions else None
        except Exception as e:  # noqa: BLE001 - 单个 chart 失败不应中断整体扫描
            c.error = f"{type(e).__name__}: {e}"

    def chart_rows(self) -> list[Row]:
        with cf.ThreadPoolExecutor(self.jobs) as ex:
            list(ex.map(self.resolve_chart, self.charts.values()))
        rows = []
        for c in sorted(self.charts.values(), key=lambda c: (c.file, c.name)):
            label = c.chart or c.source.rstrip("/").rsplit("/", 1)[-1]
            row = Row("chart", label, f"{c.file} ({c.kind}/{c.name})",
                      note=f"约束 {c.constraint or '(无)'}")
            if c.error:
                row.status, row.note = "查询失败", c.error
            elif not c.resolved or not c.latest:
                row.status, row.note = "无匹配版本", row.note
            else:
                row.current, row.latest = c.resolved, c.latest
                cur, lat = parse_semver(c.resolved), parse_semver(c.latest)
                if cur and lat and lat > cur:
                    row.status, row.outdated = "有新版本（超出约束）", True
                else:
                    row.status = "最新"
            rows.append(row)
        return rows

    # ---- 镜像 ----
    def helm_show(self, c: ChartInfo, what: str) -> dict:
        key = (c.source, c.chart, c.resolved, what)
        if key not in self._helm_cache:
            if c.source.startswith("oci://"):
                cmd = ["helm", "show", what, c.source]
            else:
                cmd = ["helm", "show", what, c.chart, "--repo", c.source]
            cmd += ["--version", c.resolved or ""]
            try:
                out = subprocess.run(cmd, check=True, capture_output=True, text=True,
                                     timeout=120).stdout
                self._helm_cache[key] = yaml.safe_load(out) or {}
            except Exception as e:  # noqa: BLE001
                self._helm_cache[key] = {"__error__": str(e)}
        return self._helm_cache[key]

    def collect_images(self) -> list[ImageRef]:
        images: list[ImageRef] = []
        release_chart: dict[str, ChartInfo | None] = {}
        for file, d, info in self.releases:
            release_chart[f"{file}:{d['metadata']['name']}"] = info

        for file, d in self.docs:
            if d.get("kind") == "HelmRelease":
                # values 位于 spec.values，path 前两段为 spec/values
                key = f"{file}:{d['metadata']['name']}"
                walk_images(d.get("spec", {}).get("values"), ["spec", "values"], file,
                            images, 2, key)
                # 其余字段（如 postRenderers）按普通对象扫描
                spec = {k: v for k, v in (d.get("spec") or {}).items() if k != "values"}
                walk_images(spec, ["spec"], file, images, None, None)
            else:
                walk_images(d, [], file, images, None, None)

        for img in images:
            if img.unresolved is None:
                continue
            payload = json.loads(img.note)
            img.note, release = "", img.unresolved
            img.unresolved = None
            given, rel_path = payload["given"], payload["path"]
            chart = release_chart.get(release)
            defaults: dict = {}
            app_version = ""
            if self.use_helm and chart and chart.resolved:
                defaults = _lookup(self.helm_show(chart, "values"), rel_path) or {}
                app_version = str(self.helm_show(chart, "chart").get("appVersion") or "")
            merged = {**(defaults if isinstance(defaults, dict) else {}), **given}
            repository = merged.get("repository")
            if not repository:
                img.unresolved = "values 与 chart 默认值均未给出 repository"
                if not self.use_helm:
                    img.unresolved += "（--no-helm）"
                continue
            if merged.get("registry"):
                repository = f"{merged['registry']}/{repository}"
            tag = str(merged.get("tag") or "")
            digest = str(merged.get("digest") or "")
            if "@" in tag:
                tag, digest = tag.split("@", 1)
            if not tag and not digest and app_version:
                tag, img.note = app_version, "tag 取自 chart appVersion"
            img.repo = parse_image(repository)[0]
            img.tag, img.digest = tag, digest
        return images


# --------------------------------------------------------------------------- #
# 镜像 tag 比较
# --------------------------------------------------------------------------- #
_TAG_RE = re.compile(r"^(\D*?)(\d+(?:\.\d+)*)(.*)$")


def parse_tag(tag: str) -> tuple[str, tuple[int, ...], str] | None:
    m = _TAG_RE.match(tag)
    if not m:
        return None
    prefix, nums, suffix = m.groups()
    return prefix, tuple(int(n) for n in nums.split(".")), suffix


def check_image(img: ImageRef) -> Row:
    short = img.repo.removeprefix("docker.io/")
    row = Row("image", short, f"{img.file} ({img.where})")
    if img.unresolved:
        row.status, row.note = "无法解析", img.unresolved
        return row
    host, _, name = img.repo.partition("/")
    shown = img.tag or "(未指定)"
    row.current = shown + ("@" + img.digest[:19] + "…" if img.digest else "")
    row.note = img.note
    try:
        parsed = parse_tag(img.tag) if img.tag else None
        if not parsed:
            # latest / 无 tag / 非版本号 tag：浮动标签，只能比对 digest
            if img.digest:
                remote = REGISTRY.digest(host, name, img.tag or "latest")
                row.latest = (remote or "?")[:19] + "…"
                if remote and remote != img.digest:
                    row.status, row.outdated = "digest 已更新", True
                else:
                    row.status = "最新"
            else:
                row.status = "浮动标签"
                row.note = (row.note + " 未固定 digest，无法判断").strip()
            return row

        prefix, nums, suffix = parsed
        cands = []
        for t in REGISTRY.tags(host, name):
            p = parse_tag(t)
            # 前缀比较时忽略 v（部分 chart 的 appVersion 不带 v，而镜像 tag 带 v）
            if (p and p[0].removesuffix("v") == prefix.removesuffix("v")
                    and p[2] == suffix and len(p[1]) == len(nums)):
                cands.append((p[1], t))
        if not cands:
            row.status, row.note = "无同类 tag", f"没有与 {img.tag} 同格式的 tag"
            return row
        latest = max(cands)
        same_major = max(c for c in cands if c[0][0] == nums[0])
        row.latest, row.compat = latest[1], same_major[1]
        if same_major[0] > nums:
            row.status, row.outdated = "可更新", True
        elif latest[0] > nums:
            row.status, row.outdated = "有新主版本", True
        elif latest[0] < nums:
            row.status = "领先上游"
            row.note = f"当前高于查询到的最新 tag {latest[1]}"
        else:
            row.status = "最新"
    except Exception as e:  # noqa: BLE001
        row.status, row.note = "查询失败", f"{type(e).__name__}: {e}"
    return row


# --------------------------------------------------------------------------- #
# 输出
# --------------------------------------------------------------------------- #
def width(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def pad(s: str, w: int) -> str:
    return s + " " * (w - width(s))


def render(rows: list[Row], title: str, color: bool) -> None:
    if not rows:
        return
    print(f"\n## {title}\n")
    head = ("名称", "当前", "同主版本最新", "全局最新", "状态", "位置")
    body = [(r.name, r.current, r.compat, r.latest, r.status, r.location) for r in rows]
    if all(r.compat == "-" for r in rows):  # chart 没有“同主版本”概念，省略该列
        drop = lambda cells: tuple(c for i, c in enumerate(cells) if i != 2)  # noqa: E731
        head, body = drop(head), [drop(cells) for cells in body]
    widths = [max(width(x[i]) for x in [head, *body]) for i in range(len(head))]
    print("  ".join(pad(h, w) for h, w in zip(head, widths)))
    print("  ".join("-" * w for w in widths))
    for r, cells in zip(rows, body):
        line = "  ".join(pad(c, w) for c, w in zip(cells, widths))
        if color:
            code = "33" if r.outdated else "31" if r.status in ("查询失败", "无法解析", "无匹配版本") else "32" if r.status == "最新" else "0"
            line = f"\033[{code}m{line}\033[0m"
        print(line)
        if r.note:
            print(f"    ↳ {r.note}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                    help="仓库根目录（默认为脚本所在仓库）")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--charts", action="store_true", help="仅检查 Helm chart")
    g.add_argument("--images", action="store_true", help="仅检查容器镜像")
    ap.add_argument("--outdated", action="store_true", help="只显示有更新或有问题的条目")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出")
    ap.add_argument("--no-helm", action="store_true",
                    help="不调用 helm 补全 values 中缺省的镜像 repository/tag")
    ap.add_argument("-j", "--jobs", type=int, default=8, help="并发查询数（默认 8）")
    ap.add_argument("--exit-code", action="store_true", help="存在可用更新时以退出码 1 结束")
    args = ap.parse_args()

    use_helm = not args.no_helm
    if use_helm:
        try:
            subprocess.run(["helm", "version", "--short"], check=True, capture_output=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            print("警告: 未找到 helm，跳过 values 默认值补全", file=sys.stderr)
            use_helm = False

    sc = Scanner(args.root, use_helm, args.jobs)
    sc.collect_charts()

    chart_rows: list[Row] = []
    image_rows: list[Row] = []
    # 镜像补全依赖 chart 解析结果，因此总是先解析 chart
    chart_rows = sc.chart_rows()
    if not args.charts:
        images = sc.collect_images()
        with cf.ThreadPoolExecutor(args.jobs) as ex:
            image_rows = list(ex.map(check_image, images))
        image_rows.sort(key=lambda r: (r.location, r.name))
    if args.images:
        chart_rows = []

    def keep(r: Row) -> bool:
        return not args.outdated or r.outdated or r.status not in ("最新", "浮动标签", "领先上游")

    chart_rows = [r for r in chart_rows if keep(r)]
    image_rows = [r for r in image_rows if keep(r)]

    if args.json:
        json.dump({"charts": [asdict(r) for r in chart_rows],
                   "images": [asdict(r) for r in image_rows],
                   "warnings": sc.warnings}, sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        color = sys.stdout.isatty()
        render(chart_rows, "Helm charts", color)
        render(image_rows, "容器镜像", color)
        for w in sc.warnings:
            print(f"警告: {w}", file=sys.stderr)
        n = sum(r.outdated for r in [*chart_rows, *image_rows])
        print(f"\n共 {n} 项存在可用更新")

    return 1 if args.exit_code and any(r.outdated for r in [*chart_rows, *image_rows]) else 0


if __name__ == "__main__":
    sys.exit(main())
