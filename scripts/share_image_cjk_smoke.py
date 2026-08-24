#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.share_image import build_share_image_html


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _run_command(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip() or completed.stderr.strip()


def _render_png(html_path: Path, png_path: Path) -> None:
    _run_command(
        [
            "wkhtmltoimage",
            "--enable-local-file-access",
            "--width",
            "1080",
            str(html_path),
            str(png_path),
        ]
    )


def _write_fontconfig_report(output_dir: Path) -> Path:
    fontconfig_path = output_dir / "fontconfig.txt"
    if not shutil.which("fc-match"):
        _write_text(
            fontconfig_path,
            "Noto Sans CJK SC: fc-match not found in PATH\n"
            "Noto Sans CJK KR: fc-match not found in PATH\n",
        )
        return fontconfig_path

    lines = []
    for family in ("Noto Sans CJK SC", "Noto Sans CJK KR"):
        result = _run_command(["fc-match", family])
        lines.append(f"{family}: {result}")
    _write_text(fontconfig_path, "\n".join(lines) + "\n")
    return fontconfig_path


def _write_share_image_html(output_dir: Path) -> tuple[Path, Path]:
    zh_html = build_share_image_html(
        "# 贵州茅台 600519 分析报告\n\n## 核心判断\n\n- 趋势偏多，等待回踩确认。\n",
        generated_on=date(2026, 8, 24),
        structured_payload={
            "name": "贵州茅台",
            "code": "600519",
            "report_language": "zh",
            "sentiment_score": 72,
            "trend_prediction": "看多",
            "confidence_level": "高",
        },
    )
    ko_html = build_share_image_html(
        "# 일본 시장 리뷰\n\n## 주요 지수\n\n- 日経平均株価 상승.\n",
        generated_on=date(2026, 8, 24),
        structured_payload={
            "kind": "market_review",
            "region": "jp",
            "report_language": "ko",
            "title": "일본 시장 리뷰",
            "indices": [
                {"name": "日経平均株価", "current": 42123.45, "change_pct": 0.8},
            ],
        },
    )

    zh_path = output_dir / "zh-stock.html"
    ko_path = output_dir / "ko-market.html"
    _write_text(zh_path, zh_html)
    _write_text(ko_path, ko_html)
    return zh_path, ko_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate reproducible Linux/Docker CJK share-image smoke artifacts."
    )
    parser.add_argument(
        "--output-dir",
        default=str(ROOT_DIR / "tmp" / "share-image-cjk-smoke"),
        help="Directory used for generated HTML/PNG/fontconfig artifacts.",
    )
    parser.add_argument(
        "--skip-render",
        action="store_true",
        help="Only write HTML and fontconfig artifacts without invoking wkhtmltoimage.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    zh_html_path, ko_html_path = _write_share_image_html(output_dir)
    fontconfig_path = _write_fontconfig_report(output_dir)

    artifact_paths = [
        zh_html_path,
        ko_html_path,
        fontconfig_path,
    ]

    if not args.skip_render:
        if not shutil.which("wkhtmltoimage"):
            print(
                "wkhtmltoimage not found; rerun with --skip-render or install wkhtmltopdf.",
                file=sys.stderr,
            )
            return 2
        zh_png_path = output_dir / "zh-stock.png"
        ko_png_path = output_dir / "ko-market.png"
        _render_png(zh_html_path, zh_png_path)
        _render_png(ko_html_path, ko_png_path)
        artifact_paths.extend([zh_png_path, ko_png_path])

    print("Generated share-image CJK smoke artifacts:")
    for artifact_path in artifact_paths:
        print(artifact_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
