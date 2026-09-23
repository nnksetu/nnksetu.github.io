#!/usr/bin/env python3
"""Download non-🔞 ZrSetuTime archives in descending issue order.

The input JSON files are expected to contain items like:
{
    "file": "1041.html",
    "caption": "# title [80P]"
}

By default, JSON files are read from data/zrsetu and archives are saved to
~/Downloads/temp.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener


DEFAULT_BASE_URL = "https://r2-origin.setutime.com/zrsetu_zip"
DEFAULT_WORKERS = 1
DEFAULT_ORIGIN_IPS = ("172.67.187.66", "104.21.88.241")
ISSUE_RE = re.compile(r"^(\d+)\.html$", re.IGNORECASE)
ADULT_MARKER = "🔞"
CURL_PATH = shutil.which("curl") or "/usr/bin/curl"
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "application/zip,application/octet-stream,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
    "Referer": "https://r2.setutime.top/",
    "Connection": "close",
}


def format_bytes(value: int | None) -> str:
    if value is None:
        return "?"
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    amount = float(value)
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            return f"{amount:.1f} {unit}" if unit != "B" else f"{int(amount)} B"
        amount /= 1024
    return f"{value} B"


class ProgressDisplay:
    """Render one live progress bar per download in the current batch."""

    def __init__(self, issues: list[int], enabled: bool) -> None:
        self.issues = issues
        self.enabled = enabled and sys.stdout.isatty()
        self.lock = threading.Lock()
        self.state = {issue: [0, None, "downloading"] for issue in issues}
        self.lines_drawn = 0

    def start(self) -> None:
        if not self.enabled:
            return
        with self.lock:
            for issue in self.issues:
                print(self._line(issue))
            self.lines_drawn = len(self.issues)

    def update(self, issue: int, downloaded: int, total: int | None) -> None:
        with self.lock:
            current = self.state[issue]
            current[0] = downloaded
            if total is not None:
                current[1] = total
            if self.enabled:
                self._render_locked()

    def finish(self, issue: int, status: str) -> None:
        with self.lock:
            current = self.state[issue]
            if status in {"downloaded", "skipped"}:
                current[0] = current[1] or 1
                current[1] = current[1] or 1
            current[2] = status
            if self.enabled:
                self._render_locked()

    def close(self) -> None:
        if self.enabled:
            with self.lock:
                self._render_locked()
                print()

    def _line(self, issue: int) -> str:
        downloaded, total, status = self.state[issue]
        if total:
            percent = min(downloaded / total, 1.0)
            filled = int(percent * 24)
            bar = "#" * filled + "-" * (24 - filled)
            progress = f"{percent:6.1%} {format_bytes(downloaded)}/{format_bytes(total)}"
        else:
            bar = "-" * 24
            progress = f"       {format_bytes(downloaded)}/?"
        return f"{issue:>4} [{bar}] {progress:<25} {status}"

    def _render_locked(self) -> None:
        if not self.enabled:
            return
        sys.stdout.write(f"\033[{self.lines_drawn}A")
        for issue in self.issues:
            sys.stdout.write(f"\033[2K\r{self._line(issue)}\n")
        sys.stdout.flush()


def make_opener(proxy: str | None, ca_bundle: Path | None):
    context = ssl.create_default_context()

    # The python.org macOS installer can leave its default OpenSSL CA path
    # empty. Use certifi in that case, while still honoring an explicit bundle.
    verify_paths = ssl.get_default_verify_paths()
    has_default_bundle = bool(
        (verify_paths.cafile and Path(verify_paths.cafile).is_file())
        or (verify_paths.capath and Path(verify_paths.capath).is_dir())
    )
    certifi_path = None
    try:
        import certifi

        certifi_path = Path(certifi.where())
    except ImportError:
        pass

    if not has_default_bundle and certifi_path and certifi_path.is_file():
        context.load_verify_locations(cafile=str(certifi_path))
    if ca_bundle:
        if not ca_bundle.is_file():
            raise FileNotFoundError(f"CA bundle not found: {ca_bundle}")
        context.load_verify_locations(cafile=str(ca_bundle))

    handlers = [HTTPSHandler(context=context)]
    if proxy:
        handlers.append(ProxyHandler({"http": proxy, "https": proxy}))
    return build_opener(*handlers)


def fake_ip_addresses(host: str) -> list[str]:
    addresses = set()
    try:
        for family, _, _, _, address in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM):
            if family == socket.AF_INET:
                ip = address[0]
                if ipaddress.ip_address(ip) in ipaddress.ip_network("198.18.0.0/15"):
                    addresses.add(ip)
    except OSError:
        pass
    return sorted(addresses)


def curl_args(
    proxy: str | None,
    ca_bundle: Path | None,
    timeout: float,
    url: str,
    origin_ip: str | None,
) -> list[str]:
    args = [
        CURL_PATH,
        "--location",
        "--http1.1",
        "--fail",
        "--silent",
        "--show-error",
        "--connect-timeout",
        str(timeout),
        "--user-agent",
        BROWSER_HEADERS["User-Agent"],
        "--header",
        f"Accept: {BROWSER_HEADERS['Accept']}",
        "--header",
        f"Accept-Language: {BROWSER_HEADERS['Accept-Language']}",
        "--header",
        f"Accept-Encoding: {BROWSER_HEADERS['Accept-Encoding']}",
        "--referer",
        BROWSER_HEADERS["Referer"],
    ]
    if proxy:
        args.extend(["--proxy", proxy])
    else:
        # Do not inherit HTTP(S)_PROXY from the shell for the direct mode.
        # OS-level TUN routing, if active, is still visible via fake_ip_addresses().
        args.extend(["--noproxy", "*"])
    if origin_ip:
        hostname = urlsplit(url).hostname
        if hostname:
            args.extend(["--resolve", f"{hostname}:443:{origin_ip}"])
    if ca_bundle:
        args.extend(["--cacert", str(ca_bundle)])
    return args


def curl_probe(
    url: str,
    proxy: str | None,
    ca_bundle: Path | None,
    timeout: float,
    origin_ip: str | None,
) -> tuple[int | None, int | None, str | None]:
    """Return (HTTP status, total size, error) using curl's native TLS stack."""
    command = curl_args(proxy, ca_bundle, timeout, url, origin_ip)
    command.extend(["--head", "--dump-header", "-", "--output", "/dev/null", url])
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=max(timeout + 5, 15),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, None, str(error)

    statuses = [
        int(match.group(1))
        for match in re.finditer(r"^HTTP/\S+\s+(\d{3})", result.stdout, re.MULTILINE)
    ]
    lengths = [
        int(match.group(1))
        for match in re.finditer(r"^Content-Length:\s*(\d+)\s*$", result.stdout, re.IGNORECASE | re.MULTILINE)
    ]
    status = statuses[-1] if statuses else None
    total = lengths[-1] if lengths else None
    if status == 404:
        return status, total, "HTTP 404: source archive does not exist"
    if result.returncode != 0 and status is None:
        return status, total, result.stderr.strip() or f"curl exited with code {result.returncode}"
    return status, total, None


