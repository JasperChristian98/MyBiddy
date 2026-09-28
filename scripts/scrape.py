#!/usr/bin/env python3
"""Resumable, batched English Wikipedia football-biography collector.

Drop-in replacement for scripts/scrape.py in My Biddy Aunt GitHub Pages.
Never erase your existing real-player JSON: back it up before your first run.
The existing player schema is preserved for the static Player Explorer.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import shutil
import sys
import time
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote

import mwparserfromhell
import requests

API = 'https://en.wikipedia.org/w/api.php'
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
CACHE = DATA / 'cache'
OUTPUT = DATA / 'players.json'
PROCESSED = DATA / 'premier_league_processed.json'
CANDIDATES = DATA / 'premier_league_candidates.json'
BACKUPS = DATA / 'backups'
CATEGORY = 'Premier League players'


def timestamp():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def atomic_json(path: Path, obj):
    """Replace a complete file atomically, never truncate the live JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    try:
        with tmp.open('w', encoding='utf-8') as file:
            json.dump(obj, file, ensure_ascii=False, indent=2)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def json_file(path, fallback):
    if not path.exists():
        return fallback
    with path.open(encoding='utf-8') as handle:
        return json.load(handle)


def backup_existing():
    """One safety backup per startup. Original is never removed."""
    if not OUTPUT.exists():
        return None
    BACKUPS.mkdir(parents=True, exist_ok=True)
    base = datetime.now().strftime('%Y%m%d_%H%M%S')
    dest = BACKUPS / f'players_before_resume_{base}.json'
    suffix = 1
    while dest.exists():
        dest = BACKUPS / f'players_before_resume_{base}_{suffix}.json'
        suffix += 1
    shutil.copy2(OUTPUT, dest)
    print(f'Safety backup: {dest}')
    return dest


def clean_text(value):
    text = html.unescape(str(value))
    try:
        text = mwparserfromhell.parse(text).strip_code(normalize=True, collapse=True)
    except Exception:
        pass
    text = re.sub(r'<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>', '', text, flags=re.I | re.S)
    text = re.sub(r'<[^>]+>', '', text)
    return re.sub(r'\s+', ' ', text.replace('\xa0', ' ')).strip()


def club_key(name):
    # Keep normalization compatible with existing saved records.
    s = unicodedata.normalize('NFKD', name.casefold())
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace('&', 'and')
    s = re.sub(r'\b(?:a\.?f\.?c\.?|f\.?c\.?|c\.?f\.?)\b', '', s)
    return re.sub(r'[^a-z0-9]+', '', s)


def title_key(title):
    return re.sub(r'\s+', ' ', title.replace('_', ' ')).strip().casefold()


def legacy_id(title):
    # Do not change player IDs in an existing dataset.
    return re.sub(r'[^a-z0-9]+', '-', title.casefold()).strip('-')


def parse_caps(value):
    t = clean_text(value or '')
    # Only parse a leading integer; a note containing a year is not an appearance count.
    m = re.match(r'^(\d[\d,]*)\s*(?:\(|\+|\b|$)', t)
    return int(m.group(1).replace(',', '')) if m else None


def parse_years(value):
    t = clean_text(value or '')
    years = [int(x) for x in re.findall(r'(?<!\d)(18\d{2}|19\d{2}|20\d{2})(?!\d)', t)]
    return t or None, years[0] if years else None, years[-1] if years else None


