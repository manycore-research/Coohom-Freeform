"""Check English plugin-owned release text and canonical Markdown links.

The multilingual repository landing page and Unicode test fixtures are intentional.
Third-party runtime content and immutable historical releases are outside this gate.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\U00020000-\U0002fa1f]')
TEXT_SUFFIXES = {'.md', '.json', '.yaml', '.yml', '.mjs', '.ps1', '.cmd', '.tsv'}
RUNTIME_FILES = ('install.mjs', 'launch-mcp.mjs', 'launch-lux3d.mjs',
                 'update-freeform.mjs', 'update-lux3d.mjs', 'runtime-contract.mjs', 'manage-mcp.mjs')


def check(repo: Path) -> int:
    files = {p for folder in ('coohom-freeform', 'plugins/coohom-freeform', 'bundler/marketplace')
             for p in (repo / folder).rglob('*')
             if p.is_file() and (p.suffix in TEXT_SUFFIXES or p.name == 'bootstrap')}
    files.update(repo / 'bundler' / name for name in RUNTIME_FILES)
    files.update(repo / name for name in ('CHANGELOG.md', 'docs/marketplace.md', 'docs/development.md',
                                        'docs/releasing.md', 'scripts/release.py'))
    errors = []
    for path in sorted(files):
        content = path.read_text(encoding='utf-8')
        # Decode JSON so escaped non-English display metadata cannot evade the gate.
        if path.suffix == '.json':
            content = json.dumps(json.loads(content), ensure_ascii=False)
        if CJK.search(content):
            errors.append(f'Non-English release text: {path.relative_to(repo)}')
    for path in (repo / 'coohom-freeform').rglob('*.md'):
        for link in re.findall(r'\[[^\]]*\]\(([^\s)]+)\)', path.read_text(encoding='utf-8')):
            parsed = urlsplit(link)
            if parsed.scheme or parsed.netloc:
                continue
            target = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
            if not target.is_file():
                errors.append(f'Broken link in {path.relative_to(repo)}: {link}')
                continue
            if parsed.fragment:
                headings = re.findall(r'^#{1,6}\s+(.+)$', target.read_text(encoding='utf-8'), re.MULTILINE)
                anchors = {re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-') for heading in headings}
                if unquote(parsed.fragment) not in anchors:
                    errors.append(f'Broken heading link in {path.relative_to(repo)}: {link}')
    if errors:
        raise ValueError('\n'.join(errors))
    return len(files)


if __name__ == '__main__':
    print(f'English release text and canonical documentation links verified ({check(ROOT)} files).')