def curl_download(
    issue: int,
    url: str,
    partial: Path,
    proxy: str | None,
    ca_bundle: Path | None,
    timeout: float,
    total: int | None,
    progress: ProgressDisplay,
    origin_ip: str | None,
    restarted: bool = False,
) -> tuple[bool, str]:
    command = curl_args(proxy, ca_bundle, timeout, url, origin_ip)
    command.extend(["--continue-at", "-", "--output", str(partial), url])
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as error:
        return False, str(error)

    while process.poll() is None:
        downloaded = partial.stat().st_size if partial.exists() else 0
        progress.update(issue, downloaded, total)
        time.sleep(0.25)

    stderr = process.stderr.read().strip() if process.stderr else ""
    downloaded = partial.stat().st_size if partial.exists() else 0
    progress.update(issue, downloaded, total)
    if process.returncode == 0 and downloaded > 0:
        return True, f"{downloaded:,} bytes"

    # curl returns 33 when a server refuses to resume. Restarting the partial
    # file once lets the server return a normal full response.
    if process.returncode == 33 and partial.exists() and not restarted:
        partial.unlink()
        return curl_download(
            issue,
            url,
            partial,
            proxy,
            ca_bundle,
            timeout,
            total,
            progress,
            origin_ip,
            restarted=True,
        )
    return False, stderr or f"curl exited with code {process.returncode}"