def parse_player(title, wikitext, min_clubs=2):
    code = mwparserfromhell.parse(wikitext)
    box = None
    for candidate in code.filter_templates(recursive=False):
        name = re.sub(r'[_\s]+', ' ', str(candidate.name)).strip().casefold()
        if name == 'infobox football biography':
            box = candidate
            break
    if box is None:
        return None

    def field(name):
        return str(box.get(name).value).strip() if box.has(name) else None

    name = clean_text(field('name') or title)
    spells = []
    for i in range(1, 81):
        rawclub = field(f'clubs{i}')
        rawcaps = field(f'caps{i}')
        rawyears = field(f'years{i}')
        if rawclub is None and rawcaps is None and rawyears is None:
            continue
        raw = clean_text(rawclub or '')
        loan = raw.startswith('→') or bool(re.search(r'\bloan\b', raw, re.I))
        club = re.sub(r'\s*\((?:on )?loan\)\s*$', '', raw.lstrip('→ ').strip(), flags=re.I)
        if not club or not club_key(club):
            continue
        years, first, last = parse_years(rawyears)
        spells.append({
            'club': club, 'club_key': club_key(club), 'start_year': first,
            'end_year': last, 'years': years, 'league_appearances': parse_caps(rawcaps),
            'loan': loan,
        })
    if not spells:
        return None

    clubs = {}
    for spell in spells:
        key = spell['club_key']
        entry = clubs.setdefault(key, {
            'name': spell['club'], 'league_appearances': 0,
            'appearance_data_complete': True, 'loan_spells': 0, 'spells': 0,
            'first_year': spell['start_year'], 'last_year': spell['end_year'],
        })
        entry['spells'] += 1
        entry['loan_spells'] += int(spell['loan'])
        if spell['league_appearances'] is None:
            entry['appearance_data_complete'] = False
        else:
            entry['league_appearances'] += spell['league_appearances']
        starts = [v for v in (entry['first_year'], spell['start_year']) if v is not None]
        ends = [v for v in (entry['last_year'], spell['end_year']) if v is not None]
        entry['first_year'] = min(starts) if starts else None
        entry['last_year'] = max(ends) if ends else None
    eligible = [v for v in clubs.values() if v['league_appearances'] >= 1]
    eligible.sort(key=lambda c: (c['first_year'] or 9999, c['name']))
    if len(eligible) < min_clubs:
        return None
    return {
        'id': legacy_id(title), 'name': name, 'wikipedia_title': title,
        'wikipedia_url': f'https://en.wikipedia.org/wiki/{quote(title.replace(" ", "_"))}',
        'position': clean_text(field('position') or '') or None,
        'birth_date_raw': clean_text(field('birth_date') or '') or None,
        'scraped_at': timestamp(), 'raw_spells': spells,
        'eligible_clubs': eligible, 'eligible_club_count': len(eligible),
    }


class WikiClient:
    def __init__(self, delay=6.0):
        self.delay = max(0.0, delay)
        self.session = requests.Session()
        contact = os.getenv('MBA_CONTACT', '').strip()
        if not contact:
            raise SystemExit('Set MBA_CONTACT to a contact email before scraping (see README).')
        self.session.headers.update({
            'User-Agent': f'MyBiddyAunt/0.3 ({contact}; personal football trivia project)',
            'Accept-Encoding': 'gzip',
        })
        self.next_allowed = 0.0

    def get(self, params, attempts=6):
        params = {**params, 'format': 'json', 'formatversion': 2, 'maxlag': 5}
        for attempt in range(attempts):
            wait = self.next_allowed - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.next_allowed = time.monotonic() + self.delay
            try:
                response = self.session.get(API, params=params, timeout=50)
                if response.status_code in (429, 500, 502, 503, 504):
                    retry = response.headers.get('Retry-After', '')
                    try:
                        pause = max(10.0, float(retry))
                    except ValueError:
                        try:
                            pause = max(10.0, (parsedate_to_datetime(retry) - datetime.now(timezone.utc)).total_seconds())
                        except (TypeError, ValueError, OverflowError):
                            pause = min(600.0, 30.0 * 2**attempt)
                    print(f'HTTP {response.status_code} — waiting {pause:.0f}s', flush=True)
                    time.sleep(pause)
                    continue
                response.raise_for_status()
                result = response.json()
                api_error = result.get('error', {})
                if api_error.get('code') in ('maxlag', 'ratelimited'):
                    pause = min(600, 30 * 2**attempt)
                    print(f'API {api_error["code"]} — waiting {pause}s', flush=True)
                    time.sleep(pause)
                    continue
                if api_error:
                    raise RuntimeError(f'Wikipedia API: {api_error}')
                return result
            except requests.RequestException as ex:
                if attempt == attempts - 1:
                    raise RuntimeError(f'Wikipedia request failed after retries: {ex}') from ex
                pause = min(600.0, 30.0 * 2**attempt + random.uniform(0, 3))
                print(f'Network error — waiting {pause:.0f}s', flush=True)
                time.sleep(pause)
        raise RuntimeError('Wikipedia continued rate-limiting after several retries; progress has been saved.')

    def discover(self):
        titles = []
        continuation = None
        while True:
            params = {'action': 'query', 'list': 'categorymembers',
                      'cmtitle': f'Category:{CATEGORY}', 'cmnamespace': 0, 'cmlimit': 500}
            if continuation:
                params['cmcontinue'] = continuation
            data = self.get(params)
            titles.extend(row['title'] for row in data.get('query', {}).get('categorymembers', []))
            continuation = data.get('continue', {}).get('cmcontinue')
            print(f'Discovered {len(titles)} PL candidate pages', flush=True)
            if not continuation:
                break
        # Preserve API order (not appearance ranking); dedupe titles.
        return list(dict.fromkeys(titles))

    def revisions_batch(self, titles):
        """Fetch up to 10 page sources in one request, using modern query/revisions API."""
        result = self.get({
            'action': 'query', 'prop': 'revisions', 'rvprop': 'content',
            'rvslots': 'main', 'redirects': 1, 'titles': '|'.join(titles),
        })
        pages = result.get('query', {}).get('pages', [])
        by_title = {}
        for page in pages:
            if page.get('missing'):
                continue
            slots = (page.get('revisions') or [{}])[0].get('slots', {})
            text = slots.get('main', {}).get('content')
            if text is not None:
                by_title[title_key(page['title'])] = (page['title'], text)
        aliases = {}
        for row in result.get('query', {}).get('normalized', []):
            aliases[title_key(row['from'])] = title_key(row['to'])
        for row in result.get('query', {}).get('redirects', []):
            aliases[title_key(row['from'])] = title_key(row['to'])
        resolved = {}
        for asked in titles:
            key = title_key(asked)
            for _ in range(5):
                if key in aliases:
                    key = aliases[key]
                else:
                    break
            if key in by_title:
                resolved[asked] = by_title[key]
        return resolved