def save_response(
    response,
    issue: int,
    partial: Path,
    offset: int,
    progress: ProgressDisplay,
) -> None:
    content_length = response.headers.get("Content-Length")
    content_range = response.headers.get("Content-Range", "")
    total = None
    if content_range.rsplit("/", 1)[-1].isdigit():
        total = int(content_range.rsplit("/", 1)[-1])
    elif content_length and content_length.isdigit():
        total = offset + int(content_length)

    downloaded = offset
    progress.update(issue, downloaded, total)
    mode = "ab" if offset else "wb"
    with partial.open(mode) as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            downloaded += len(chunk)
            progress.update(issue, downloaded, total)


def load_issues(json_dir: Path) -> tuple[list[int], dict[int, str]]:
    """Return eligible issue numbers and captions for excluded issues."""
    issues: dict[int, str] = {}
    excluded: dict[int, str] = {}

    json_files = sorted(json_dir.glob("*.json"), key=lambda path: int(path.stem))
    if not json_files:
        raise FileNotFoundError(f"No JSON files found in {json_dir}")

    for json_file in json_files:
        with json_file.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)

        for item in payload.get("items", []):
            match = ISSUE_RE.fullmatch(str(item.get("file", "")))
            if not match:
                print(
                    f"[WARN] Skipping item with invalid file field in {json_file}: "
                    f"{item.get('file')!r}",
                    file=sys.stderr,
                )
                continue

            issue = int(match.group(1))
            caption = str(item.get("caption", ""))
            if ADULT_MARKER in caption:
                excluded[issue] = caption
            else:
                issues[issue] = caption

    # Exclusion wins even if the same issue is encountered in another input file.
    for issue in excluded:
        issues.pop(issue, None)

    return sorted(issues, reverse=True), excluded


def archive_url(base_url: str, issue: int) -> str:
    filename = f"ZrSetuTime - 第{issue}期原图.zip"
    return f"{base_url.rstrip('/')}/{quote(filename)}"


def download_one_python(
    issue: int,
    output_dir: Path,
    base_url: str,
    retries: int,
    timeout: float,
    overwrite: bool,
    proxy: str | None,
    ca_bundle: Path | None,
    progress: ProgressDisplay,
) -> tuple[int, str, str]:
    """Download one archive and return (issue, status, detail)."""
    filename = f"ZrSetuTime - 第{issue}期原图.zip"
    destination = output_dir / filename
    partial = output_dir / f".{filename}.part"
    url = archive_url(base_url, issue)
    opener = make_opener(proxy, ca_bundle)

    if destination.exists() and not overwrite:
        return issue, "skipped", "already exists"

    last_error = "unknown error"
    for attempt in range(1, retries + 1):
        offset = partial.stat().st_size if partial.exists() else 0
        try:
            headers = dict(BROWSER_HEADERS)
            if offset:
                headers["Range"] = f"bytes={offset}-"

            request = Request(url, headers=headers)
            with opener.open(request, timeout=timeout) as response:
                status_code = getattr(response, "status", 200)
                if offset and status_code != 206:
                    # The server ignored Range; restart this file cleanly.
                    offset = 0
                    try:
                        partial.unlink()
                    except FileNotFoundError:
                        pass
                    response.close()
                    request = Request(url, headers=BROWSER_HEADERS)
                    with opener.open(request, timeout=timeout) as response:
                        save_response(response, issue, partial, offset, progress)
                else:
                    save_response(response, issue, partial, offset, progress)

            if partial.stat().st_size == 0:
                raise OSError("server returned an empty file")

            os.replace(partial, destination)
            return issue, "downloaded", f"{destination.stat().st_size:,} bytes"
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            if isinstance(error, HTTPError):
                if error.code == 404:
                    last_error = "HTTP 404: source archive does not exist"
                else:
                    last_error = f"HTTP {error.code}: {error.reason}"
                if 400 <= error.code < 500 and error.code not in {408, 429}:
                    break
            else:
                last_error = str(error)
            if attempt < retries:
                time.sleep(min(2**attempt, 10))

    return issue, "failed", last_error