def cache_path(title):
    # Reuse existing scraper's filename scheme when present.
    safe = re.sub(r'[^A-Za-z0-9._-]+', '_', title)[:160]
    return CACHE / f'{safe}.json'


def read_cache(title):
    path = cache_path(title)
    if not path.exists():
        return None
    try:
        data = json_file(path, {})
        if isinstance(data.get('wikitext'), str):
            return data.get('title', title), data['wikitext']
    except (OSError, ValueError):
        pass
    return None


def save_cache(title, resolved, wikitext):
    CACHE.mkdir(parents=True, exist_ok=True)
    atomic_json(cache_path(title), {'title': resolved, 'wikitext': wikitext})


def load_existing():
    old = json_file(OUTPUT, {})
    if not old:
        return [], old
    players = old.get('players')
    if not isinstance(players, list):
        raise SystemExit('players.json has an unexpected format. No files were modified.')
    if old.get('generated_at') == 'sample' or any(str(p.get('id', '')).startswith('sample-') for p in players):
        print('Detected bundled fictional test data: will replace those, not treat them as scraped.')
        return [], old
    source = old.get('source_category')
    if source not in (None, CATEGORY):
        raise SystemExit(f'Existing JSON source_category={source!r}; refusing to overwrite it.')
    return players, old


def make_payload(players):
    return {
        'schema_version': 1, 'source_category': CATEGORY, 'generated_at': timestamp(),
        'rules': {'senior_clubs_only': True, 'loans_count': True,
                  'minimum_league_appearances': 1, 'repeat_spells_count_once': True},
        'player_count': len(players), 'players': sorted(players, key=lambda p: p['name'].casefold()),
    }


def main(argv=None, client=None):
    arg = argparse.ArgumentParser(description=__doc__)
    arg.add_argument('--target', type=int, default=10000, help='Maximum total players, INCLUDING existing records')
    arg.add_argument('--delay', type=float, default=6.0, help='Minimum seconds between API requests')
    arg.add_argument('--batch-size', type=int, default=10, help='Wikipedia pages fetched per request (1–10)')
    arg.add_argument('--checkpoint-every', type=int, default=25, help='Save after this many processed candidates')
    arg.add_argument('--refresh-candidates', action='store_true', help='Rediscover category without discarding saved players')
    arg.add_argument('--min-clubs', type=int, default=2, help='Minimum eligible clubs to retain a player')
    args = arg.parse_args(argv)
    if args.target < 1 or not 1 <= args.batch_size <= 10 or args.checkpoint_every < 1:
        arg.error('target/checkpoint must be positive, batch-size must be 1–10')

    DATA.mkdir(parents=True, exist_ok=True)
    # Parse before creating backup or touching files; broken JSON must never be overwritten.
    players, _ = load_existing()
    existing_titles = {title_key(p.get('wikipedia_title', '')) for p in players if p.get('wikipedia_title')}
    existing_ids = {p['id'] for p in players}
    processed = set(json_file(PROCESSED, []))
    processed_keys = {title_key(t) for t in processed} | existing_titles
    print(f'Existing: {len(players):,} valid players, {len(processed_keys):,} previously checked pages')
    if len(players) >= args.target:
        print(f'Target already met: {len(players):,} >= {args.target:,}. No changes needed.')
        return
    if client is None:
        client = WikiClient(args.delay)
    if CANDIDATES.exists() and not args.refresh_candidates:
        titles = json_file(CANDIDATES, [])
        print(f'Using saved candidate list ({len(titles):,} titles).')
    else:
        print('Discovering Category:Premier League players ...')
        discovered = client.discover()
        old_titles = json_file(CANDIDATES, [])
        titles = list(dict.fromkeys(old_titles + discovered))
        atomic_json(CANDIDATES, titles)
    if not isinstance(titles, list):
        raise SystemExit('Candidate list is malformed; no output changed.')
    # Stable candidate order across restarts; the original candidate file may be shuffled.
    titles = list(dict.fromkeys(str(title) for title in titles))
    pending = [t for t in titles if title_key(t) not in processed_keys]
    print(f'{len(titles):,} candidate pages, {len(pending):,} not yet checked.')
    backup_existing()
    newly_checked = 0
    new_players = 0

    def checkpoint():
        # Atomically replace EACH file. On crash between them, saved players
        # remain the source of truth; candidates are safe to reprocess.
        atomic_json(OUTPUT, make_payload(players))
        atomic_json(PROCESSED, sorted(processed))
        print(f'Saved: {len(players):,} players; {len(processed):,} processed titles.', flush=True)

    try:
        for offset in range(0, len(pending), args.batch_size):
            if len(players) >= args.target:
                break
            group = pending[offset: offset + args.batch_size]
            fetched = {}
            absent = []
            for title in group:
                cached = read_cache(title)
                if cached is not None:
                    fetched[title] = cached
                else:
                    absent.append(title)
            if absent:
                fetched.update(client.revisions_batch(absent))
            for title in group:
                if len(players) >= args.target:
                    break
                page = fetched.get(title)
                if not page:
                    # Don't mark missing/error pages as processed: they can be retried.
                    print(f'[retry later] {title}: page content unavailable')
                    continue
                resolved_title, text = page
                if read_cache(title) is None:
                    save_cache(title, resolved_title, text)
                try:
                    record = parse_player(resolved_title, text, args.min_clubs)
                except Exception as error:
                    print(f'[retry later] {title}: parsing error: {error}')
                    continue
                # Same page may be listed via redirects / alias titles.
                identity = title_key(resolved_title)
                if record and identity not in existing_titles and record['id'] not in existing_ids:
                    players.append(record)
                    existing_titles.add(identity)
                    existing_ids.add(record['id'])
                    new_players += 1
                    print(f'[{len(players):,}/{args.target:,}] {record["name"]} — {record["eligible_club_count"]} clubs', flush=True)
                processed.add(title)
                processed_keys.add(title_key(title))
                newly_checked += 1
                if newly_checked % args.checkpoint_every == 0:
                    checkpoint()
    except (KeyboardInterrupt, RuntimeError, requests.RequestException) as ex:
        print(f'Interrupted: {ex or "Ctrl+C"}. Saving safely...', flush=True)
    finally:
        checkpoint()

    print(f'Finished: {len(players):,} players; +{new_players:,} this run.')
    if len(players) < args.target and len(pending) <= newly_checked:
        print('Candidate list exhausted. Raising --target will not create more PL alumni; use --refresh-candidates or broaden discovery.')
    elif len(players) < args.target:
        print('Resume later with the exact same command. Previously saved players are retained.')


if __name__ == '__main__':
    main()