def download_one_curl(
    issue: int,
    output_dir: Path,
    base_url: str,
    retries: int,
    timeout: float,
    overwrite: bool,
    proxy: str | None,
    ca_bundle: Path | None,
    progress: ProgressDisplay,
    origin_ips: tuple[str, ...],
) -> tuple[int, str, str]:
    """Download one archive through macOS curl's native TLS implementation."""
    filename = f"ZrSetuTime - 第{issue}期原图.zip"
    destination = output_dir / filename
    partial = output_dir / f".{filename}.part"
    url = archive_url(base_url, issue)

    if destination.exists() and not overwrite:
        return issue, "skipped", "already exists"

    # System DNS is currently returning a Clash Fake-IP for this host. Probe
    # the known public Cloudflare addresses while keeping the original host as
    # the TLS SNI/HTTP Host value.
    selected_ip = None
    status = None
    total = None
    last_error = "unknown error"
    for origin_ip in origin_ips or (None,):
        status, total, probe_error = curl_probe(
            url,
            proxy,
            ca_bundle,
            timeout,
            origin_ip,
        )
        if status == 404:
            return issue, "failed", "HTTP 404: source archive does not exist"
        if status is not None and 200 <= status < 400:
            selected_ip = origin_ip
            break
        if probe_error:
            last_error = probe_error

    # Continue to the actual request even if HEAD was unavailable.
    for attempt in range(1, retries + 1):
        origin_ip = selected_ip
        if origin_ip is None and origin_ips:
            origin_ip = origin_ips[(attempt - 1) % len(origin_ips)]
        success, detail = curl_download(
            issue,
            url,
            partial,
            proxy,
            ca_bundle,
            timeout,
            total,
            progress,
            origin_ip,
        )
        if success:
            os.replace(partial, destination)
            return issue, "downloaded", detail
        last_error = detail
        if attempt < retries:
            time.sleep(min(2**attempt, 10))

    return issue, "failed", last_error


def download_one(
    issue: int,
    output_dir: Path,
    base_url: str,
    retries: int,
    timeout: float,
    overwrite: bool,
    proxy: str | None,
    ca_bundle: Path | None,
    progress: ProgressDisplay,
    backend: str,
    origin_ips: tuple[str, ...],
) -> tuple[int, str, str]:
    if backend == "curl":
        return download_one_curl(
            issue,
            output_dir,
            base_url,
            retries,
            timeout,
            overwrite,
            proxy,
            ca_bundle,
            progress,
            origin_ips,
        )
    return download_one_python(
        issue,
        output_dir,
        base_url,
        retries,
        timeout,
        overwrite,
        proxy,
        ca_bundle,
        progress,
    )


def chunks(values: list[int], size: int) -> Iterable[list[int]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download ZrSetuTime original-image ZIP files excluding captions containing 🔞."
    )
    parser.add_argument(
        "--json-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "zrsetu",
        help="Directory containing the source JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path.home() / "Downloads" / "temp",
        help="Directory for downloaded ZIP files (default: %(default)s)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Number of concurrent downloads (default: %(default)s; single-threaded is most stable)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Wait for each descending batch before starting the next; default: same as --workers",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Attempts per file (default: %(default)s)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=60,
        help="Network timeout in seconds per request (default: %(default)s)",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="Archive host path (default: %(default)s)",
    )
    parser.add_argument(
        "--proxy",
        help="HTTP proxy, for example http://127.0.0.1:7890; direct connection if omitted",
    )
    parser.add_argument(
        "--ca-bundle",
        type=Path,
        help="Additional PEM CA certificate bundle (use the proxy's root CA if TLS verification still fails)",
    )
    parser.add_argument(
        "--backend",
        choices=("curl", "python"),
        default="curl",
        help="Download backend (default: curl; python is retained as a fallback)",
    )
    parser.add_argument(
        "--no-progress",
        action="store_true",
        help="Disable live progress bars",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Redownload files that already exist",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print the descending URLs; do not download",
    )
    args = parser.parse_args()
    if args.workers < 1 or args.retries < 1 or args.timeout <= 0:
        parser.error("--workers and --retries must be >= 1; --timeout must be > 0")
    if args.batch_size is not None and args.batch_size < 1:
        parser.error("--batch-size must be >= 1")
    return args


def main() -> int:
    args = parse_args()
    issues, excluded = load_issues(args.json_dir)

    print(f"Source: {args.json_dir}")
    print(f"Excluded by {ADULT_MARKER}: {len(excluded)} issues")
    print(f"To download: {len(issues)} issues, descending order")
    print(f"Output: {args.output_dir}")
    print(f"Proxy: {args.proxy or 'none (direct or environment settings)'}")
    print(f"Additional CA bundle: {args.ca_bundle or 'none'}")
    print(f"Backend: {args.backend} ({CURL_PATH if args.backend == 'curl' else 'urllib'})")
    fake_ips = fake_ip_addresses("r2-origin.setutime.com")
    if fake_ips:
        print(
            "WARNING: system DNS/TUN is active; r2-origin.setutime.com resolves "
            f"to Fake-IP {', '.join(fake_ips)}. Omitting --proxy does not bypass it.",
            file=sys.stderr,
        )

    if args.dry_run:
        for issue in issues:
            print(archive_url(args.base_url, issue))
        return 0

    args.output_dir.mkdir(parents=True, exist_ok=True)
    batch_size = args.batch_size or args.workers
    failed = 0
    downloaded = 0
    skipped = 0

    # Batches preserve descending scheduling order while allowing concurrent I/O.
    for batch_number, batch in enumerate(chunks(issues, batch_size), start=1):
        print(f"Starting batch {batch_number}: {batch[0]} down to {batch[-1]}")
        progress = ProgressDisplay(batch, enabled=not args.no_progress)
        progress.start()
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                issue: executor.submit(
                    download_one,
                    issue,
                    args.output_dir,
                    args.base_url,
                    args.retries,
                    args.timeout,
                    args.overwrite,
                    args.proxy,
                    args.ca_bundle,
                    progress,
                    args.backend,
                )
                for issue in batch
            }
            # All requests in a batch are concurrent, but reporting and moving
            # to the next batch stay in descending issue order.
            results = []
            for issue in batch:
                result_issue, status, detail = futures[issue].result()
                assert result_issue == issue
                results.append((issue, status, detail))
                progress.finish(issue, status)
                if status == "failed":
                    failed += 1
                elif status == "downloaded":
                    downloaded += 1
                else:
                    skipped += 1
            progress.close()
            for issue, status, detail in results:
                print(f"[{status.upper():10}] {issue}: {detail}")

    print(
        f"Finished: downloaded={downloaded}, skipped={skipped}, failed={failed}; "
        f"excluded={len(excluded)}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
